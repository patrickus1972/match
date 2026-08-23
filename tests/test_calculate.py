"""CAL-1, CAL-2, CAL-6 .. CAL-12 against hand-checked worked examples."""

import pytest

import calculate as calc
from conftest import SCRIPTS

FLAT = [1.0] * 12


def inputs(**overrides) -> calc.CaseInputs:
    base = dict(
        depth="activation", brand_id="BE-001", brand_name="Kalvora", market="BE",
        category="cold_flu", need_state="cough", mechanic="in_pharmacy_display",
        period_start_month=10, period_weeks=6, ap_request_eur=80000.0,
        net_price_eur=10.0, cogs_eur=4.0, contribution_margin_pct=0.60,
        base_rate_of_sale_units_week=1000.0, seasonality=FLAT,
        market_population_m=11.7,
    )
    base.update(overrides)
    return calc.CaseInputs(**base)


def stats(p25=10.0, median=20.0, p75=30.0, n=5) -> dict:
    return {"n": n, "uplift_pct_p25": p25, "uplift_pct_median": median,
            "uplift_pct_p75": p75, "uplift_values_pct": [p25, median, p75]}


# -- CAL-1 -----------------------------------------------------------------

def test_cal1_calculation_module_is_pure():
    source = (SCRIPTS / "calculate.py").read_text(encoding="utf-8")
    for banned in ("import csv", "import json", "import pathlib", "from pathlib",
                   "import requests", "import pptx", "from pptx", "open("):
        assert banned not in source, f"calculate.py must not use {banned!r}"


# -- CAL-2 -----------------------------------------------------------------

def test_cal2_baseline_units_worked_example():
    # 1,000 units/week x 6 weeks x 1.25 seasonality = 7,500 units
    assert calc.baseline_units(1000.0, 6, 1.25) == pytest.approx(7500.0)


def test_seasonality_index_lookup_and_validation():
    curve = [round(0.8 + 0.02 * m, 4) for m in range(1, 13)]
    assert calc.seasonality_index(curve, 1) == curve[0]
    assert calc.seasonality_index(curve, 12) == curve[11]
    with pytest.raises(ValueError):
        calc.seasonality_index(curve, 13)
    with pytest.raises(ValueError):
        calc.seasonality_index([1.0, 1.0], 1)


def test_incremental_units():
    assert calc.incremental_units(7500.0, 20.0) == pytest.approx(1500.0)


# -- CAL-6, CAL-7, CAL-8 ---------------------------------------------------

def test_cal6_cannibalised_units_sums_over_siblings():
    siblings = [
        calc.Sibling("S1", 500.0, 0.02, 1.0),   # 500 x 6 x 1.0 x 0.02 =  60
        calc.Sibling("S2", 200.0, 0.05, 2.0),   # 200 x 6 x 2.0 x 0.05 = 120
    ]
    assert calc.cannibalised_units(siblings, 6) == pytest.approx(180.0)
    assert calc.cannibalised_units([], 6) == 0.0


def test_cal7_gross_profit():
    # (1,500 - 180) x 10.00 x 0.60 = 7,920
    assert calc.gross_profit_eur(1500.0, 180.0, 10.0, 0.60) == pytest.approx(7920.0)


def test_cal8_gross_profit_per_ap_euro():
    assert calc.gp_per_ap_euro(7920.0, 80000.0) == pytest.approx(0.099)
    with pytest.raises(ValueError):
        calc.gp_per_ap_euro(1.0, 0.0)


def test_break_even_uplift():
    case = inputs()
    # unit GP 6.00; 80,000 / 6 = 13,333.33 units needed on a 6,000-unit baseline
    value = calc.break_even_uplift_pct(case, cannibalised=0.0, baseline=6000.0)
    assert value == pytest.approx(222.222, abs=0.01)


# -- CAL-9 -----------------------------------------------------------------

def test_cal9_three_scenarios_ordered_low_base_high():
    result = calc.calculate_activation(inputs(), stats())
    low, base, high = (result["scenarios"][k] for k in ("low", "base", "high"))
    assert low["period_weeks"] == 4 and base["period_weeks"] == 6
    assert high["period_weeks"] == 8
    assert low["uplift_pct"] < base["uplift_pct"] < high["uplift_pct"]
    assert (low["gross_profit_eur"] < base["gross_profit_eur"]
            < high["gross_profit_eur"])


def test_scenario_weeks_never_go_below_one():
    result = calc.calculate_activation(inputs(period_weeks=1), stats())
    assert result["scenarios"]["low"]["period_weeks"] == 1


def test_above_break_even_flag():
    result = calc.calculate_activation(
        inputs(ap_request_eur=1000.0, base_rate_of_sale_units_week=10000.0), stats())
    assert result["scenarios"]["base"]["above_break_even"] is True
    tight = calc.calculate_activation(inputs(ap_request_eur=10_000_000.0), stats())
    assert tight["scenarios"]["base"]["above_break_even"] is False


# -- CAL-10, CAL-11 --------------------------------------------------------

def analogue(lid, actual, population=40.0):
    return {"launch_id": lid, "actual_year1_units": str(actual),
            "forecast_year1_units": str(actual * 1.15),
            "market_population_m": str(population), "market": "PL",
            "category": "vitamins", "need_state": "immunity", "launch_year": "2022"}


def test_cal10_year1_units_is_the_size_adjusted_median():
    rows = [analogue("L1", 100000, 40.0), analogue("L2", 150000, 40.0),
            analogue("L3", 400000, 80.0)]
    # scaled to a 40m market: 100,000 / 150,000 / 200,000 -> median 150,000
    assert calc.npi_year1_units(rows, 40.0) == pytest.approx(150000.0)
    even = [analogue("L1", 100000, 40.0), analogue("L2", 200000, 40.0)]
    assert calc.npi_year1_units(even, 40.0) == pytest.approx(150000.0)
    with pytest.raises(ValueError):
        calc.npi_year1_units([], 40.0)


def test_cal10_ramp_curve_shapes_year_one():
    case = inputs(depth="npi_rough", market_population_m=40.0,
                  ap_request_eur=500000.0, base_rate_of_sale_units_week=None,
                  seasonality=None)
    result = calc.calculate_npi(case, [analogue("L1", 100000), analogue("L2", 200000)])
    quarters = result["year1_quarter_units"]
    assert len(quarters) == 4
    assert quarters == sorted(quarters)
    assert sum(quarters) == pytest.approx(result["year1_units"])
    assert result["years"] and len(result["years"]) == 1


def test_cal11_three_years_and_payback():
    case = inputs(depth="npi_full", market_population_m=40.0,
                  ap_request_eur=500000.0, base_rate_of_sale_units_week=None,
                  seasonality=None)
    result = calc.calculate_npi(case, [analogue("L1", 100000), analogue("L2", 200000)])
    assert [y["year"] for y in result["years"]] == [1, 2, 3]
    assert result["years"][1]["units"] > result["years"][0]["units"]
    assert result["cumulative_gross_profit_eur"] == pytest.approx(
        sum(y["gross_profit_eur"] for y in result["years"]))
    # year 1 gross profit is 150,000 x 10.00 x 0.60 = 900,000, so 500,000 is
    # repaid 6.67 months in.
    assert result["payback_months"] == pytest.approx(6.667, abs=0.01)
    assert result["scenarios"]["low"]["year1_units"] < result["scenarios"]["high"]["year1_units"]


def test_payback_returns_none_when_never_repaid():
    years = [{"year": 1, "gross_profit_eur": 10.0},
             {"year": 2, "gross_profit_eur": 10.0},
             {"year": 3, "gross_profit_eur": 0.0}]
    assert calc.payback_months(years, 1_000_000.0) is None


def test_payback_reaches_into_a_later_year():
    years = [{"year": 1, "gross_profit_eur": 120.0},
             {"year": 2, "gross_profit_eur": 120.0}]
    assert calc.payback_months(years, 180.0) == pytest.approx(18.0)


# -- CAL-12, GRD-2, CAL-5 --------------------------------------------------

def test_cal12_values_are_unrounded():
    result = calc.calculate_activation(inputs(base_rate_of_sale_units_week=1234.5,
                                              seasonality=[1.0333] * 12), stats())
    gross = result["base_case"]["gross_profit_eur"]
    assert gross != round(gross, 2)


def test_grd2_missing_inputs_halt_the_calculation():
    result = calc.run_case(inputs(ap_request_eur=None, net_price_eur=None),
                           uplift_stats=stats())
    assert result["status"] == calc.STATUS_MISSING
    assert set(result["missing_fields"]) == {"ap_request_eur", "net_price_eur"}


@pytest.mark.parametrize("field", sorted(calc.REQUIRED_FIELDS["activation"]))
def test_grd2_every_required_field_is_checked(field):
    result = calc.run_case(inputs(**{field: None}), uplift_stats=stats())
    assert result["status"] == calc.STATUS_MISSING
    assert field in result["missing_fields"]


def test_unknown_depth_is_rejected():
    result = calc.run_case(inputs(depth="guesswork"), uplift_stats=stats())
    assert result["status"] == calc.STATUS_MISSING
    assert result["missing_fields"] == ["depth"]


def test_cal5_no_forecast_below_two_comparables():
    for supplied in (None, stats(n=1), stats(n=0)):
        result = calc.run_case(inputs(), uplift_stats=supplied)
        assert result["status"] == calc.STATUS_INSUFFICIENT
        assert "scenarios" not in result
        assert "base_case" not in result


def test_npi_needs_two_analogues():
    case = inputs(depth="npi_rough", base_rate_of_sale_units_week=None,
                  seasonality=None)
    assert calc.run_case(case, analogues=[]).get("status") == calc.STATUS_INSUFFICIENT
    assert (calc.run_case(case, analogues=[analogue("L1", 1000)])["status"]
            == calc.STATUS_INSUFFICIENT)


def test_run_case_routes_by_depth():
    activation = calc.run_case(inputs(), uplift_stats=stats())
    assert activation["status"] == calc.STATUS_OK and "scenarios" in activation
    npi = calc.run_case(
        inputs(depth="npi_full", base_rate_of_sale_units_week=None, seasonality=None),
        analogues=[analogue("L1", 100000), analogue("L2", 200000)])
    assert npi["status"] == calc.STATUS_OK and "payback_months" in npi


def test_cannibalisation_flags_reported():
    with_siblings = calc.calculate_activation(
        inputs(siblings=[calc.Sibling("S1", 100.0, 0.01, 1.0)]), stats())
    assert with_siblings["cannibalisation_included"] is True
    without = calc.calculate_activation(inputs(siblings_available=False), stats())
    assert without["cannibalisation_included"] is False
    assert without["sibling_data_available"] is False
