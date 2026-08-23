"""Markup for the front end. Formatting only — no arithmetic lives here."""

from __future__ import annotations

import html
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import render_deck as rd  # noqa: E402

MONTHS = rd.MONTHS


def esc(value) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


# --------------------------------------------------------------------------
# Pieces
# --------------------------------------------------------------------------

def option_list(values, selected, labels=None) -> str:
    out = ['<option value=""></option>']
    for value in values:
        label = (labels or {}).get(value, value)
        picked = " selected" if str(value) == str(selected or "") else ""
        out.append(f'<option value="{esc(value)}"{picked}>{esc(label)}</option>')
    return "".join(out)


def field(label, name, value="", *, kind="text", hint="", extra="") -> str:
    return f"""<label class="f">
  <span class="f-label">{esc(label)}</span>
  <input class="f-input" type="{kind}" name="{esc(name)}" value="{esc(value)}" {extra}>
  {f'<span class="f-hint">{esc(hint)}</span>' if hint else ''}
</label>"""


def select(label, name, options_markup, hint="") -> str:
    return f"""<label class="f">
  <span class="f-label">{esc(label)}</span>
  <select class="f-input" name="{esc(name)}">{options_markup}</select>
  {f'<span class="f-hint">{esc(hint)}</span>' if hint else ''}
</label>"""


def metric(label, value, tone="") -> str:
    return (f'<div class="metric {tone}"><span class="m-label">{esc(label)}</span>'
            f'<span class="m-value">{esc(value)}</span></div>')


def table(headers, rows, numeric=None, cls="") -> str:
    numeric = numeric or set()
    head = "".join(f'<th class="{"num" if i in numeric else ""}">{esc(h)}</th>'
                   for i, h in enumerate(headers))
    body = "".join(
        "<tr>" + "".join(
            f'<td class="{"num" if i in numeric else ""}">{esc(c)}</td>'
            for i, c in enumerate(row)) + "</tr>"
        for row in rows)
    return (f'<div class="scroll"><table class="{cls}"><thead><tr>{head}</tr>'
            f"</thead><tbody>{body}</tbody></table></div>")


# --------------------------------------------------------------------------
# The form
# --------------------------------------------------------------------------

def form(ds, guess: dict) -> str:
    guess = guess or {}
    depth = guess.get("depth") or "activation"
    brands = {b["brand_name"]: f"{b['brand_name']} — {b['market']}, "
                               f"{b['category']}, {b['need_state']}"
              for b in ds.brands}
    mechanics = {m["mechanic_id"]: m["mechanic_name"] for m in ds.mechanics}
    markets = {m["market_id"]: f"{m['market_id']} — {m['market_name']}"
               for m in ds.markets}
    pairs = sorted({(b["category"], b["need_state"]) for b in ds.brands})

    brand_value = guess.get("brand") or ""
    if brand_value and brand_value not in brands:
        match = next((b["brand_name"] for b in ds.brands
                      if b["brand_id"] == brand_value), "")
        brand_value = match or brand_value

    depth_options = "".join(
        f'<option value="{value}"{" selected" if depth == value else ""}>{label}</option>'
        for value, label in [
            ("activation", "Activation or campaign — business case"),
            ("npi_rough", "NPD pipeline / ideation — rough case (G1)"),
            ("npi_full", "NPI / NPD launch — full case (Gate 3)")])

    return f"""<form method="post" action="/build" class="panel" id="confirm">
  <input type="hidden" name="brief" value="{esc(guess.get('_brief', ''))}">
  <div class="panel-head">
    <h2><span class="sn">2</span> Check what it read, then build</h2>
    <p class="hint">Correct anything that is wrong. Fields left to the reference
    data — price, margin, rate of sale, seasonality, siblings — are never asked
    for and never invented.</p>
  </div>

  {select("Case type", "depth", depth_options)}

  <div class="grid" data-when="activation">
    {select("Brand", "brand", option_list(brands, brand_value, brands),
            "price, margin and rate of sale come from here")}
    {select("Mechanic", "mechanic",
            option_list(mechanics, guess.get("mechanic"), mechanics))}
    {field("Weeks", "weeks", guess.get("period_weeks", ""), kind="number",
           extra='min="1" max="52"')}
    {select("Starts in", "month",
            option_list(range(1, 13), guess.get("period_start_month"),
                        {i: MONTHS[i] for i in range(1, 13)}))}
  </div>

  <div class="grid" data-when="npi">
    {field("Concept name", "concept", guess.get("concept_name", ""),
           hint="what the new product is called internally")}
    {select("Market", "market", option_list(markets, guess.get("market"), markets))}
    {select("Category", "category",
            option_list(sorted({c for c, _ in pairs}), guess.get("category")))}
    {select("Need state", "need_state",
            option_list(sorted({n for _, n in pairs}), guess.get("need_state")))}
  </div>

  <div class="grid">
    {field("A&P / launch investment (€)", "spend",
           int(guess["ap_request_eur"]) if guess.get("ap_request_eur") else "",
           kind="number", extra='min="0" step="1000"')}
    {field("Override contribution margin (%)", "cm", "", kind="number",
           hint="optional — leave blank to use the rate on file",
           extra='min="1" max="99" step="0.1"')}
    {field("Case title", "title", guess.get("case_title") or "")}
    {field("Case ID", "case_id", guess.get("case_id") or "WEB-0001")}
  </div>

  <button class="go" type="submit">Build the case</button>
</form>"""


# --------------------------------------------------------------------------
# The result
# --------------------------------------------------------------------------

def result(record: dict, paths: dict) -> str:
    inp, res = record["inputs"], record["result"]
    blocked = res["status"] != "OK"

    if blocked:
        if res["status"] == "INSUFFICIENT_COMPARABLES":
            headline = (f"No forecast. Only {res.get('comparables_used', 0)} past "
                        "activation matches this brand, market, mechanic and spend "
                        "level, and at least two are needed before an uplift means "
                        "anything.")
        else:
            headline = ("Required and not supplied: "
                        + ", ".join(res.get("missing_fields", [])) + ".")
        cards = metric("A&P requested", rd.eur(inp["ap_request_eur"])) + \
            metric("Gross profit", rd.NOT_SUPPLIED, "warn")
    elif inp["depth"] == "activation":
        base, low = res["base_case"], res["scenarios"]["low"]
        headline = (f"Base case is {rd.eur(base['gross_profit_eur'])} of gross "
                    f"profit against the {rd.eur(inp['ap_request_eur'])} request — "
                    f"{rd.ratio(base['gp_per_ap_euro'])} back per euro, on "
                    f"{res['comparables_used']} comparable activations. Break-even "
                    f"is at {rd.pct(res['break_even_uplift_pct'])}; the low "
                    f"scenario lands at {rd.ratio(low['gp_per_ap_euro'])}.")
        cards = "".join([
            metric("A&P requested", rd.eur(inp["ap_request_eur"])),
            metric("Gross profit, base case", rd.eur(base["gross_profit_eur"]),
                   "warn" if base["gross_profit_eur"] < 0 else ""),
            metric("Per €1 of A&P", rd.ratio(base["gp_per_ap_euro"]),
                   "warn" if base["gp_per_ap_euro"] < 1 else ""),
            metric("Break-even uplift", rd.pct(res["break_even_uplift_pct"])),
        ])
    else:
        headline = (f"Year 1 comes out at {rd.units(res['year1_units'])} units — "
                    f"{rd.eur(res['year1_gross_profit_eur'])} of gross profit "
                    f"against the {rd.eur(inp['ap_request_eur'])} investment, "
                    f"{rd.ratio(res['gp_per_ap_euro'])} per euro, from "
                    f"{res['analogues_used']} analogue launches.")
        cards = "".join([
            metric("Investment", rd.eur(inp["ap_request_eur"])),
            metric("Year 1 gross profit", rd.eur(res["year1_gross_profit_eur"])),
            metric("Per €1 invested", rd.ratio(res["gp_per_ap_euro"]),
                   "warn" if res["gp_per_ap_euro"] < 1 else ""),
            metric("Payback",
                   f"{res['payback_months']:.1f} months"
                   if res.get("payback_months") else "—"),
        ])

    advisories = ""
    if record["advisories"]:
        items = "".join(
            f'<li><span class="code">{esc(a["code"].replace("_", " ").lower())}</span>'
            f'{esc(a["text"])}</li>' for a in record["advisories"])
        advisories = f'<div class="flags"><h3>Volunteered, unasked</h3><ul>{items}</ul></div>'
    elif not blocked:
        advisories = ('<div class="flags quiet"><h3>Volunteered, unasked</h3>'
                      "<p>Nothing. Enough comparables, siblings deducted, every "
                      "scenario above break-even.</p></div>")

    scenarios = ""
    if not blocked:
        if inp["depth"] == "activation":
            rows = [[name.title(), rd.pct(s["uplift_pct"]),
                     f"{s['period_weeks']} wks",
                     rd.units(s["net_incremental_units"]),
                     rd.eur(s["gross_profit_eur"]), rd.ratio(s["gp_per_ap_euro"]),
                     "yes" if s["above_break_even"] else "no"]
                    for name, s in ((n, res["scenarios"][n])
                                    for n in ("low", "base", "high"))]
            scenarios = table(["Scenario", "Uplift", "Period", "Net units",
                               "Gross profit", "Per €1", "Repays A&P"], rows,
                              numeric={1, 3, 4, 5})
        else:
            rows = [[name.title(), rd.units(s["year1_units"]),
                     rd.eur(s["gross_profit_eur"]), rd.ratio(s["gp_per_ap_euro"]),
                     "yes" if s["above_break_even"] else "no"]
                    for name, s in ((n, res["scenarios"][n])
                                    for n in ("low", "base", "high"))]
            scenarios = table(["Scenario", "Year 1 units", "Gross profit",
                               "Per €1", "Repays"], rows, numeric={1, 2, 3})

    titles = rd.slide_titles(record)
    slide_list = "".join(f"<li>{esc(t)}</li>" for t in titles)

    links = "".join(
        f'<a class="dl{" primary" if key == "deck" else ""}" '
        f'href="/download?f={esc(path.name)}">{esc(label)}</a>'
        for key, label, path in [
            ("deck", f"Download the deck · {len(titles)} slides", paths["deck"]),
            ("calculation", "Calculation file (.json)", paths["calculation"]),
            ("comparables", "Comparables (.csv)", paths["comparables"])])

    return f"""<section class="panel result">
  <div class="panel-head">
    <h2><span class="sn">3</span> What it produced</h2>
  </div>
  <p class="reply">{esc(headline)}</p>
  <div class="metrics">{cards}</div>
  {advisories}
  {scenarios}
  <div class="downloads">{links}</div>
  <details class="slides">
    <summary>Slides in the deck ({len(titles)})</summary>
    <ol>{slide_list}</ol>
  </details>
  <p class="foot-note">{esc(rd.FOOTER_TEXT)} · every figure above comes from
  calculate.py and is recorded in the calculation file.</p>
</section>"""


# --------------------------------------------------------------------------
# The page
# --------------------------------------------------------------------------

FIELD_QUESTIONS = {
    "period_start_month": "which month does it start in?",
    "period_weeks": "how many weeks does it run?",
    "ap_request_eur": "how much is the A&P request?",
    "mechanic": "which mechanic — display, sampling, TV, digital?",
    "brand_id": "which brand?",
    "market": "which market?",
    "category": "which category?",
    "need_state": "which need state?",
    "net_price_eur": "what is the net price per unit?",
    "contribution_margin_pct": "what is the contribution margin?",
    "base_rate_of_sale_units_week": "what is the baseline rate of sale?",
    "market_population_m": "which market?",
}


def needs_block(needs: list[str]) -> str:
    if not needs:
        return ""
    questions = [FIELD_QUESTIONS.get(name, name.replace("_", " "))
                 for name in dict.fromkeys(needs)]
    if len(questions) == 1:
        body = f"One thing before I can build this — {questions[0]}"
    else:
        body = ("A couple of things before I can build this — "
                + "; ".join(questions))
    return (f'<div class="needs"><h3>Needs an answer</h3><p>{esc(body)}</p>'
            '<p class="small">Nothing has been calculated. Fill it in below and '
            'build again.</p></div>')


def page(ds, examples, *, brief="", guess=None, record=None, paths=None,
         refusal="", needs=None) -> str:
    guess = dict(guess or {})
    guess["_brief"] = brief
    chips = "".join(f'<button type="button" class="ex" data-brief="{esc(e)}">'
                    f"{esc(e)}</button>" for e in examples)
    needs_markup = needs_block(needs or [])
    refusal_block = (f'<div class="refusal"><h3>Refused</h3><p>{esc(refusal)}</p>'
                     "<p class=\"small\">Nothing was estimated. Pick from the "
                     "lists above.</p></div>") if refusal else ""
    result_block = result(record, paths) if record else ""

    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Investment Case — brief it, get the deck</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {{
  --paper:#F6F7F5; --surface:#FFFFFF; --sunk:#EDF0EC; --ink:#16212A;
  --muted:#5D6B70; --accent:#0B6E5F; --accent-soft:#E2EEEA; --signal:#A34410;
  --signal-soft:#F6E9E0; --hair:#DDE3E0; --hair-hard:#C3CDC8;
  --f-display:"Newsreader",Georgia,serif;
  --f-body:"Public Sans","Helvetica Neue",Arial,sans-serif;
  --f-mono:"IBM Plex Mono",Menlo,monospace;
}}
@media (prefers-color-scheme: dark) {{
  :root {{
    --paper:#101614; --surface:#172120; --sunk:#1C2725; --ink:#E7EDE9;
    --muted:#9AAAA4; --accent:#57C0A6; --accent-soft:#17332D; --signal:#DB8B4F;
    --signal-soft:#2E2118; --hair:#26332F; --hair-hard:#3A4A45;
  }}
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--f-body); font-size:15px; line-height:1.6; }}
.wrap {{ max-width:60rem; margin:0 auto; padding:0 1.5rem 5rem; }}
header.top {{ padding:3rem 0 1.75rem; border-bottom:1px solid var(--hair-hard);
  margin-bottom:2.5rem; }}
.eyebrow {{ font-family:var(--f-mono); font-size:0.68rem; letter-spacing:0.14em;
  text-transform:uppercase; color:var(--accent); margin:0 0 0.9rem; }}
h1 {{ font-family:var(--f-display); font-weight:500; font-size:clamp(2rem,5vw,2.9rem);
  line-height:1.06; letter-spacing:-0.018em; margin:0 0 0.7rem; }}
.stand {{ font-family:var(--f-display); font-size:1.1rem; color:var(--muted);
  max-width:50ch; margin:0; }}
.panel {{ background:var(--surface); border:1px solid var(--hair-hard);
  padding:1.6rem 1.7rem 1.8rem; margin-bottom:1.75rem; }}
.panel-head {{ margin-bottom:1.3rem; }}
h2 {{ font-family:var(--f-body); font-size:1rem; font-weight:600; margin:0 0 0.35rem;
  display:flex; align-items:center; gap:0.6rem; }}
.sn {{ font-family:var(--f-mono); font-size:0.68rem; color:var(--accent);
  border:1px solid var(--accent); width:1.4rem; height:1.4rem; flex:none;
  display:inline-flex; align-items:center; justify-content:center; }}
.hint {{ margin:0; font-size:0.84rem; color:var(--muted); max-width:60ch; }}
textarea {{ width:100%; min-height:5.5rem; font-family:var(--f-display);
  font-size:1.12rem; line-height:1.45; padding:0.9rem 1rem; color:var(--ink);
  background:var(--sunk); border:1px solid var(--hair-hard); resize:vertical; }}
textarea:focus, .f-input:focus {{ outline:2px solid var(--accent); outline-offset:1px; }}
.examples {{ display:flex; flex-wrap:wrap; gap:0.4rem; margin:0.9rem 0 1.1rem; }}
.ex {{ font-family:var(--f-mono); font-size:0.66rem; letter-spacing:0.03em;
  background:transparent; border:1px dashed var(--hair-hard); color:var(--muted);
  padding:0.3rem 0.5rem; cursor:pointer; text-align:left; }}
.ex:hover {{ border-style:solid; border-color:var(--accent); color:var(--accent); }}
button.go, button.read {{ font-family:var(--f-body); font-weight:600;
  font-size:0.92rem; padding:0.7rem 1.4rem; border:0; cursor:pointer;
  background:var(--accent); color:var(--paper); }}
button.read {{ background:var(--ink); }}
button.go:hover, button.read:hover {{ opacity:0.9; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));
  gap:1rem 1.25rem; margin-bottom:1.25rem; }}
.f {{ display:flex; flex-direction:column; gap:0.3rem; }}
.f-label {{ font-family:var(--f-mono); font-size:0.63rem; letter-spacing:0.09em;
  text-transform:uppercase; color:var(--muted); }}
.f-input {{ font-family:var(--f-body); font-size:0.92rem; padding:0.5rem 0.6rem;
  border:1px solid var(--hair-hard); background:var(--paper); color:var(--ink); }}
.f-hint {{ font-size:0.73rem; color:var(--muted); }}
.reply {{ font-family:var(--f-display); font-size:1.14rem; line-height:1.5;
  border-left:2px solid var(--accent); padding-left:1rem; margin:0 0 1.3rem;
  max-width:58ch; }}
.metrics {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));
  gap:1px; background:var(--hair); border:1px solid var(--hair); margin-bottom:1.4rem; }}
.metric {{ background:var(--surface); padding:0.8rem 0.9rem 0.9rem; }}
.m-label {{ display:block; font-family:var(--f-mono); font-size:0.58rem;
  letter-spacing:0.09em; text-transform:uppercase; color:var(--muted);
  margin-bottom:0.3rem; }}
.m-value {{ display:block; font-family:var(--f-display); font-size:1.5rem;
  line-height:1.1; font-variant-numeric:tabular-nums; }}
.metric.warn .m-value {{ color:var(--signal); }}
.flags {{ border:1px solid var(--signal); background:var(--signal-soft);
  padding:1rem 1.1rem; margin-bottom:1.4rem; }}
.flags.quiet {{ border-color:var(--hair-hard); background:var(--sunk); }}
.flags h3 {{ font-family:var(--f-mono); font-size:0.63rem; letter-spacing:0.1em;
  text-transform:uppercase; margin:0 0 0.6rem; color:var(--signal); }}
.flags.quiet h3 {{ color:var(--muted); }}
.flags ul {{ margin:0; padding:0; list-style:none; display:grid; gap:0.7rem; }}
.flags li {{ font-size:0.88rem; }}
.flags p {{ margin:0; font-size:0.88rem; color:var(--muted); }}
.code {{ display:block; font-family:var(--f-mono); font-size:0.6rem;
  letter-spacing:0.08em; text-transform:uppercase; color:var(--signal); }}
.scroll {{ overflow-x:auto; margin-bottom:1.4rem; }}
table {{ width:100%; border-collapse:collapse; font-size:0.85rem; }}
th {{ text-align:left; font-family:var(--f-mono); font-weight:500; font-size:0.62rem;
  letter-spacing:0.09em; text-transform:uppercase; color:var(--muted);
  padding:0 0.7rem 0.45rem 0; border-bottom:1px solid var(--hair-hard); }}
td {{ padding:0.45rem 0.7rem 0.45rem 0; border-bottom:1px solid var(--hair); }}
td.num, th.num {{ text-align:right; font-variant-numeric:tabular-nums;
  white-space:nowrap; }}
th:last-child, td:last-child {{ padding-right:0; }}
.downloads {{ display:flex; flex-wrap:wrap; gap:0.6rem; margin-bottom:1.2rem; }}
.dl {{ font-family:var(--f-mono); font-size:0.72rem; letter-spacing:0.05em;
  text-decoration:none; border:1px solid var(--hair-hard); color:var(--ink);
  padding:0.6rem 0.9rem; }}
.dl.primary {{ background:var(--accent); border-color:var(--accent);
  color:var(--paper); font-weight:500; }}
.dl:hover {{ border-color:var(--accent); }}
.slides {{ font-size:0.85rem; color:var(--muted); }}
.slides summary {{ cursor:pointer; font-family:var(--f-mono); font-size:0.68rem;
  letter-spacing:0.07em; text-transform:uppercase; }}
.slides ol {{ margin:0.6rem 0 0; padding-left:1.4rem; }}
.foot-note {{ margin:1.2rem 0 0; font-family:var(--f-mono); font-size:0.62rem;
  letter-spacing:0.05em; color:var(--muted); }}
.needs {{ border-left:3px solid var(--accent); background:var(--accent-soft);
  padding:1rem 1.2rem; margin-bottom:1.75rem; }}
.needs h3 {{ font-family:var(--f-mono); font-size:0.63rem; letter-spacing:0.1em;
  text-transform:uppercase; margin:0 0 0.4rem; color:var(--accent); }}
.needs p {{ margin:0; font-size:0.95rem; }}
.needs .small {{ font-size:0.8rem; color:var(--muted); margin-top:0.4rem; }}
.refusal {{ border-left:3px solid var(--signal); background:var(--signal-soft);
  padding:1rem 1.2rem; margin-bottom:1.75rem; }}
.refusal h3 {{ font-family:var(--f-mono); font-size:0.63rem; letter-spacing:0.1em;
  text-transform:uppercase; margin:0 0 0.4rem; color:var(--signal); }}
.refusal p {{ margin:0; font-size:0.9rem; }}
.refusal .small {{ font-size:0.8rem; color:var(--muted); margin-top:0.4rem; }}
</style>
</head><body>
<div class="wrap">
  <header class="top">
    <p class="eyebrow">CHC Marketing AI Value Pilot · Wave 1 Skill</p>
    <h1>Brief it. Get the deck.</h1>
    <p class="stand">Type the request the way you would say it. The Skill fills in
    what is on file, shows you what it read, and builds the PowerPoint.</p>
  </header>

  {refusal_block}
  {needs_markup}

  <form method="post" action="/read" class="panel">
    <div class="panel-head">
      <h2><span class="sn">1</span> The brief</h2>
      <p class="hint">Activation, campaign, NPD pipeline, NPI or a full Gate 3
      case — say which in your own words.</p>
    </div>
    <textarea name="brief" placeholder="Six-week in-pharmacy display for Kalvora in Q4, €80,000."
      >{esc(brief)}</textarea>
    <div class="examples">{chips}</div>
    <button class="read" type="submit">Read the brief</button>
  </form>

  {form(ds, guess)}

  {result_block}
</div>
<script>
  document.querySelectorAll('.ex').forEach(function (chip) {{
    chip.addEventListener('click', function () {{
      var box = document.querySelector('textarea[name="brief"]');
      box.value = chip.dataset.brief;
      box.focus();
    }});
  }});
  function syncDepth() {{
    var depth = document.querySelector('select[name="depth"]').value;
    document.querySelectorAll('[data-when]').forEach(function (block) {{
      var wants = block.dataset.when;
      var show = (wants === 'activation') ? depth === 'activation'
                                          : depth !== 'activation';
      block.style.display = show ? '' : 'none';
    }});
  }}
  document.querySelector('select[name="depth"]').addEventListener('change', syncDepth);
  syncDepth();
  if (document.querySelector('.result')) {{
    document.querySelector('.result').scrollIntoView({{ behavior: 'smooth' }});
  }}
</script>
</body></html>"""


def not_found() -> str:
    return ("<!doctype html><html><body style='font-family:sans-serif;padding:3rem'>"
            "<h1>Not found</h1><p><a href='/'>Back to the brief</a></p>"
            "</body></html>")
