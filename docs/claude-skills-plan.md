# Claude Skills for CHC Marketing — setup plan

**From:** 46 processes mapped by 8 contributors across 7 markets (July–August 2026)
**To:** a sequenced portfolio of Claude Skills, starting with one built and tested

---

## 1 · What a Skill is, in this context

A Skill is a folder Claude loads when a request matches it. It contains three
things:

1. **Instructions** (`SKILL.md`) — how to run the conversation: what to ask,
   what to infer, what to volunteer, what to refuse.
2. **Scripts** — deterministic code that does the work that must be exactly
   right: matching, arithmetic, rendering.
3. **Reference data** — read-only files the Skill looks things up in.

The split matters more than anything else in this plan. **The model runs the
conversation; the scripts produce the numbers.** A brand manager types a
sentence; a Python function produces every figure that reaches a slide. That is
what makes the output reviewable by Controlling rather than plausible-looking.

---

## 2 · How the 46 processes were read

Each mapped process was scored on four things:

| Lens | Question |
|---|---|
| **Value** | The contributor's own revenue-impact rating (1–10) |
| **Reuse** | Do several markets do the same thing, in the same shape? |
| **Determinism** | Is there a right answer a script can produce, or is it judgement? |
| **Risk** | Does it touch claims, regulatory or medical content? |

High value plus high reuse plus high determinism plus low risk is where to
start. The processes cluster into six families.

| # | Family | Processes | Markets | Avg rating |
|---|---|---|---|---|
| A | **Business case & investment** | 6 | PL, BE, DE, RS | 9.2 |
| B | **Market & competitor insight** | 7 | PL, RS, BE, DE, Global | 7.9 |
| C | **Business review & reporting** | 4 | PL, RS, Global | 8.3 |
| D | **Campaign, media & content** | 12 | DE, BE, RS, BG, Global | 7.8 |
| E | **Demand & trade promotion** | 3 | RS, ES | 8.3 |
| F | **eCommerce & digital shelf** | 7 | Global, ES | 7.7 |

Family A is the obvious first build: it carries the highest ratings
(10/10 NPI Development in Poland, 10/10 NPD Pipeline in Germany, 10/10 New
Product Development in Serbia, 9/10 Strategic Business Case & Budget Planning in
Belgium), four markets do the same thing in a different template, the arithmetic
is deterministic, and it never touches a claim.

It is also where the pain is stated most plainly. Serbia: *"extensive manual
work … up to 4 months."* Belgium: *"limited templates available."*

---

## 3 · The sequence

### Wave 1 — Investment Case · **built**

Turns "six-week display, Q4, €80,000" into a gate-ready deck with a calculation
file behind every figure. Activation and campaign cases; new-product cases at
G1 (rough) and Gate 3 (full).

Covers: NPI Development (PL) · NPD Pipeline (DE) · New Product Development (RS) ·
Strategic Business Case & Budget Planning (BE) · HCP activation ROI cases (BE) ·
the business-case step inside Annual Budget Planning (DE).

Why first: highest rated, four markets, deterministic, no regulatory surface —
and it forces every architectural decision the rest of the portfolio inherits.

### Wave 2 — Market & Competitor Insight · Business Review Builder

Both are read-and-summarise skills over data that already exists. Lower risk
than Wave 1, and the Market Analytics process was mapped **independently by
Poland and Serbia** — the clearest signal in the deck that one skill serves
several markets unchanged.

### Wave 3 — Campaign Brief Builder · eCom Content & Digital Shelf

Higher value in Germany and at Global, but these touch claims and creative.
They need a hard boundary: the skill drafts the *brief and the structure*, and
hands claim wording and medical/legal review to the people who own it. Build
these only once the Wave 1 guardrail pattern has been reviewed by regulatory.

### Wave 4 — Demand Forecast & Trade Promotion Simulation

Highest data dependency of the six families: it needs real sell-out history,
IQVIA trends and the trade calendar. Worth doing, but only after Q4 below is
answered honestly.

---

## 4 · The pattern every Skill inherits from Wave 1

Six rules, all enforced in code and all covered by tests:

1. **The model never computes a figure that appears in an output.** Arithmetic
   lives in a pure module with no file and no network access.
2. **Reference data is read-only, and nothing is invented.** A brand that is not
   in the data gets a refusal, not an estimate.
3. **Guardrails live in code, not in prose.** The test suite passes with
   `SKILL.md` deleted. Instructions can be edited by anyone; the guardrails
   cannot be edited away by accident.
4. **Every output is traceable and reproducible.** A calculation file records
   every input, comparable and intermediate figure. Delete the conversation,
   re-render, and the deck comes back byte for byte identical.
5. **The Skill advises, it never recommends.** It flags thin evidence, a
   negative portfolio effect, a downside scenario below break-even. It declines
   to say whether to approve. The decision stays with the gate.
6. **Synthetic first.** Nothing connects to a STADA system until the data
   questions are answered and the guardrails have been reviewed.

---

## 5 · What is needed from the business

Six questions block the step from demo to something people use. None of them
are engineering questions.

| # | Question | Ask | Blocks |
|---|---|---|---|
| Q1 | What does the real gate deck template contain and require? | Katarzyna, Laura | The deck matching what a gate accepts |
| Q2 | What does the real budget-round case template contain? | Jolien | Same, for activation and campaign cases |
| Q3 | Is cannibalisation modelled today at all, and how? | Jolien, Controlling | Whether the portfolio-impact model matches practice |
| Q4 | Are past activation results findable in hours, or not really? | Jolien, Georgina | Whether v1 builds cases or first captures results |
| Q5 | What is the real contribution margin band, and who owns the rate? | CHC Controlling | The margin source and owner on every case |
| Q6 | Which gate names and depths apply per market? | Katarzyna, Jelena, Laura | Depth routing at intake |

**Q4 is the one that could change the plan.** If past activation results are not
findable, the first version of this Skill is not a case builder — it is the
capture format that makes the next twelve months of activations comparable. That
is a smaller build and a bigger long-term return, and it is a business decision,
not a technical one.

---

## 6 · Status

| | |
|---|---|
| Wave 1 Skill | Built, on synthetic data |
| Tests | 107 passing; arithmetic module at 99% coverage |
| Deck depths | Activation (6 slides) · G1 rough (5) · Gate 3 full (9) |
| Named demo cases | 7, including the three edge cases that should stop a case |
| Connected to any STADA system | No, by design |
