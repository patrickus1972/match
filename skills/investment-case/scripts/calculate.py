"""Pure arithmetic for the investment case (CAL-1 .. CAL-12).

No I/O, no network, no rendering. Every figure that reaches a deck is produced
here. Values are returned unrounded; rounding happens at presentation (CAL-12).
"""

from __future__ import annotations

from dataclasses import dataclass, field

STATUS_OK = "OK"
STATUS_INSUFFICIENT = "INSUFFICIENT_COMPARABLES"
STATUS_MISSING = "REQUIRED_NOT_SUPPLIED"

DEPTHS = ("activation", "npi_rough", "npi_full")

REQUIRED_FIELDS = {
    "activation": ("brand_id", "market", "category", "need_state", "mechanic",
                   "period_start_month", "period_weeks", "ap_request_eur",
                   "net_price_eur", "contribution_margin_pct",
                   "base_rate_of_sale_units_week", "seasonality"),
    "npi_rough": ("market", "category", "need_state", "period_start_month",
                  "ap_request_eur", "net_price_eur", "contribution_margin_pct",
                  "market_population_m"),
    "npi_full": ("market", "category", "need_state", "period_start_month",
                 "ap_request_eur", "net_price_eur", "contribution_margin_pct",
                 "market_population_m"),
}

SCENARIO_WEEK_DELTA = {"low": -2, "base": 0, "high": 2}
RAMP_QUARTER_SHARES = (0.15, 0.22, 0.29, 0.34)   # CAL-10 ramp curve
NPI_YEAR_GROWTH = (1.0, 1.35, 1.55)              # CAL-11 years 1-3


@dataclass
class Sibling:
    """A SKU in the same market and need_state as the requested brand."""
    sku_id: str
    base_rate_of_sale_units_week: float
    cannibalisation_rate: float
    seasonality_index: float


@dataclass
class CaseInputs:
    depth: str
    brand_id: str | None = None
    brand_name: str | None = None
    market: str | None = None
    category: str | None = None
    need_state: str | None = None
    mechanic: str | None = None
    period_start_month: int | None = None
    period_weeks: int | None = None
    ap_request_eur: float | None = None
    net_price_eur: float | None = None
    cogs_eur: float | None = None
    contribution_margin_pct: float | None = None
    base_rate_of_sale_units_week: float | None = None
    seasonality: list[float] | None = None
    market_population_m: float | None = None
    concept_name: str | None = None
    siblings: list[Sibling] = field(default_factory=list)
    siblings_available: bool = True


def missing_required(inputs: CaseInputs) -> list[str]:
    """GRD-2: name every required field that was not supplied."""
    if inputs.depth not in DEPTHS:
        return ["depth"]
    absent = []
    for name in REQUIRED_FIELDS[inputs.depth]:
        value = getattr(inputs, name, None)
        if value is None or (isinstance(value, str) and not value.strip()):
            absent.append(name)
    return absent


def seasonality_index(seasonality: list[float], month: int) -> float:
    if not seasonality or len(seasonality) != 12:
        raise ValueError("seasonality must hold 12 monthly indices")
    if not 1 <= month <= 12:
        raise ValueError("month must be 1..12")
    return float(seasonality[month - 1])


def baseline_units(base_rate_of_sale_units_week: float, period_weeks: float,
                   season_index: float) -> float:
    """CAL-2."""
    return base_rate_of_sale_units_week * period_weeks * season_index


def incremental_units(baseline: float, uplift_pct: float) -> float:
    return baseline * (uplift_pct / 100.0)


def cannibalised_units(siblings: list[Sibling], period_weeks: float) -> float:
    """CAL-6: sum over sibling SKUs of sibling_baseline x cannibalisation_rate."""
    total = 0.0
    for sib in siblings:
        sib_baseline = baseline_units(sib.base_rate_of_sale_units_week,
                                      period_weeks, sib.seasonality_index)
        total += sib_baseline * sib.cannibalisation_rate
    return total


def gross_profit_eur(incremental: float, cannibalised: float,
                     net_price_eur: float, contribution_margin_pct: float) -> float:
    """CAL-7."""
    return (incremental - cannibalised) * net_price_eur * contribution_margin_pct


def gp_per_ap_euro(gross_profit: float, ap_request_eur: float) -> float:
    """CAL-8."""
    if ap_request_eur == 0:
        raise ValueError("ap_request_eur must be non-zero")
    return gross_profit / ap_request_eur


def break_even_uplift_pct(inputs: CaseInputs, cannibalised: float,
                          baseline: float) -> float:
    """Uplift at which gross profit exactly repays the A&P request."""
    unit_gp = inputs.net_price_eur * inputs.contribution_margin_pct
    units_needed = (inputs.ap_request_eur / unit_gp) + cannibalised
    return (units_needed / baseline) * 100.0


def _activation_scenario(inputs: CaseInputs, name: str, uplift_pct: float) -> dict:
    weeks = max(1, inputs.period_weeks + SCENARIO_WEEK_DELTA[name])
    season = seasonality_index(inputs.seasonality, inputs.period_start_month)
    baseline = baseline_units(inputs.base_rate_of_sale_units_week, weeks, season)
    incr = incremental_units(baseline, uplift_pct)
    canni = cannibalised_units(inputs.siblings, weeks)
    gp = gross_profit_eur(incr, canni, inputs.net_price_eur,
                          inputs.contribution_margin_pct)
    return {
        "scenario": name,
        "period_weeks": weeks,
        "uplift_pct": uplift_pct,
        "seasonality_index": season,
        "baseline_units": baseline,
        "incremental_units": incr,
        "cannibalised_units": canni,
        "net_incremental_units": incr - canni,
        "gross_profit_eur": gp,
        "gp_per_ap_euro": gp_per_ap_euro(gp, inputs.ap_request_eur),
        "above_break_even": gp >= inputs.ap_request_eur,
    }


def calculate_activation(inputs: CaseInputs, uplift_stats: dict) -> dict:
    """CAL-2, CAL-6 .. CAL-9 for an activation or campaign case."""
    scenarios = {
        "low": _activation_scenario(inputs, "low", uplift_stats["uplift_pct_p25"]),
        "base": _activation_scenario(inputs, "base", uplift_stats["uplift_pct_median"]),
        "high": _activation_scenario(inputs, "high", uplift_stats["uplift_pct_p75"]),
    }
    base = scenarios["base"]
    return {
        "status": STATUS_OK,
        "depth": inputs.depth,
        "scenarios": scenarios,
        "base_case": base,
        "break_even_uplift_pct": break_even_uplift_pct(
            inputs, base["cannibalised_units"], base["baseline_units"]),
        "cannibalisation_included": bool(inputs.siblings),
        "sibling_data_available": inputs.siblings_available,
        "comparables_used": uplift_stats["n"],
    }


def _ramp_units(year1_units: float) -> list[float]:
    total = sum(RAMP_QUARTER_SHARES)
    return [year1_units * share / total for share in RAMP_QUARTER_SHARES]


def _percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (pct / 100.0) * (len(ordered) - 1)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return float(ordered[low] + (ordered[high] - ordered[low]) * (rank - low))


def npi_year1_units(analogues: list[dict], market_population_m: float) -> float:
    """CAL-10: median of analogue launches, size-adjusted to the target market."""
    scaled = []
    for row in analogues:
        analogue_pop = float(row["market_population_m"])
        if analogue_pop <= 0:
            continue
        scaled.append(float(row["actual_year1_units"])
                      * (market_population_m / analogue_pop))
    if not scaled:
        raise ValueError("no analogue launches supplied")
    ordered = sorted(scaled)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def calculate_npi(inputs: CaseInputs, analogues: list[dict]) -> dict:
    """CAL-10 (rough) and CAL-11 (full: years 1-3 and payback)."""
    year1 = npi_year1_units(analogues, inputs.market_population_m)
    unit_gp = inputs.net_price_eur * inputs.contribution_margin_pct
    quarters = _ramp_units(year1)

    years = []
    for index, growth in enumerate(NPI_YEAR_GROWTH, start=1):
        units = year1 * growth
        years.append({
            "year": index,
            "units": units,
            "gross_profit_eur": units * unit_gp,
        })

    result = {
        "status": STATUS_OK,
        "depth": inputs.depth,
        "analogues_used": len(analogues),
        "year1_units": year1,
        "year1_gross_profit_eur": year1 * unit_gp,
        "year1_quarter_units": quarters,
        "gp_per_ap_euro": gp_per_ap_euro(year1 * unit_gp, inputs.ap_request_eur),
        "unit_gross_profit_eur": unit_gp,
    }

    scaled = [float(row["actual_year1_units"])
              * (inputs.market_population_m / float(row["market_population_m"]))
              for row in analogues if float(row["market_population_m"]) > 0]
    result["scenarios"] = {
        name: _npi_scenario(name, _percentile(scaled, pct), unit_gp,
                            inputs.ap_request_eur)
        for name, pct in (("low", 25.0), ("base", 50.0), ("high", 75.0))
    }

    if inputs.depth == "npi_full":
        result["years"] = years
        result["cumulative_gross_profit_eur"] = sum(y["gross_profit_eur"] for y in years)
        result["payback_months"] = payback_months(years, inputs.ap_request_eur)
    else:
        result["years"] = years[:1]
    return result


def _npi_scenario(name: str, year1_units: float, unit_gp: float,
                  ap_request_eur: float) -> dict:
    gross = year1_units * unit_gp
    return {
        "scenario": name,
        "year1_units": year1_units,
        "gross_profit_eur": gross,
        "gp_per_ap_euro": gp_per_ap_euro(gross, ap_request_eur),
        "above_break_even": gross >= ap_request_eur,
    }


def payback_months(years: list[dict], investment_eur: float) -> float | None:
    """CAL-11: months until cumulative gross profit repays the investment."""
    cumulative = 0.0
    for entry in years:
        monthly = entry["gross_profit_eur"] / 12.0
        if monthly <= 0:
            continue
        if cumulative + entry["gross_profit_eur"] >= investment_eur:
            remaining = investment_eur - cumulative
            months_into_year = remaining / monthly
            return (entry["year"] - 1) * 12.0 + months_into_year
        cumulative += entry["gross_profit_eur"]
    return None


def run_case(inputs: CaseInputs, *, uplift_stats: dict | None = None,
             analogues: list[dict] | None = None) -> dict:
    """Single entry point. Halts on missing inputs (GRD-2) or thin history (CAL-5)."""
    absent = missing_required(inputs)
    if absent:
        return {"status": STATUS_MISSING, "depth": inputs.depth,
                "missing_fields": absent}

    if inputs.depth == "activation":
        if uplift_stats is None or uplift_stats["n"] < 2:
            return {"status": STATUS_INSUFFICIENT, "depth": inputs.depth,
                    "comparables_used": 0 if uplift_stats is None else uplift_stats["n"]}
        return calculate_activation(inputs, uplift_stats)

    if not analogues or len(analogues) < 2:
        return {"status": STATUS_INSUFFICIENT, "depth": inputs.depth,
                "comparables_used": 0 if not analogues else len(analogues)}
    return calculate_npi(inputs, analogues)
