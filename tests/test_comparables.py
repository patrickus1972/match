"""CAL-3, CAL-4, CAL-5 and the matching helpers behind ADV-4 / ADV-5."""

import pytest

import comparables as cmp


def activation(aid, *, market="BE", mechanic="in_pharmacy_display",
               category="cold_flu", spend=80000.0, uplift=12.0, month=10):
    return {"activation_id": aid, "market": market, "mechanic": mechanic,
            "category": category, "spend_eur": str(spend),
            "measured_uplift_pct": str(uplift), "start_month": str(month),
            "duration_weeks": "6", "data_quality": "high"}


def test_cal3_matches_on_market_mechanic_category_and_spend_band():
    rows = [
        activation("A1", spend=80000),                    # exact
        activation("A2", spend=48000),                    # -40%, inclusive
        activation("A3", spend=112000),                   # +40%, inclusive
        activation("A4", spend=47999),                    # just outside
        activation("A5", spend=112001),                   # just outside
        activation("A6", market="DE"),                    # wrong market
        activation("A7", mechanic="sampling"),            # wrong mechanic
        activation("A8", category="allergy"),             # wrong category
    ]
    matched = cmp.match_activations(rows, market="BE",
                                    mechanic="in_pharmacy_display",
                                    category="cold_flu", ap_request_eur=80000.0)
    assert [r["activation_id"] for r in matched] == ["A1", "A2", "A3"]


def test_cal4_uplift_is_the_median_of_the_matched_comparables():
    rows = [activation(f"A{i}", uplift=u)
            for i, u in enumerate([10.0, 12.0, 20.0, 14.0, 16.0])]
    stats = cmp.uplift_statistics(rows)
    assert stats["uplift_pct_median"] == 14.0
    assert stats["n"] == 5


def test_cal4_percentiles_interpolate():
    values = [10.0, 20.0, 30.0, 40.0]
    assert cmp.percentile(values, 25.0) == pytest.approx(17.5)
    assert cmp.percentile(values, 50.0) == pytest.approx(25.0)
    assert cmp.percentile(values, 75.0) == pytest.approx(32.5)
    assert cmp.percentile([7.0], 25.0) == 7.0
    with pytest.raises(ValueError):
        cmp.percentile([], 50.0)


def test_cal5_fewer_than_two_matches_is_insufficient():
    assert cmp.sufficient([]) is False
    assert cmp.sufficient([activation("A1")]) is False
    assert cmp.sufficient([activation("A1"), activation("A2")]) is True


def test_adv4_season_mismatch_only_when_every_comparable_is_off_season():
    winter_request = 1
    autumn = [activation("A1", month=10), activation("A2", month=11)]
    assert cmp.season_mismatch(autumn, winter_request) is True
    mixed = autumn + [activation("A3", month=12)]
    assert cmp.season_mismatch(mixed, winter_request) is False
    assert cmp.season_mismatch([], winter_request) is False


def test_adv5_spend_scale_mismatch_below_half_and_above_double():
    small = [activation("A1", spend=10000), activation("A2", spend=12000)]
    assert cmp.spend_scale_mismatch(small, 80000.0) is True
    large = [activation("A1", spend=200000), activation("A2", spend=250000)]
    assert cmp.spend_scale_mismatch(large, 80000.0) is True
    fitting = [activation("A1", spend=70000), activation("A2", spend=90000)]
    assert cmp.spend_scale_mismatch(fitting, 80000.0) is False


def test_sibling_skus_are_same_market_and_need_state_other_brands():
    skus = [
        {"sku_id": "B-1", "brand_id": "B", "market": "BE", "need_state": "cough"},
        {"sku_id": "C-1", "brand_id": "C", "market": "BE", "need_state": "cough"},
        {"sku_id": "D-1", "brand_id": "D", "market": "DE", "need_state": "cough"},
        {"sku_id": "E-1", "brand_id": "E", "market": "BE", "need_state": "headache"},
    ]
    siblings = cmp.sibling_skus(skus, market="BE", need_state="cough",
                                exclude_brand_id="B")
    assert [s["sku_id"] for s in siblings] == ["C-1"]


def launch(lid, *, category="allergy", need_state="seasonal_allergy",
           population=84.4, actual=100000.0, forecast=115000.0):
    return {"launch_id": lid, "category": category, "need_state": need_state,
            "market_population_m": str(population),
            "actual_year1_units": str(actual),
            "forecast_year1_units": str(forecast), "market": "DE"}


def test_cal10_launch_matching_and_widening():
    rows = [launch("L1"), launch("L2"),
            launch("L3", population=6.6),                       # far too small
            launch("L4", category="pain")]                      # wrong category
    matched = cmp.match_launches(rows, category="allergy",
                                 need_state="seasonal_allergy",
                                 market_population_m=84.4)
    assert [r["launch_id"] for r in matched] == ["L1", "L2"]

    thin = [launch("L1"), launch("L5", need_state="eye_allergy")]
    widened = cmp.match_launches(thin, category="allergy",
                                 need_state="seasonal_allergy",
                                 market_population_m=84.4)
    assert [r["launch_id"] for r in widened] == ["L1", "L5"]


def test_forecast_track_record_is_a_figure_not_a_judgement():
    record = cmp.forecast_track_record([launch("L1"), launch("L2")])
    assert record["n"] == 2
    assert record["mean_forecast_to_actual_ratio"] == pytest.approx(1.15)
    assert cmp.forecast_track_record([])["mean_forecast_to_actual_ratio"] is None


def test_match_activations_on_the_real_dataset(ds):
    matched = cmp.match_activations(
        ds.activations, market="BE", mechanic="in_pharmacy_display",
        category="cold_flu", ap_request_eur=80000.0)
    assert len(matched) >= 4
    for row in matched:
        assert 48000.0 <= float(row["spend_eur"]) <= 112000.0
        assert row["market"] == "BE" and row["category"] == "cold_flu"
