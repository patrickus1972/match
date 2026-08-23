"""Seeded generation of the synthetic reference dataset (DAT-1 .. DAT-11).

Writes seven CSVs to skills/investment-case/reference/data/.

Every value is derived from the seed and from the deterministic tables below,
so two runs with the same seed produce byte-identical files (DAT-1).

No STADA data is used anywhere. All brand names are invented and are checked
against reference/brand_blocklist.txt by tests/test_data.py (DAT-11).
"""

from __future__ import annotations

import argparse
import csv
import math
import random
from pathlib import Path

SEED = 20260823

# Units per week per million people, before the category and size factors.
# Calibrated so that a typical activation lands in the 0.6x-2.8x gross profit
# per euro of A&P band a brand manager would recognise.
ROS_MULTIPLIER = 1450.0

DATA_DIR = Path(__file__).resolve().parent.parent / "reference" / "data"

# --------------------------------------------------------------------------
# Deterministic reference tables
# --------------------------------------------------------------------------

MARKETS = [
    # market_id, market_name, population_m, price_index, pharmacies
    ("BE", "Belgium", 11.7, 1.08, 4900),
    ("DE", "Germany", 84.4, 1.00, 17500),
    ("PL", "Poland", 36.7, 0.72, 12800),
    ("RS", "Serbia", 6.6, 0.61, 2100),
]

# category -> (need_states, peak_month, seasonal_amplitude, price_eur,
#              cm_pct, ros_index)
CATEGORIES = {
    "cold_flu": (["cough", "nasal_congestion", "sore_throat"], 1, 0.55, 8.40, 0.62, 1.40),
    "allergy": (["seasonal_allergy", "eye_allergy"], 5, 0.45, 11.20, 0.66, 0.80),
    "pain": (["headache", "muscle_pain"], 11, 0.12, 6.90, 0.58, 1.55),
    "digestive": (["heartburn", "gut_health"], 12, 0.18, 12.60, 0.64, 0.95),
    "vitamins": (["immunity", "energy"], 11, 0.30, 14.80, 0.70, 1.10),
    "skin": (["dry_skin", "wound_care"], 7, 0.22, 9.70, 0.60, 0.85),
}
CATEGORY_ORDER = list(CATEGORIES)

# mechanic_id, name, channel, typical_weeks, base_uplift_pct, uplift_spread
MECHANICS = [
    ("in_pharmacy_display", "In-pharmacy display", "pharmacy", 6, 14.0, 5.0),
    ("pharmacist_incentive", "Pharmacist incentive", "pharmacy", 8, 11.0, 4.0),
    ("sampling", "Sampling", "pharmacy", 4, 8.0, 3.5),
    ("digital_awareness", "Digital awareness", "digital", 8, 9.0, 6.5),
    ("retail_media", "Retail media", "ecommerce", 6, 12.0, 4.5),
    ("tv_burst", "TV burst", "atl", 4, 17.0, 6.0),
    ("hcp_detailing", "HCP detailing", "hcp", 12, 7.0, 3.0),
    ("price_promo", "Price promotion", "trade", 4, 21.0, 7.0),
]
MECHANIC_IDS = [m[0] for m in MECHANICS]

# Invented brand stems. Checked against the blocklist by tests (DAT-11).
STEMS = [
    "Kalvora", "Rhinexa", "Bronchyl", "Allerdyn", "Gastrivo", "Dermalix",
    "Immunova", "Zentheva", "Nasolyn", "Tussivar", "Pollenex", "Ventaris",
    "Cutalis", "Vitarel", "Enterix", "Algivan", "Myoril", "Sinuvent",
    "Histalim", "Reflexan", "Probivia", "Solarix", "Ferrovita", "Neuralgo",
    "Thoraxin", "Claritan", "Epidermo", "Colovance", "Respiven", "Aurivit",
    "Lacrimex", "Dolorex", "Mucolex", "Biotivia", "Skinvera", "Nutrilan",
    "Pharyngo", "Osmolyn", "Cardivit", "Somnera", "Venoxil", "Hepatiq",
    "Uroventa", "Zincora", "Magnevia", "Omegalis", "Calmivar", "Rheumex",
]

# Brands deliberately left without a sibling, so the "cannibalisation not
# deducted" advisory (ADV-2) has a case to fire on.
NEED_STATE_OVERRIDES = {"RS-006": 1}

# Fixture anchors. Named here so tests and the SKILL can refer to them.
FIXTURE_AT1_BRAND = "BE-001"        # Belgian cold_flu brand, rich display history
FIXTURE_NO_HISTORY_BRAND = "PL-004"  # DAT-6: zero history for tv_burst
FIXTURE_NO_HISTORY_MECHANIC = "tv_burst"
FIXTURE_CANNIBAL_BRAND = "RS-002"   # DAT-7: siblings flip the case negative
FIXTURE_BREAKEVEN_BRAND = "DE-005"  # DAT-8: low below break-even, base above
FIXTURE_BREAKEVEN_MECHANIC = "digital_awareness"
FIXTURE_NO_SIBLING_BRAND = "RS-012"   # ADV-2: no SKU shares its need state


def seasonality(category: str) -> list[float]:
    """12 monthly indices with an exact mean of 1.0 (DAT-3, DAT-4)."""
    _, peak, amp, *_ = CATEGORIES[category]
    raw = [1.0 + amp * math.cos(2 * math.pi * ((m - peak) / 12.0)) for m in range(1, 13)]
    mean = sum(raw) / 12.0
    return [round(v / mean, 4) for v in raw]


def _stable_hash(text: str) -> int:
    """Process-independent hash. Python's built-in hash() is salted per run,
    which would break DAT-1 reproducibility across processes."""
    total = 0
    for char in text:
        total = (total * 31 + ord(char)) % 1000003
    return total


def _fmt(value: float, places: int) -> str:
    return f"{value:.{places}f}"


def _write(name: str, header: list[str], rows: list[list], out_dir: Path) -> None:
    path = out_dir / name
    with path.open("w", newline="\n", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


# --------------------------------------------------------------------------
# Generators
# --------------------------------------------------------------------------

def build_markets() -> list[list]:
    return [[mid, name, _fmt(pop, 1), _fmt(idx, 2), pharm]
            for mid, name, pop, idx, pharm in MARKETS]


def build_brands(rng: random.Random) -> list[dict]:
    brands: list[dict] = []
    stem_idx = 0
    for market_id, _, population_m, price_index, _ in MARKETS:
        for slot in range(12):
            category = CATEGORY_ORDER[slot % len(CATEGORY_ORDER)]
            need_states, _, _, base_price, base_cm, ros_index = CATEGORIES[category]
            # Two brands per market share each category and need state, so
            # sibling structure exists (glossary: same market + need_state).
            need_state = need_states[NEED_STATE_OVERRIDES.get(
                f"{market_id}-{slot + 1:03d}", 0)]
            stem = STEMS[stem_idx]
            stem_idx += 1
            brand_id = f"{market_id}-{slot + 1:03d}"

            size_factor = round(rng.uniform(0.80, 1.30), 3)
            price = round(base_price * price_index * rng.uniform(0.92, 1.10), 2)
            cm_pct = round(min(0.78, max(0.42, base_cm + rng.uniform(-0.06, 0.06))), 3)
            cogs = round(price * (1.0 - cm_pct), 2)
            # DAT-5: rate of sale is a function of population and category.
            ros = round(population_m * ros_index * size_factor * ROS_MULTIPLIER, 1)

            brands.append({
                "brand_id": brand_id,
                "brand_name": stem,
                "market": market_id,
                "category": category,
                "need_state": need_state,
                "net_price_eur": price,
                "cogs_eur": cogs,
                "contribution_margin_pct": cm_pct,
                "base_rate_of_sale_units_week": ros,
                "seasonality": seasonality(category),
            })

    # DAT-7: shrink the cannibalisation fixture brand so sibling loss dominates.
    for brand in brands:
        if brand["brand_id"] == FIXTURE_CANNIBAL_BRAND:
            brand["base_rate_of_sale_units_week"] = round(
                brand["base_rate_of_sale_units_week"] * 0.18, 1)
    return brands


def brand_rows(brands: list[dict]) -> list[list]:
    rows = []
    for b in brands:
        rows.append([
            b["brand_id"], b["brand_name"], b["market"], b["category"], b["need_state"],
            _fmt(b["net_price_eur"], 2), _fmt(b["cogs_eur"], 2),
            _fmt(b["contribution_margin_pct"], 3),
            _fmt(b["base_rate_of_sale_units_week"], 1),
            *[_fmt(v, 4) for v in b["seasonality"]],
        ])
    return rows


def build_skus(brands: list[dict], rng: random.Random) -> list[list]:
    rows = []
    packs = ["10 units", "20 units", "30 units", "60 ml", "100 ml", "150 ml"]
    for b in brands:
        n_skus = 3 if rng.random() < 0.55 else 2
        shares = [0.55, 0.30, 0.15][:n_skus]
        total = sum(shares)
        for i in range(n_skus):
            share = shares[i] / total
            sku_ros = round(b["base_rate_of_sale_units_week"] * share, 1)
            price = round(b["net_price_eur"] * (0.85 + 0.18 * i), 2)
            # Cannibalisation rate: share of this SKU's volume lost when another
            # brand in the same market and need_state is activated.
            rate = round(rng.uniform(0.004, 0.016), 4)
            if b["brand_id"].startswith("RS-") and b["need_state"] == "seasonal_allergy":
                rate = round(rng.uniform(0.070, 0.110), 4)  # DAT-7 sibling block
            rows.append([
                f"{b['brand_id']}-S{i + 1}", b["brand_id"], b["market"],
                f"{b['brand_name']} {packs[(i + _stable_hash(b['brand_id']) % 3) % len(packs)]}",
                b["category"], b["need_state"],
                _fmt(price, 2), _fmt(b["contribution_margin_pct"], 3),
                _fmt(sku_ros, 1), _fmt(rate, 4),
                "yes" if i == 0 else "no",
            ])
    return rows


def _uplift(rng: random.Random, base: float, spread: float, spend: float,
            expected_spend: float, quality: str) -> float:
    intensity = (spend / expected_spend) ** 0.35
    noise = rng.gauss(0.0, spread * 0.45)
    value = base * intensity + noise
    if quality == "low":
        value += rng.uniform(-2.0, 2.0)
    return round(max(1.2, value), 2)


def build_activations(brands: list[dict], rng: random.Random) -> list[list]:
    by_id = {b["brand_id"]: b for b in brands}
    rows: list[list] = []
    seq = 0

    def add(brand, mechanic, month, weeks, spend, quality, uplift=None):
        nonlocal seq
        seq += 1
        spec = dict(zip(MECHANIC_IDS, MECHANICS))[mechanic]
        if uplift is None:
            uplift = _uplift(rng, spec[4], spec[5], spend,
                             40000 * (0.6 + 0.9 * spec[3] / 6), quality)
        rows.append([
            f"ACT-{seq:04d}", brand["market"], brand["brand_id"], brand["category"],
            brand["need_state"], mechanic, 2023 + (seq % 3), month, weeks,
            _fmt(spend, 2), _fmt(uplift, 2), quality,
        ])

    # 1. Designed block for AT-1: Belgian cold_flu display comparables in the
    #    48k-112k band around an 80k request.
    at1 = by_id[FIXTURE_AT1_BRAND]
    for month, weeks, spend, uplift in [
        (10, 6, 72000.0, 17.40), (11, 6, 88000.0, 20.10), (1, 4, 61000.0, 16.20),
        (12, 8, 96000.0, 22.60), (2, 6, 79000.0, 19.30), (10, 6, 105000.0, 21.40),
    ]:
        add(at1, "in_pharmacy_display", month, weeks, spend, "high", uplift)

    # 2. Designed block for DAT-8: wide uplift spread so P25 sits below
    #    break-even while the median clears it.
    be = by_id[FIXTURE_BREAKEVEN_BRAND]
    for month, weeks, spend, uplift in [
        (4, 8, 330000.0, 3.10), (5, 8, 360000.0, 4.40), (4, 6, 345000.0, 5.20),
        (5, 8, 395000.0, 8.60), (6, 8, 410000.0, 9.40), (3, 6, 430000.0, 11.80),
    ]:
        add(be, FIXTURE_BREAKEVEN_MECHANIC, month, weeks, spend, "high", uplift)

    # 3. Sibling history for the DAT-7 cannibalisation fixture.
    cannibal = by_id[FIXTURE_CANNIBAL_BRAND]
    for month, weeks, spend, uplift in [
        (4, 6, 15000.0, 9.80), (5, 6, 18000.0, 11.40), (3, 4, 13000.0, 8.60),
        (5, 8, 20000.0, 12.10),
    ]:
        add(cannibal, "in_pharmacy_display", month, weeks, spend, "high", uplift)

    # 4. Bulk history. DAT-6 is protected by skipping the reserved combination.
    target_rows = 220
    brand_cycle = [b for b in brands]
    while len(rows) < target_rows:
        brand = brand_cycle[len(rows) % len(brand_cycle)]
        mechanic = MECHANIC_IDS[(len(rows) * 3) % len(MECHANIC_IDS)]
        if (brand["brand_id"] == FIXTURE_NO_HISTORY_BRAND
                and mechanic == FIXTURE_NO_HISTORY_MECHANIC):
            mechanic = "sampling"
        # Keep the whole PL/vitamins/tv_burst cell empty so the fixture holds
        # for the brand's category too.
        if (brand["market"] == "PL" and brand["category"] == "vitamins"
                and mechanic == FIXTURE_NO_HISTORY_MECHANIC):
            mechanic = "sampling"
        spec = dict(zip(MECHANIC_IDS, MECHANICS))[mechanic]
        weeks = spec[3] + rng.choice([-2, 0, 0, 2])
        month = rng.choice([1, 2, 3, 4, 5, 6, 9, 10, 11, 12])
        # Spend follows the brand's economics: bigger brands carry bigger
        # budgets, and the implied return sits in a realistic band.
        reference_gp = (brand["base_rate_of_sale_units_week"] * weeks
                        * (spec[4] / 100.0) * brand["net_price_eur"]
                        * brand["contribution_margin_pct"])
        spend = round(reference_gp / rng.uniform(0.60, 2.80), 2)
        quality = "low" if rng.random() < 0.10 else "high"  # DAT-10
        add(brand, mechanic, month, weeks, spend, quality)
    return rows


def build_launches(rng: random.Random) -> list[list]:
    rows = []
    pops = {m[0]: m[2] for m in MARKETS}
    for i in range(35):
        market_id = MARKETS[i % 4][0]
        category = CATEGORY_ORDER[i % len(CATEGORY_ORDER)]
        need_states, _, _, base_price, base_cm, ros_index = CATEGORIES[category]
        need_state = need_states[(i // len(CATEGORY_ORDER)) % len(need_states)]
        population = pops[market_id]
        actual = round(population * ros_index * 52 * rng.uniform(45.0, 110.0), 0)
        # DAT-9: forecasts sit 10-20% above actuals on average.
        ratio = rng.uniform(1.02, 1.30)
        forecast = round(actual * ratio, 0)
        price = round(base_price * MARKETS[i % 4][3] * rng.uniform(0.95, 1.12), 2)
        rows.append([
            f"LNC-{i + 1:03d}", market_id, category, need_state, 2021 + (i % 4),
            _fmt(population, 1), _fmt(forecast, 0), _fmt(actual, 0),
            _fmt(price, 2), _fmt(round(base_cm, 3), 3),
            _fmt(round(rng.uniform(400000, 1600000), 2), 2),
            _fmt(round(rng.uniform(0.30, 0.48), 3), 3),  # year1 ramp: share in H1
        ])
    return rows


def build_competitors(rng: random.Random) -> list[list]:
    rows = []
    seq = 0
    names = ["Norvexa", "Pharmaco", "Belveda", "Ostrimed", "Corvina",
             "Lumenta", "Trivex", "Sandora", "Verdilo", "Halcyra",
             "Medrova", "Quintal", "Ravella", "Solventa", "Turnix"]
    for market_id, *_ in MARKETS:
        for category in CATEGORY_ORDER:
            need_states = CATEGORIES[category][0]
            n = 3 if category in ("cold_flu", "pain", "vitamins") else 2
            for j in range(n):
                seq += 1
                rows.append([
                    f"CMP-{seq:03d}", market_id, category,
                    need_states[j % len(need_states)],
                    names[(seq * 5) % len(names)] + " " + category.split("_")[0].title(),
                    _fmt(round(rng.uniform(3.0, 22.0), 1), 1),
                    _fmt(round(rng.uniform(0.75, 1.35), 2), 2),
                ])
    return rows


def generate(out_dir: Path = DATA_DIR, seed: int = SEED) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)

    brands = build_brands(rng)
    skus = build_skus(brands, rng)
    activations = build_activations(brands, rng)
    launches = build_launches(rng)
    competitors = build_competitors(rng)
    markets = build_markets()

    month_cols = [f"seasonality_m{m}" for m in range(1, 13)]
    _write("markets.csv",
           ["market_id", "market_name", "population_m", "price_index", "pharmacies"],
           markets, out_dir)
    _write("brands.csv",
           ["brand_id", "brand_name", "market", "category", "need_state",
            "net_price_eur", "cogs_eur", "contribution_margin_pct",
            "base_rate_of_sale_units_week", *month_cols],
           brand_rows(brands), out_dir)
    _write("skus.csv",
           ["sku_id", "brand_id", "market", "sku_name", "category", "need_state",
            "net_price_eur", "contribution_margin_pct",
            "base_rate_of_sale_units_week", "cannibalisation_rate", "is_primary"],
           skus, out_dir)
    _write("mechanics.csv",
           ["mechanic_id", "mechanic_name", "channel", "typical_duration_weeks",
            "reference_uplift_pct", "uplift_spread_pct"],
           [[m[0], m[1], m[2], m[3], _fmt(m[4], 1), _fmt(m[5], 1)] for m in MECHANICS],
           out_dir)
    _write("activations.csv",
           ["activation_id", "market", "brand_id", "category", "need_state",
            "mechanic", "year", "start_month", "duration_weeks", "spend_eur",
            "measured_uplift_pct", "data_quality"],
           activations, out_dir)
    _write("launches.csv",
           ["launch_id", "market", "category", "need_state", "launch_year",
            "market_population_m", "forecast_year1_units", "actual_year1_units",
            "net_price_eur", "contribution_margin_pct", "launch_ap_eur",
            "h1_share_of_year1"],
           launches, out_dir)
    _write("competitors.csv",
           ["competitor_id", "market", "category", "need_state", "competitor_brand",
            "estimated_share_pct", "price_index"],
           competitors, out_dir)

    return {
        "markets.csv": len(markets), "brands.csv": len(brands),
        "skus.csv": len(skus), "mechanics.csv": len(MECHANICS),
        "activations.csv": len(activations), "launches.csv": len(launches),
        "competitors.csv": len(competitors),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate the synthetic dataset.")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--out", type=Path, default=DATA_DIR)
    args = parser.parse_args()
    counts = generate(args.out, args.seed)
    for name, n in counts.items():
        print(f"{name:20s} {n:5d} rows")
