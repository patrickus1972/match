"""Read-only access to the reference CSVs, and assembly of a calculation record.

This module owns all file reading. `calculate.py` stays pure; this module hands
it plain values and collects the result into the machine-readable calculation
record that `render_deck.py` later turns into a deck (OUT-2).
"""

from __future__ import annotations

import csv
from dataclasses import asdict
from pathlib import Path

import calculate as calc
import comparables as cmp

DATA_DIR = Path(__file__).resolve().parent.parent / "reference" / "data"

DISCLAIMER = "SYNTHETIC DEMO DATA — NOT STADA FIGURES"


class UnknownReference(ValueError):
    """GRD-3: the request names something that is not in the reference data."""


class OutOfScope(ValueError):
    """GRD-5: the request is outside what this skill covers."""


OUT_OF_SCOPE_TOPICS = {
    "claims": "claim wording and substantiation",
    "creative": "creative execution and copy",
    "regulatory": "regulatory or medical review",
    "media_planning": "media planning and buying",
}


def _opt_float(value) -> float | None:
    """Keep a missing value missing so GRD-2 can name it, rather than crashing."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return float(value)


def _opt_int(value) -> int | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return int(value)


# ADV-6: the skill never recommends. These are the shapes the question takes.
RECOMMENDATION_ASKS = (
    "should i approve", "should we approve", "should i fund", "should we fund",
    "would you approve", "do you recommend", "what do you recommend",
    "should i reject", "should we reject", "is this worth funding",
    "which should i prioritise", "which should i prioritize",
    "would you sign this off", "should i sign this off",
)

DECLINE_TEXT = (
    "That decision is the gate's, not mine — I build the case, I do not take a "
    "position on it. What the case shows is the base figure, the range around "
    "it, and the level of uplift at which it repays the A&P. Those three, plus "
    "anything flagged above, are what the decision rests on."
)


def is_recommendation_request(text: str) -> bool:
    """True when the user is asking for a verdict rather than a case."""
    asked = (text or "").lower()
    return any(phrase in asked for phrase in RECOMMENDATION_ASKS)


# --------------------------------------------------------------------------
# Plain-language resolution
#
# A brand manager writes "six-week display in Belgium", not
# "mechanic=in_pharmacy_display, market=BE". These maps turn the words people
# actually use into the codes the reference data holds. Anything that cannot be
# resolved is refused and the options are listed — never guessed at (GRD-3).
# --------------------------------------------------------------------------

MECHANIC_WORDS = {
    "display": "in_pharmacy_display",
    "in pharmacy display": "in_pharmacy_display",
    "pharmacy display": "in_pharmacy_display",
    "shelf display": "in_pharmacy_display",
    "pos": "in_pharmacy_display",
    "pos action": "in_pharmacy_display",
    "pharmacist incentive": "pharmacist_incentive",
    "pharmacist bonus": "pharmacist_incentive",
    "staff incentive": "pharmacist_incentive",
    "sampling": "sampling",
    "samples": "sampling",
    "trial": "sampling",
    "digital": "digital_awareness",
    "digital awareness": "digital_awareness",
    "online campaign": "digital_awareness",
    "social": "digital_awareness",
    "awareness campaign": "digital_awareness",
    "retail media": "retail_media",
    "amazon ads": "retail_media",
    "ecommerce media": "retail_media",
    "tv": "tv_burst",
    "tv burst": "tv_burst",
    "tv campaign": "tv_burst",
    "atl": "tv_burst",
    "hcp": "hcp_detailing",
    "detailing": "hcp_detailing",
    "hcp detailing": "hcp_detailing",
    "cycle meeting": "hcp_detailing",
    "price promo": "price_promo",
    "price promotion": "price_promo",
    "promotion": "price_promo",
    "trade promo": "price_promo",
    "discount": "price_promo",
}

CATEGORY_WORDS = {
    "cold": "cold_flu", "flu": "cold_flu", "cold flu": "cold_flu",
    "cold and flu": "cold_flu", "cough and cold": "cold_flu",
    "respiratory": "cold_flu", "cough": "cold_flu",
    "allergy": "allergy", "hayfever": "allergy", "hay fever": "allergy",
    "antihistamine": "allergy",
    "pain": "pain", "analgesic": "pain", "painkiller": "pain",
    "pain relief": "pain",
    "digestive": "digestive", "gut": "digestive", "stomach": "digestive",
    "gastro": "digestive", "heartburn": "digestive",
    "vitamins": "vitamins", "vms": "vitamins", "supplements": "vitamins",
    "vitamin": "vitamins", "immunity": "vitamins",
    "skin": "skin", "derma": "skin", "dermo": "skin", "skincare": "skin",
    "wound care": "skin",
}

MARKET_WORDS = {
    "belgium": "BE", "belgie": "BE", "belgië": "BE", "belgique": "BE", "be": "BE",
    "germany": "DE", "deutschland": "DE", "duitsland": "DE", "de": "DE",
    "poland": "PL", "polska": "PL", "polen": "PL", "pl": "PL",
    "serbia": "RS", "srbija": "RS", "servie": "RS", "rs": "RS",
}

DEPTH_WORDS = {
    "activation": "activation", "campaign": "activation", "promo": "activation",
    "promotion": "activation", "display": "activation", "burst": "activation",
    "npi": "npi_rough", "npd": "npi_rough", "npd pipeline": "npi_rough",
    "pipeline": "npi_rough", "new product": "npi_rough", "innovation": "npi_rough",
    "ideation": "npi_rough", "idea screening": "npi_rough",
    "g1": "npi_rough", "gate 1": "npi_rough", "rough": "npi_rough",
    "g3": "npi_full", "gate 3": "npi_full", "stage gate 3": "npi_full",
    "sg3": "npi_full", "full case": "npi_full", "launch case": "npi_full",
}


def _norm(text: str) -> str:
    return " ".join(str(text or "").lower().replace("_", " ").replace("-", " ").split())


def _lookup(text: str, words: dict, known: set) -> str | None:
    key = _norm(text)
    if not key:
        return None
    if key.replace(" ", "_") in known:
        return key.replace(" ", "_")
    if key.upper() in known:
        return key.upper()
    if key in words:
        return words[key]
    # longest phrase that appears in the text wins, so "in-pharmacy display in
    # Belgium" resolves before "display" does.
    hits = [(len(phrase), code) for phrase, code in words.items() if phrase in key]
    return max(hits)[1] if hits else None


def depth_from_text(text: str) -> str | None:
    """INT-6: route the request to a depth from how it is phrased."""
    key = _norm(text)
    hits = [(len(phrase), depth) for phrase, depth in DEPTH_WORDS.items()
            if phrase in key]
    return max(hits)[1] if hits else None


def _read(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


class Dataset:
    def __init__(self, data_dir: Path = DATA_DIR):
        self.data_dir = Path(data_dir)
        self.markets = _read(self.data_dir / "markets.csv")
        self.brands = _read(self.data_dir / "brands.csv")
        self.skus = _read(self.data_dir / "skus.csv")
        self.mechanics = _read(self.data_dir / "mechanics.csv")
        self.activations = _read(self.data_dir / "activations.csv")
        self.launches = _read(self.data_dir / "launches.csv")
        self.competitors = _read(self.data_dir / "competitors.csv")

    # -- lookups ----------------------------------------------------------
    def brand(self, brand_ref: str) -> dict:
        """GRD-3: never invent a brand. Unknown references are refused."""
        key = (brand_ref or "").strip().lower()
        for row in self.brands:
            if key in (row["brand_id"].lower(), row["brand_name"].lower()):
                return row
        raise UnknownReference(
            f"'{brand_ref}' is not in the reference data. "
            "No figures can be produced for a brand that is not listed.")

    def market(self, market_id: str) -> dict:
        known = {row["market_id"] for row in self.markets}
        code = _lookup(market_id, MARKET_WORDS, known)
        for row in self.markets:
            if row["market_id"] == code:
                return row
        raise UnknownReference(
            f"'{market_id}' is not one of the demo markets. Known markets: "
            + ", ".join(f"{r['market_id']} ({r['market_name']})"
                        for r in self.markets))

    def mechanic(self, mechanic_id: str) -> dict:
        known = {row["mechanic_id"] for row in self.mechanics}
        code = _lookup(mechanic_id, MECHANIC_WORDS, known)
        for row in self.mechanics:
            if row["mechanic_id"] == code:
                return row
        raise UnknownReference(
            f"'{mechanic_id}' is not a known mechanic. Known mechanics: "
            + ", ".join(f"{m['mechanic_id']} ({m['mechanic_name']})"
                        for m in self.mechanics))

    def category(self, category: str) -> str:
        known = {row["category"] for row in self.brands}
        code = _lookup(category, CATEGORY_WORDS, known)
        if code in known:
            return code
        raise UnknownReference(
            f"'{category}' is not a category in the reference data. Known "
            "categories: " + ", ".join(sorted(known)))

    def need_state(self, category: str, need_state: str) -> str:
        known = {row["need_state"] for row in self.brands
                 if row["category"] == category}
        if not need_state:
            raise UnknownReference(
                f"which need state within {category}? " + ", ".join(sorted(known)))
        key = _norm(need_state).replace(" ", "_")
        if key in known:
            return key
        near = [n for n in sorted(known) if key in n or n in key]
        if len(near) == 1:
            return near[0]
        raise UnknownReference(
            f"'{need_state}' is not a need state in {category}. Known need "
            "states: " + ", ".join(sorted(known)))

    def options(self) -> dict:
        """What the Skill can offer when a request names something unknown."""
        pairs = sorted({(r["category"], r["need_state"]) for r in self.brands})
        return {
            "markets": [f"{r['market_id']} ({r['market_name']})"
                        for r in self.markets],
            "mechanics": [f"{m['mechanic_id']} ({m['mechanic_name']})"
                          for m in self.mechanics],
            "categories": sorted({c for c, _ in pairs}),
            "need_states": [f"{c} / {n}" for c, n in pairs],
            "brands": [f"{b['brand_id']} {b['brand_name']} — {b['market']}, "
                       f"{b['category']}, {b['need_state']}" for b in self.brands],
        }

    def seasonality(self, brand_row: dict) -> list[float]:
        return [float(brand_row[f"seasonality_m{m}"]) for m in range(1, 13)]

    def category_seasonality(self, market: str, category: str) -> list[float]:
        for row in self.brands:
            if row["category"] == category:
                return self.seasonality(row)
        raise UnknownReference(f"no seasonality on file for category '{category}'")


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------

def build_inputs(ds: Dataset, request: dict) -> calc.CaseInputs:
    """Turn a resolved request into calculation inputs (INT-2: infer from data)."""
    depth = request.get("depth", "activation")

    if depth == "activation":
        brand = ds.brand(request["brand"])
        seasonality = ds.seasonality(brand)
        month = _opt_int(request.get("period_start_month"))
        season_index = (calc.seasonality_index(seasonality, month)
                        if month is not None else 1.0)
        sibling_rows = cmp.sibling_skus(
            ds.skus, market=brand["market"], need_state=brand["need_state"],
            exclude_brand_id=brand["brand_id"])
        siblings = [
            calc.Sibling(
                sku_id=row["sku_id"],
                base_rate_of_sale_units_week=float(row["base_rate_of_sale_units_week"]),
                cannibalisation_rate=float(row["cannibalisation_rate"]),
                seasonality_index=season_index,
            )
            for row in sibling_rows
        ]
        return calc.CaseInputs(
            depth=depth,
            brand_id=brand["brand_id"],
            brand_name=brand["brand_name"],
            market=brand["market"],
            category=brand["category"],
            need_state=brand["need_state"],
            mechanic=(ds.mechanic(request["mechanic"])["mechanic_id"]
                      if request.get("mechanic") else None),
            period_start_month=month,
            period_weeks=_opt_int(request.get("period_weeks")),
            ap_request_eur=_opt_float(request.get("ap_request_eur")),
            # GRD-1: price, CM and rate of sale come from brands.csv only.
            net_price_eur=float(brand["net_price_eur"]),
            cogs_eur=float(brand["cogs_eur"]),
            contribution_margin_pct=_override_cm(request, brand),
            base_rate_of_sale_units_week=float(brand["base_rate_of_sale_units_week"]),
            seasonality=seasonality,
            market_population_m=float(ds.market(brand["market"])["population_m"]),
            siblings=siblings,
            siblings_available=bool(sibling_rows),
        )

    market = ds.market(request["market"])
    category = ds.category(request["category"])
    need_state = ds.need_state(category, request.get("need_state"))
    reference = next((b for b in ds.brands
                      if b["category"] == category and b["need_state"] == need_state),
                     None)
    if reference is None:
        raise UnknownReference(
            f"no reference pricing on file for {category} / {need_state}.")
    return calc.CaseInputs(
        depth=depth,
        brand_id=None,
        brand_name=None,
        concept_name=request.get("concept_name", "New product concept"),
        market=market["market_id"],
        category=category,
        need_state=need_state,
        period_start_month=_opt_int(request.get("period_start_month")) or 1,
        period_weeks=_opt_int(request.get("period_weeks")) or 52,
        ap_request_eur=_opt_float(request.get("ap_request_eur")),
        net_price_eur=_opt_float(request.get("net_price_eur")
                                 or reference["net_price_eur"]),
        contribution_margin_pct=_override_cm(request, reference),
        market_population_m=float(market["population_m"]),
        siblings=[],
        siblings_available=False,
    )


def _override_cm(request: dict, brand_row: dict) -> float:
    """INT-5: the user may correct the CM; the correction is recorded as such."""
    if request.get("contribution_margin_pct") is not None:
        return float(request["contribution_margin_pct"])
    return float(brand_row["contribution_margin_pct"])


def advisories(result: dict, inputs: calc.CaseInputs, matched: list[dict],
               request: dict) -> list[dict]:
    """ADV-1 .. ADV-5, enforced in code so they hold without SKILL.md (GRD-4)."""
    notes: list[dict] = []

    if result["status"] == calc.STATUS_INSUFFICIENT:
        notes.append({
            "code": "INSUFFICIENT_COMPARABLES",
            "requirement": "ADV-1",
            "text": ("Fewer than two past activations match this brand, market, "
                     "mechanic and spend level, so no uplift can be read from "
                     "history. No forecast is shown."),
        })
        return notes

    if result["status"] != calc.STATUS_OK:
        return notes

    if inputs.depth == "activation":
        if not inputs.siblings:
            notes.append({
                "code": "CANNIBALISATION_OMITTED",
                "requirement": "ADV-2",
                "text": ("No other SKU in this market shares the need state, so "
                         "no cannibalisation has been deducted. The volume shown "
                         "is gross of any switching from your own portfolio."),
            })
        base_case = result["base_case"]
        if base_case["cannibalised_units"] > base_case["incremental_units"]:
            notes.append({
                "code": "CANNIBALISATION_DOMINATES",
                "requirement": "AT-4",
                "text": ("More volume is lost from other SKUs in this need state "
                         "than the activation is expected to add, so the net "
                         "effect on gross profit is negative."),
            })
        low = result["scenarios"]["low"]
        base = result["scenarios"]["base"]
        if not low["above_break_even"] and base["above_break_even"]:
            notes.append({
                "code": "LOW_BELOW_BREAK_EVEN",
                "requirement": "ADV-3",
                "text": ("In the low scenario the case does not repay the A&P "
                         "request. The base case does. The gap between them is "
                         "the range of measured results in the comparables."),
            })
        if cmp.season_mismatch(matched, inputs.period_start_month):
            notes.append({
                "code": "SEASON_MISMATCH",
                "requirement": "ADV-4",
                "text": ("Every comparable ran in a different season than the "
                         "period requested. The match can be widened to other "
                         "periods if that is more representative."),
            })
        if cmp.spend_scale_mismatch(matched, inputs.ap_request_eur):
            notes.append({
                "code": "SPEND_SCALE_MISMATCH",
                "requirement": "ADV-5",
                "text": ("The comparables sit at less than half or more than "
                         "double the spend requested here, so the uplift they "
                         "show may not carry across at this budget."),
            })
    return notes


def assumptions(inputs: calc.CaseInputs, result: dict, matched: list[dict],
                request: dict) -> list[dict]:
    """OUT-9: every assumption carries a source and an owner."""
    rows = [
        {"assumption": "Net price per unit",
         "value": f"EUR {inputs.net_price_eur:,.2f}",
         "source": "brands.csv (synthetic)", "owner": "Brand manager"},
        {"assumption": "Contribution margin",
         "value": f"{inputs.contribution_margin_pct * 100:,.1f}%",
         "source": ("user correction" if request.get("contribution_margin_pct")
                    else "brands.csv (synthetic)"),
         "owner": "CHC Controlling"},
    ]
    if inputs.depth == "activation":
        rows += [
            {"assumption": "Baseline rate of sale",
             "value": f"{inputs.base_rate_of_sale_units_week:,.1f} units/week",
             "source": "brands.csv (synthetic)", "owner": "Demand planning"},
            {"assumption": "Seasonality index for the period",
             "value": f"{result['base_case']['seasonality_index']:.3f}",
             "source": "brands.csv seasonality curve", "owner": "Demand planning"},
            {"assumption": "Uplift",
             "value": f"{result['base_case']['uplift_pct']:.1f}% (median of "
                      f"{len(matched)} comparables)",
             "source": "activations.csv (synthetic)", "owner": "Brand manager"},
            {"assumption": "Cannibalisation",
             "value": (f"{result['base_case']['cannibalised_units']:,.0f} units "
                       f"across {len(inputs.siblings)} sibling SKUs"
                       if inputs.siblings else "not deducted — no sibling SKUs"),
             "source": "skus.csv cannibalisation_rate", "owner": "Brand manager"},
            {"assumption": "A&P request",
             "value": f"EUR {inputs.ap_request_eur:,.0f}",
             "source": "the request", "owner": "Brand manager"},
        ]
    else:
        rows += [
            {"assumption": "Year 1 volume",
             "value": f"{result['year1_units']:,.0f} units "
                      f"(median of {result['analogues_used']} analogue launches)",
             "source": "launches.csv (synthetic)", "owner": "Brand manager"},
            {"assumption": "Ramp curve",
             "value": "15 / 22 / 29 / 34% across quarters 1-4",
             "source": "launches.csv ramp shape", "owner": "Demand planning"},
            {"assumption": "Launch investment",
             "value": f"EUR {inputs.ap_request_eur:,.0f}",
             "source": "the request", "owner": "Brand manager"},
        ]
    return rows


def assemble(ds: Dataset, request: dict) -> dict:
    """Produce the full calculation record. This is the only source for a deck."""
    _guard_scope(request)
    inputs = build_inputs(ds, request)

    matched: list[dict] = []
    uplift_stats = None
    analogues: list[dict] = []

    # GRD-2: halt before any matching when a required input is absent, so the
    # deck can name the field rather than the run failing.
    absent = calc.missing_required(inputs)
    if absent:
        result = calc.run_case(inputs)
    elif inputs.depth == "activation":
        matched = cmp.match_activations(
            ds.activations, market=inputs.market, mechanic=inputs.mechanic,
            category=inputs.category, ap_request_eur=inputs.ap_request_eur)
        if cmp.sufficient(matched):
            uplift_stats = cmp.uplift_statistics(matched)
        else:
            uplift_stats = {"n": len(matched)}
        result = calc.run_case(inputs, uplift_stats=uplift_stats)
    else:
        analogues = cmp.match_launches(
            ds.launches, category=inputs.category, need_state=inputs.need_state,
            market_population_m=inputs.market_population_m)
        result = calc.run_case(inputs, analogues=analogues)

    record = {
        "schema_version": "1.0",
        "disclaimer": DISCLAIMER,
        "case_id": request.get("case_id", "CASE-0001"),
        "case_title": request.get("case_title") or _default_title(inputs),
        "requested_by": request.get("requested_by", "Brand manager"),
        "request_text": request.get("request_text", ""),
        "depth": inputs.depth,
        "inputs": _serialisable_inputs(inputs),
        "comparables": matched,
        "analogues": analogues,
        "uplift_statistics": uplift_stats if inputs.depth == "activation" else None,
        "result": result,
        "advisories": advisories(result, inputs, matched, request),
        "forecast_track_record": cmp.forecast_track_record(ds.launches),
        "assumptions": (assumptions(inputs, result, matched, request)
                        if result["status"] == calc.STATUS_OK else []),
        "check_back": {
            "measure": ("Sell-out units versus the baseline over the activation "
                        "period and the four weeks after it"
                        if inputs.depth == "activation"
                        else "Year 1 sell-out units versus the forecast"),
            "owner": "Brand manager",
            "date": request.get("check_back_date", "agreed at approval"),
        },
    }
    return record


def _guard_scope(request: dict) -> None:
    """GRD-5: refuse work outside the investment-case boundary."""
    asked = (request.get("request_text") or "").lower()
    triggers = {
        "claim": "claims",
        "creative": "creative",
        "copywriting": "creative",
        "storyboard": "creative",
        "regulatory": "regulatory",
        "mdeon": "regulatory",
        "media plan": "media_planning",
        "media buying": "media_planning",
    }
    for word, topic in triggers.items():
        if word in asked:
            raise OutOfScope(
                f"This skill builds investment cases. It does not cover "
                f"{OUT_OF_SCOPE_TOPICS[topic]}.")


def _default_title(inputs: calc.CaseInputs) -> str:
    if inputs.depth == "activation":
        return f"{inputs.brand_name} — {inputs.mechanic.replace('_', ' ')}"
    return f"{inputs.concept_name} — {inputs.market}"


def _serialisable_inputs(inputs: calc.CaseInputs) -> dict:
    data = asdict(inputs)
    data["siblings"] = [asdict(s) if not isinstance(s, dict) else s
                        for s in data.get("siblings", [])]
    return data
