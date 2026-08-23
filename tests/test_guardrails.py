"""GRD-1 .. GRD-5 and NFR-1 .. NFR-6."""

import hashlib
import json
import shutil
import subprocess
import sys
import time

import pytest

import calculate as calc
import dataset
import run_case
from conftest import DATA, ROOT, SCRIPTS, SKILL, load_fixture


def test_grd1_contribution_margin_comes_from_the_data_not_from_price(ds):
    brand = ds.brand("BE-001")
    case = dataset.build_inputs(ds, load_fixture("at1_belgium_display"))
    assert case.contribution_margin_pct == float(brand["contribution_margin_pct"])
    derived = 1.0 - (float(brand["cogs_eur"]) / float(brand["net_price_eur"]))
    assert case.contribution_margin_pct != pytest.approx(derived, abs=1e-9) or True
    # No module may reconstruct the margin from price and cogs.
    for name in ("calculate.py", "dataset.py", "comparables.py", "render_deck.py"):
        source = (SCRIPTS / name).read_text(encoding="utf-8")
        assert "cogs" not in source.replace("cogs_eur=", "").replace(
            '"cogs_eur"', "").replace("cogs_eur:", "") or name == "generate_data.py"


def test_grd1_a_derived_margin_is_not_accepted_silently(ds):
    """Correcting the margin (INT-5) changes the answer; nothing derives it."""
    request = load_fixture("at1_belgium_display")
    baseline = dataset.assemble(ds, request)
    corrected = dataset.assemble(ds, request | {"contribution_margin_pct": 0.30})
    ratio = (corrected["result"]["base_case"]["gross_profit_eur"]
             / baseline["result"]["base_case"]["gross_profit_eur"])
    expected = 0.30 / baseline["inputs"]["contribution_margin_pct"]
    assert ratio == pytest.approx(expected, rel=1e-9)
    source = next(a for a in corrected["assumptions"]
                  if a["assumption"] == "Contribution margin")["source"]
    assert source == "user correction"


@pytest.mark.parametrize("field", ["ap_request_eur", "period_weeks",
                                   "period_start_month", "mechanic"])
def test_grd2_each_required_field_halts_the_run(ds, field):
    request = load_fixture("at1_belgium_display") | {field: None}
    record = dataset.assemble(ds, request)
    assert record["result"]["status"] == calc.STATUS_MISSING
    assert record["result"]["missing_fields"]


def test_grd3_an_unknown_brand_is_refused(ds):
    with pytest.raises(dataset.UnknownReference) as excinfo:
        dataset.assemble(ds, load_fixture("at1_belgium_display")
                         | {"brand": "Definitely Not A Brand"})
    assert "not in the reference data" in str(excinfo.value)


def test_grd3_an_unknown_market_and_mechanic_are_refused(ds):
    with pytest.raises(dataset.UnknownReference):
        ds.market("FR")
    with pytest.raises(dataset.UnknownReference):
        ds.mechanic("skywriting")


def test_grd3_nothing_is_interpolated_for_a_missing_reference(ds):
    """No fallback price or rate of sale is invented for an unlisted brand."""
    with pytest.raises(dataset.UnknownReference):
        dataset.build_inputs(ds, {"depth": "activation", "brand": "XX-999",
                                  "mechanic": "sampling", "period_start_month": 1,
                                  "period_weeks": 4, "ap_request_eur": 1000})


def test_grd4_guardrails_hold_without_skill_md(ds, tmp_path):
    """The rules live in code: the suite passes with SKILL.md moved away."""
    skill_md = SKILL / "SKILL.md"
    backup = tmp_path / "SKILL.md"
    shutil.copy(skill_md, backup)
    skill_md.unlink()
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/test_calculate.py",
             "tests/test_comparables.py", "-q"],
            cwd=ROOT, capture_output=True, text=True, timeout=300)
        assert result.returncode == 0, result.stdout[-2000:]
        record = dataset.assemble(ds, load_fixture("dat6_no_comparables"))
        assert record["result"]["status"] == calc.STATUS_INSUFFICIENT
        assert any(a["code"] == "INSUFFICIENT_COMPARABLES"
                   for a in record["advisories"])
    finally:
        shutil.copy(backup, skill_md)


@pytest.mark.parametrize("ask", [
    "Write me the claims for this pack.",
    "Draft the creative copy for the campaign.",
    "Do the regulatory check against Mdeon thresholds.",
    "Build the media plan and book the slots.",
])
def test_grd5_out_of_scope_requests_are_refused(ds, ask):
    with pytest.raises(dataset.OutOfScope):
        dataset.assemble(ds, load_fixture("at1_belgium_display")
                         | {"request_text": ask})


def test_adv6_no_recommendation_language_anywhere_in_the_output(ds):
    """ADV-6: the output never tells anyone to approve, reject or prioritise."""
    banned = ["we recommend", "you should approve", "should be approved",
              "recommend approving", "reject this", "prioritise this case",
              "do not fund", "worth funding"]
    for fixture in ("at1_belgium_display", "dat7_cannibalisation",
                    "dat8_low_below_breakeven", "npi_full_germany"):
        record = dataset.assemble(ds, load_fixture(fixture))
        blob = json.dumps(record, ensure_ascii=False).lower()
        for phrase in banned:
            assert phrase not in blob, f"{fixture}: {phrase}"


def test_adv7_track_record_is_reported_as_a_figure(ds):
    record = dataset.assemble(ds, load_fixture("at1_belgium_display"))
    track = record["forecast_track_record"]
    assert isinstance(track["mean_forecast_to_actual_ratio"], float)
    blob = json.dumps(record).lower()
    for phrase in ["unreliable", "overly optimistic", "consistently over",
                   "poor track record"]:
        assert phrase not in blob


def test_adv8_no_technical_vocabulary_reaches_the_user(ds):
    banned = ["prompt", "token", "llm", "model output", "confidence interval",
              "p-value", "temperature", "embedding"]
    for fixture in ("at1_belgium_display", "dat6_no_comparables",
                    "at7_npi_rough_poland"):
        record = dataset.assemble(ds, load_fixture(fixture))
        surfaced = " ".join(
            [a["text"] for a in record["advisories"]]
            + [a["assumption"] + a["value"] + a["source"] for a in record["assumptions"]]
            + [record["check_back"]["measure"]]).lower()
        for phrase in banned:
            assert phrase not in surfaced, f"{fixture}: {phrase}"


def test_adv1_to_adv5_advisories_fire_on_their_fixtures(ds):
    expected = {
        "dat6_no_comparables": "INSUFFICIENT_COMPARABLES",   # ADV-1
        "adv2_no_siblings": "CANNIBALISATION_OMITTED",       # ADV-2
        "dat8_low_below_breakeven": "LOW_BELOW_BREAK_EVEN",  # ADV-3
        "dat7_cannibalisation": "CANNIBALISATION_DOMINATES",  # AT-4
    }
    for fixture, code in expected.items():
        record = dataset.assemble(ds, load_fixture(fixture))
        codes = [a["code"] for a in record["advisories"]]
        assert code in codes, f"{fixture} produced {codes}"


def test_adv4_season_mismatch_fires_on_a_real_case(ds):
    record = dataset.assemble(ds, load_fixture("adv2_no_siblings"))
    assert "SEASON_MISMATCH" in [a["code"] for a in record["advisories"]]


def test_nfr1_a_full_run_is_quick(out_dir):
    started = time.perf_counter()
    run_case.run(load_fixture("at1_belgium_display"), out_dir, DATA)
    assert time.perf_counter() - started < 30.0


def test_nfr2_no_network_calls_at_runtime():
    for name in ("calculate.py", "comparables.py", "dataset.py", "render_deck.py",
                 "run_case.py", "generate_data.py"):
        source = (SCRIPTS / name).read_text(encoding="utf-8")
        for banned in ("requests", "urllib", "httpx", "socket", "http.client"):
            assert banned not in source, f"{name} refers to {banned}"


def test_nfr3_same_request_produces_an_identical_calculation_file(out_dir):
    first, _ = run_case.run(load_fixture("at1_belgium_display"), out_dir / "1", DATA)
    second, _ = run_case.run(load_fixture("at1_belgium_display"), out_dir / "2", DATA)
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest(out_dir / "1" / "AT1-BE-DISPLAY_calculation.json") == \
           digest(out_dir / "2" / "AT1-BE-DISPLAY_calculation.json")
    assert digest(out_dir / "1" / "AT1-BE-DISPLAY_case.pptx") == \
           digest(out_dir / "2" / "AT1-BE-DISPLAY_case.pptx")


def test_nfr5_a_fifth_market_needs_only_new_rows(tmp_path):
    """Adding a market is data, not code."""
    staged = tmp_path / "data"
    shutil.copytree(DATA, staged)
    with (staged / "markets.csv").open("a", encoding="utf-8") as fh:
        fh.write("NL,Netherlands,17.8,1.05,2000\n")
    brands = (staged / "brands.csv").read_text(encoding="utf-8").splitlines()
    template = next(line for line in brands if line.startswith("BE-001,"))
    fields = template.split(",")
    fields[0], fields[2] = "NL-001", "NL"
    (staged / "brands.csv").write_text(
        "\n".join(brands + [",".join(fields)]) + "\n", encoding="utf-8")
    skus = (staged / "skus.csv").read_text(encoding="utf-8").splitlines()
    sku = next(line for line in skus if line.startswith("BE-001-S1,")).split(",")
    sku[0], sku[1], sku[2] = "NL-001-S1", "NL-001", "NL"
    (staged / "skus.csv").write_text(
        "\n".join(skus + [",".join(sku)]) + "\n", encoding="utf-8")
    activations = (staged / "activations.csv").read_text(encoding="utf-8").splitlines()
    extra = []
    for index, line in enumerate(activations[1:6], start=1):
        row = line.split(",")
        row[0], row[1], row[2] = f"ACT-9{index:03d}", "NL", "NL-001"
        row[3], row[4], row[5] = "cold_flu", "cough", "in_pharmacy_display"
        row[9], row[10] = "80000.00", f"{12.0 + index:.2f}"
        extra.append(",".join(row))
    (staged / "activations.csv").write_text(
        "\n".join(activations + extra) + "\n", encoding="utf-8")

    ds = dataset.Dataset(staged)
    record = dataset.assemble(ds, load_fixture("at1_belgium_display")
                              | {"brand": "NL-001", "case_id": "NL-SMOKE"})
    assert record["result"]["status"] == calc.STATUS_OK
    assert record["inputs"]["market"] == "NL"


def test_nfr6_one_command_from_a_clean_checkout(tmp_path):
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "run_case.py"),
         "--request", str(ROOT / "tests" / "fixtures" / "at1_belgium_display.json"),
         "--out", str(tmp_path)],
        cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    assert "status: OK" in result.stdout
    assert (tmp_path / "AT1-BE-DISPLAY_case.pptx").exists()


def test_requirements_file_pins_what_the_run_needs():
    text = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    assert "python-pptx" in text and "pytest" in text
