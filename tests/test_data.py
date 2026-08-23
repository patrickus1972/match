"""DAT-1 .. DAT-11: the synthetic dataset."""

import csv
import statistics
from pathlib import Path

import pytest

import generate_data as gen
from conftest import DATA, SKILL


def read(name: str) -> list[dict]:
    with (DATA / name).open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def test_dat1_same_seed_is_byte_identical(tmp_path):
    first, second = tmp_path / "a", tmp_path / "b"
    gen.generate(first, gen.SEED)
    gen.generate(second, gen.SEED)
    for path in sorted(first.iterdir()):
        assert path.read_bytes() == (second / path.name).read_bytes(), path.name


def test_dat1_committed_data_matches_the_generator(tmp_path):
    gen.generate(tmp_path, gen.SEED)
    for path in sorted(tmp_path.iterdir()):
        assert path.read_bytes() == (DATA / path.name).read_bytes(), (
            f"{path.name} is stale — re-run generate_data.py")


def test_dat2_row_counts():
    assert len(read("markets.csv")) == 4
    assert len(read("brands.csv")) == 48
    assert len(read("skus.csv")) >= 120
    assert len(read("activations.csv")) == 220
    assert len(read("launches.csv")) == 35
    assert 55 <= len(read("competitors.csv")) <= 65
    assert {r["market_id"] for r in read("markets.csv")} == {"BE", "DE", "PL", "RS"}


def test_dat3_brand_schema_and_seasonality_mean():
    required = ["market", "category", "need_state", "net_price_eur", "cogs_eur",
                "contribution_margin_pct", "base_rate_of_sale_units_week"]
    for row in read("brands.csv"):
        for field in required:
            assert row[field] not in (None, ""), field
        indices = [float(row[f"seasonality_m{m}"]) for m in range(1, 13)]
        assert len(indices) == 12
        assert abs(statistics.fmean(indices) - 1.0) <= 0.01


@pytest.mark.parametrize("category,peak_months", [
    ("cold_flu", {12, 1, 2}),      # weeks 40-8
    ("allergy", {4, 5, 6}),        # weeks 10-26
])
def test_dat4_seasonality_peaks_match_category(category, peak_months):
    row = next(r for r in read("brands.csv") if r["category"] == category)
    indices = [float(row[f"seasonality_m{m}"]) for m in range(1, 13)]
    peak_month = indices.index(max(indices)) + 1
    assert peak_month in peak_months


def test_dat5_rate_of_sale_tracks_market_population():
    populations = {r["market_id"]: float(r["population_m"]) for r in read("markets.csv")}
    brands = read("brands.csv")
    xs = [populations[r["market"]] for r in brands]
    ys = [float(r["base_rate_of_sale_units_week"]) for r in brands]
    assert statistics.correlation(xs, ys) > 0.6


def test_dat6_a_brand_mechanic_combination_has_no_history():
    import comparables as cmp
    activations = read("activations.csv")
    brand = next(r for r in read("brands.csv")
                 if r["brand_id"] == gen.FIXTURE_NO_HISTORY_BRAND)
    matched = cmp.match_activations(
        activations, market=brand["market"], mechanic=gen.FIXTURE_NO_HISTORY_MECHANIC,
        category=brand["category"], ap_request_eur=90000.0)
    assert matched == []
    assert not cmp.sufficient(matched)


def test_dat7_cannibalisation_can_flip_a_case_negative():
    import dataset
    from conftest import load_fixture
    ds = dataset.Dataset(DATA)
    record = dataset.assemble(ds, load_fixture("dat7_cannibalisation"))
    base = record["result"]["base_case"]
    assert base["cannibalised_units"] > base["incremental_units"]
    assert base["gross_profit_eur"] < 0


def test_dat8_low_below_break_even_and_base_above():
    import dataset
    from conftest import load_fixture
    ds = dataset.Dataset(DATA)
    record = dataset.assemble(ds, load_fixture("dat8_low_below_breakeven"))
    scenarios = record["result"]["scenarios"]
    assert scenarios["low"]["above_break_even"] is False
    assert scenarios["base"]["above_break_even"] is True


def test_dat9_launch_forecasts_run_above_actuals():
    ratios = [float(r["forecast_year1_units"]) / float(r["actual_year1_units"])
              for r in read("launches.csv")]
    assert 1.10 <= statistics.fmean(ratios) <= 1.20


def test_dat10_low_data_quality_share():
    rows = read("activations.csv")
    share = sum(1 for r in rows if r["data_quality"] == "low") / len(rows)
    assert 0.05 <= share <= 0.15


def test_dat11_no_real_brand_names():
    blocklist = [line.strip().lower()
                 for line in (SKILL / "reference" / "brand_blocklist.txt")
                 .read_text(encoding="utf-8").splitlines()
                 if line.strip() and not line.startswith("#")]
    assert blocklist, "the blocklist must not be empty"
    names = [r["brand_name"].lower() for r in read("brands.csv")]
    names += [r["competitor_brand"].lower() for r in read("competitors.csv")]
    for name in names:
        for blocked in blocklist:
            assert blocked not in name, f"{name} collides with {blocked}"
