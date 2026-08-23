# Investment Case — Claude Skill (demo build)

Turns a brand manager's plain-language request for budget into a reviewable
business case deck. Activation and campaign cases, and new-product cases at two
depths: `npi_rough` for G1, `npi_full` for Gate 3.

**Everything in here is synthetic.** Four invented markets, 48 invented brands,
220 invented activations. Every slide is footed
`SYNTHETIC DEMO DATA — NOT STADA FIGURES`. No STADA system is touched.

## Run it

```bash
pip install -r requirements.txt
python skills/investment-case/scripts/run_case.py \
  --request tests/fixtures/at1_belgium_display.json
```

Three files land in `skills/investment-case/out/`: the deck, the calculation
file, and the comparables CSV.

Other cases to try:

| Fixture | What it demonstrates |
|---|---|
| `at1_belgium_display` | The ordinary case — nine comparables, every scenario above break-even |
| `dat8_low_below_breakeven` | The low scenario does not repay the A&P; the base case does |
| `dat7_cannibalisation` | Siblings take more volume than the activation adds — net negative |
| `dat6_no_comparables` | No history to forecast from — a two-slide deck and no number |
| `adv2_no_siblings` | No sibling data, and every comparable off-season |
| `at7_npi_rough_poland` | A G1 new-product case, four slides |
| `npi_full_germany` | A Gate 3 case, eight slides with three-year view and payback |

## Test it

```bash
python -m pytest
```

107 tests. Coverage of `calculate.py` is gated at 90%.

## How it is put together

```
skills/investment-case/
  SKILL.md                  intake, advisory rules, guardrails       INT, ADV, GRD-5
  scripts/
    generate_data.py        seeded dataset generation                DAT
    dataset.py              CSV access, request resolution, advisories
    comparables.py          matching, medians, percentiles           CAL-3,4,5
    calculate.py            pure arithmetic — no files, no network   CAL
    render_deck.py          calculation file -> .pptx                OUT
    run_case.py             one command, one case
    make_template.py        builds the neutral stand-in template
  reference/
    data/*.csv              the seven datasets
    gate_template.pptx      slide master (stand-in — see open questions)
    worked_example.md       one full case, arithmetic written out
    brand_blocklist.txt     real brand names no generated name may contain
tests/
  test_data.py              DAT-1 .. DAT-11
  test_comparables.py       CAL-3, 4, 5 and the ADV-4/5 matchers
  test_calculate.py         CAL-1, 2, 6 .. CAL-12
  test_deck.py              OUT-1 .. OUT-11
  test_guardrails.py        GRD-1 .. GRD-5, NFR-1 .. NFR-6
  test_acceptance.py        AT-1 .. AT-8
  fixtures/                 the named DAT-6, DAT-7, DAT-8 and ADV-2 cases
```

The boundary that matters: **the model never computes a figure that reaches the
deck.** `calculate.py` is a pure module — the test suite fails if it grows an
import of `csv`, `json`, `pathlib`, `requests` or `pptx`. The renderer reads the
calculation file and nothing else, which is why deleting the transcript and
re-rendering gives a byte-identical deck.

## Deck shapes

| Depth | Body slides | Plus appendix | Total |
|---|---|---|---|
| `activation` | The ask · Forecast · Portfolio impact · Sensitivity · Assumptions and check-back | yes | 6 |
| `npi_rough` | The ask · Market and analogues · Year 1 forecast · Assumptions and check-back | yes | 5 |
| `npi_full` | The ask · Market and analogues · Year 1 forecast · Three-year view · Payback · Portfolio impact · Sensitivity · Assumptions and check-back | yes | 9 |
| any, no comparables | The ask, marked `REQUIRED — NOT SUPPLIED` | yes | 2 |

OUT-3 and OUT-4 fix the body-slide counts at 5 / 4 / 8; OUT-5 adds the appendix
on top, so the file counts are 6 / 5 / 9.

## Reproducibility

- Same seed, same dataset, byte for byte (`generate_data.py`).
- Same request, same calculation file, byte for byte.
- Same calculation file, same deck, byte for byte — the package is written with
  fixed timestamps and fixed core properties.

A test asserts the committed CSVs still match what the generator produces, so a
stale dataset cannot drift in unnoticed.

## Open questions still to close

These are the things that separate a demo from something people use. They are
answered by people, not by code.

| # | Question | Ask | What it unblocks |
|---|---|---|---|
| Q1 | What does the real gate deck template contain and require? | Katarzyna, Laura | Replacing `gate_template.pptx` — the deck shapes become real |
| Q2 | What does the real budget-round case template contain? | Jolien | Same, for activation and campaign cases |
| Q3 | Is cannibalisation modelled today at all, and how? | Jolien, Controlling | Whether the sibling-SKU model matches practice |
| Q4 | Are past activation results findable in hours, or not really? | Jolien, Georgina | Whether v1 builds cases or first captures results |
| Q5 | What is the real contribution margin band, and who owns the rate? | CHC Controlling | The margin source and its owner on the assumptions slide |
| Q6 | Which gate names and depths apply per market? | Katarzyna, Jelena, Laura | Depth routing at intake |

Until Q1 and Q2 are answered the deck renders on a neutral stand-in template.
Matching the real one is most of the difference between a demo and something a
gate will accept.
