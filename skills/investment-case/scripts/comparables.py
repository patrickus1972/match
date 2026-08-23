"""Matching, medians and percentiles (CAL-3, CAL-4, CAL-5).

Pure functions over already-loaded rows. No I/O, no network.
"""

from __future__ import annotations

from statistics import median as _median

SPEND_TOLERANCE = 0.40          # CAL-3: +/- 40%
MIN_COMPARABLES = 2             # CAL-5
SEASON_OF_MONTH = {
    1: "winter", 2: "winter", 12: "winter",
    3: "spring", 4: "spring", 5: "spring",
    6: "summer", 7: "summer", 8: "summer",
    9: "autumn", 10: "autumn", 11: "autumn",
}
LAUNCH_SIZE_BAND = (0.25, 4.0)  # CAL-10: "comparable market size"


def percentile(values: list[float], pct: float) -> float:
    """Linear-interpolation percentile. pct in [0, 100]."""
    if not values:
        raise ValueError("percentile of an empty sequence")
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (pct / 100.0) * (len(ordered) - 1)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    frac = rank - low
    return float(ordered[low] + (ordered[high] - ordered[low]) * frac)


def median(values: list[float]) -> float:
    return float(_median(values))


def match_activations(activations: list[dict], *, market: str, mechanic: str,
                      category: str, ap_request_eur: float,
                      spend_tolerance: float = SPEND_TOLERANCE) -> list[dict]:
    """CAL-3: same market, same mechanic, same category, spend within +/-40%."""
    low = ap_request_eur * (1.0 - spend_tolerance)
    high = ap_request_eur * (1.0 + spend_tolerance)
    matched = [
        row for row in activations
        if row["market"] == market
        and row["mechanic"] == mechanic
        and row["category"] == category
        and low <= float(row["spend_eur"]) <= high
    ]
    return sorted(matched, key=lambda r: r["activation_id"])


def uplift_statistics(comparables: list[dict]) -> dict:
    """CAL-4: median uplift, plus the P25/P75 used by the scenarios (CAL-9)."""
    values = [float(r["measured_uplift_pct"]) for r in comparables]
    return {
        "n": len(values),
        "uplift_pct_p25": percentile(values, 25.0),
        "uplift_pct_median": median(values),
        "uplift_pct_p75": percentile(values, 75.0),
        "uplift_values_pct": values,
    }


def sufficient(comparables: list[dict]) -> bool:
    """CAL-5: fewer than two matches means no forecast may be produced."""
    return len(comparables) >= MIN_COMPARABLES


def season_mismatch(comparables: list[dict], request_month: int) -> bool:
    """ADV-4: every comparable ran in a different season than the request."""
    if not comparables:
        return False
    wanted = SEASON_OF_MONTH[request_month]
    return all(SEASON_OF_MONTH[int(r["start_month"])] != wanted for r in comparables)


def spend_scale_mismatch(comparables: list[dict], ap_request_eur: float) -> bool:
    """ADV-5: comparables sit below half or above double the requested spend."""
    if not comparables:
        return False
    spends = [float(r["spend_eur"]) for r in comparables]
    mid = median(spends)
    return mid < ap_request_eur * 0.5 or mid > ap_request_eur * 2.0


def sibling_skus(skus: list[dict], *, market: str, need_state: str,
                 exclude_brand_id: str) -> list[dict]:
    """A SKU in the same market and need_state as the requested brand."""
    return sorted(
        [s for s in skus
         if s["market"] == market
         and s["need_state"] == need_state
         and s["brand_id"] != exclude_brand_id],
        key=lambda s: s["sku_id"],
    )


def match_launches(launches: list[dict], *, category: str, need_state: str,
                   market_population_m: float,
                   size_band: tuple[float, float] = LAUNCH_SIZE_BAND) -> list[dict]:
    """CAL-10: analogues on category, need_state and comparable market size."""
    low = market_population_m * size_band[0]
    high = market_population_m * size_band[1]
    matched = [
        row for row in launches
        if row["category"] == category
        and row["need_state"] == need_state
        and low <= float(row["market_population_m"]) <= high
    ]
    if len(matched) < MIN_COMPARABLES:
        # Widen to the category when the need_state cell is thin; the widening
        # is reported in the calculation file so the deck can disclose it.
        matched = [
            row for row in launches
            if row["category"] == category
            and low <= float(row["market_population_m"]) <= high
        ]
    return sorted(matched, key=lambda r: r["launch_id"])


def forecast_track_record(launches: list[dict]) -> dict:
    """ADV-7: report the track record as a figure only, never as a judgement."""
    ratios = [float(r["forecast_year1_units"]) / float(r["actual_year1_units"])
              for r in launches if float(r["actual_year1_units"]) > 0]
    if not ratios:
        return {"n": 0, "mean_forecast_to_actual_ratio": None}
    return {"n": len(ratios),
            "mean_forecast_to_actual_ratio": sum(ratios) / len(ratios)}
