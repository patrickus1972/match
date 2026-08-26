# CHC use case scoring dashboard

`chc-scoring-dashboard.html` is a standalone, single-file dashboard built from
`CHCScoringDashboard.xlsx`. Open it in a browser — no build step, no server, no
dependencies beyond a webfont.

## What it does

It re-implements the workbook's model in the browser, formula for formula:

| Workbook | Here |
| --- | --- |
| `Scoring!Q` — `SUMPRODUCT(scores, weights)` | weighted score per case |
| `Scoring!R` — `ROUND(Q/days, 2)` | points per build day |
| `Scoring!S` — the nested `IF` | the first cut a case fails |
| `Dashboard!C7:C13` | the seven weight sliders |
| `Dashboard!F7:F9` | the three threshold sliders |
| `Dashboard!I6:I12` | the four headline tiles |
| `Dashboard!B19:I31` | the ranking table |

Everything is computed live from the thirteen scored cases. Nothing is hard-coded.

## What you can change

- **Weights** (0–5) for each of the seven wants.
- **Cut 1** minimum score, **Cut 3** minimum points per build day, and the
  architect days on the plan.
- **Any case**: click it to open a drawer with 1–5 steppers for all seven scores,
  toggles for the four musts, and its build days.
- **Scenarios**: preset weightings, plus *Cut until it fits*, which walks Cut 1
  up until the survivors fit the plan.

State is kept in the URL hash, so a scenario can be shared by copying the link,
and is remembered in `localStorage` between visits.

## Design notes

Burgundy means removed, teal means it survives, and gold is chrome that never
carries data. The four verdict colours were validated for colour-blind
separation and contrast against both the light and dark grounds; verdicts are
always spelled out in text as well as colour. The page follows the viewer's
light/dark preference and honours `prefers-reduced-motion`.
