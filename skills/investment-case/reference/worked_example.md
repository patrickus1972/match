# Worked example — hand-checked

One full activation case, arithmetic written out, so every figure in the deck
can be reproduced with a calculator. Regenerate with:

```
python skills/investment-case/scripts/run_case.py \
  --request tests/fixtures/at1_belgium_display.json
```

All figures are synthetic. They are not STADA figures.

---

## The request

> "Six-week in-pharmacy display for Kalvora in Q4, €80,000."

## Inputs resolved from reference data (never asked for)

| Input | Value | Source |
|---|---|---|
| Brand | Kalvora (`BE-001`) | brands.csv |
| Market / category / need state | BE / cold_flu / cough | brands.csv |
| Net price | €9.16 | brands.csv |
| Contribution margin | 57.7% | brands.csv (**not** derived from price — GRD-1) |
| Baseline rate of sale | 26,553.6 units/week | brands.csv |
| Seasonality index, October | 1.000 | brands.csv seasonality curve |
| Sibling SKUs (same market + need state) | BE-007-S1/S2/S3 | skus.csv |

## Inputs taken from the request

| Input | Value |
|---|---|
| Mechanic | in_pharmacy_display |
| Period | 6 weeks from October |
| A&P request | €80,000 |

## Comparables (CAL-3: same market, mechanic, category; spend €48,000–€112,000)

| Activation | Spend | Measured uplift |
|---|---|---|
| ACT-0001 | €72,000 | 17.40% |
| ACT-0002 | €88,000 | 20.10% |
| ACT-0003 | €61,000 | 16.20% |
| ACT-0004 | €96,000 | 22.60% |
| ACT-0005 | €79,000 | 19.30% |
| ACT-0006 | €105,000 | 21.40% |
| ACT-0097 | €57,465 | 13.34% |
| ACT-0145 | €62,054 | 13.49% |
| ACT-0193 | €70,315 | 15.78% |

Nine comparables. P25 = 15.78%, median = **17.40%**, P75 = 20.10%.

## Base case, step by step

```
baseline_units      = 26,553.6 x 6 weeks x 1.000        = 159,321.60
incremental_units   = 159,321.60 x 17.40%               =  27,721.96
cannibalised_units  = 13,611.7 x 6 x 1.000 x 0.0150     =   1,225.05
                    +  7,424.5 x 6 x 1.000 x 0.0046     =     204.92
                    +  3,712.3 x 6 x 1.000 x 0.0082     =     182.65
                                                          ----------
                                                          =   1,612.61
net_incremental     = 27,721.96 - 1,612.61               =  26,109.34
gross_profit_eur    = 26,109.34 x 9.16 x 0.577           = 137,996.24
gp_per_ap_euro      = 137,996.24 / 80,000                =       1.72
```

**Break-even uplift**

```
unit gross profit   = 9.16 x 0.577                       =       5.285
units to repay A&P  = 80,000 / 5.285                     =  15,136.79
plus cannibalised                                        =   1,612.61
                                                          ----------
                                                          =  16,749.40
break-even uplift   = 16,749.40 / 159,321.60             =      10.51%
```

The activation repays its A&P at an uplift of 10.51%. History says 17.40%.

## Scenarios (CAL-9)

| Scenario | Uplift | Period | Net units | Gross profit | Per €1 A&P |
|---|---|---|---|---|---|
| Low | 15.78% | 4 weeks | 15,686 | €82,903 | €1.04 |
| Base | 17.40% | 6 weeks | 26,109 | €137,996 | €1.72 |
| High | 20.10% | 8 weeks | 40,548 | €214,309 | €2.68 |

Low is the 25th percentile of the comparables **and** two weeks shorter; high is
the 75th percentile and two weeks longer. Both ends move together, which is why
the range is wide.

## What the skill says, unprompted

Nothing on this case: nine comparables, siblings present and deducted, every
scenario above break-even. Compare with the fixture cases:

| Fixture | What is volunteered |
|---|---|
| `dat6_no_comparables` | Fewer than two comparables — no forecast is produced (ADV-1) |
| `adv2_no_siblings` | No sibling SKU, so no cannibalisation deducted (ADV-2); every comparable ran off-season (ADV-4) |
| `dat8_low_below_breakeven` | The low scenario does not repay the A&P; the base case does (ADV-3) |
| `dat7_cannibalisation` | More volume is lost from siblings than the activation adds; net gross profit is negative |

## Check-back

Sell-out units versus the baseline over the activation period and the four weeks
after it. Owner: brand manager. Date: eight weeks after the activation ends.
