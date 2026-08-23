"""Calculation record -> .pptx case deck (OUT-1 .. OUT-11).

The renderer reads the calculation file and nothing else. It never computes a
figure of its own: it formats, rounds for presentation (CAL-12) and lays out.

Output is byte-reproducible (AT-8): core properties are fixed and the package
is rewritten with constant zip timestamps.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import shutil
import zipfile
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

FOOTER_TEXT = "SYNTHETIC DEMO DATA — NOT STADA FIGURES"
NOT_SUPPLIED = "REQUIRED — NOT SUPPLIED"
TEMPLATE = Path(__file__).resolve().parent.parent / "reference" / "gate_template.pptx"

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x66, 0x6B, 0x72)
ACCENT = RGBColor(0x00, 0x53, 0x8B)
WARN = RGBColor(0xB3, 0x2A, 0x2A)
RULE = RGBColor(0xD8, 0xDC, 0xE0)
FIXED_TIME = _dt.datetime(2026, 1, 1, 0, 0, 0)

# OUT-3, OUT-4, OUT-6: fixed slide order per depth. The appendix (OUT-5) is
# rendered in addition to these body slides.
BODY_SLIDES = {
    "activation": ["The ask", "Forecast", "Portfolio impact", "Sensitivity",
                   "Assumptions and check-back"],
    "npi_rough": ["The ask", "Market and analogues", "Year 1 forecast",
                  "Assumptions and check-back"],
    "npi_full": ["The ask", "Market and analogues", "Year 1 forecast",
                 "Three-year view", "Payback", "Portfolio impact", "Sensitivity",
                 "Assumptions and check-back"],
}
APPENDIX_TITLE = "Appendix — inputs and comparables"


# --------------------------------------------------------------------------
# Layout helpers
# --------------------------------------------------------------------------

def _blank(prs: Presentation):
    return prs.slides.add_slide(prs.slide_layouts[6])


def _text(slide, left, top, width, height, text, *, size=14, bold=False,
          color=INK, align=PP_ALIGN.LEFT, wrap=True):
    box = slide.shapes.add_textbox(left, top, width, height)
    frame = box.text_frame
    frame.word_wrap = wrap
    frame.margin_left = 0
    frame.margin_right = 0
    frame.margin_top = 0
    frame.margin_bottom = 0
    lines = text.split("\n")
    for index, line in enumerate(lines):
        para = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        para.alignment = align
        run = para.add_run()
        run.text = line
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = "Arial"
    return box


def _rule(slide, top):
    line = slide.shapes.add_shape(1, Inches(0.7), top, Inches(11.93), Emu(9525))
    line.fill.solid()
    line.fill.fore_color.rgb = RULE
    line.line.fill.background()
    line.shadow.inherit = False
    return line


def _chrome(slide, title: str, subtitle: str = "") -> None:
    _text(slide, Inches(0.7), Inches(0.45), Inches(11.9), Inches(0.5), title,
          size=26, bold=True)
    if subtitle:
        _text(slide, Inches(0.7), Inches(1.02), Inches(11.9), Inches(0.35),
              subtitle, size=13, color=MUTED)
    _rule(slide, Inches(1.42))
    _text(slide, Inches(0.7), Inches(6.95), Inches(11.9), Inches(0.3),
          FOOTER_TEXT, size=9, color=MUTED)


def _metric(slide, left, top, label, value, *, value_color=INK, width=Inches(3.5)):
    _text(slide, left, top, width, Inches(0.3), label.upper(), size=10, color=MUTED)
    _text(slide, left, top + Inches(0.28), width, Inches(0.6), value,
          size=28, bold=True, color=value_color)


def _table(slide, left, top, width, headers, rows, *, col_widths=None,
           font_size=11, row_height=Inches(0.3)):
    shape = slide.shapes.add_table(len(rows) + 1, len(headers), left, top, width,
                                   row_height * (len(rows) + 1))
    table = shape.table
    if col_widths:
        for index, w in enumerate(col_widths):
            table.columns[index].width = w
    for index, header in enumerate(headers):
        cell = table.cell(0, index)
        cell.text = header
        para = cell.text_frame.paragraphs[0]
        para.runs[0].font.size = Pt(font_size)
        para.runs[0].font.bold = True
        para.runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        para.runs[0].font.name = "Arial"
        cell.fill.solid()
        cell.fill.fore_color.rgb = ACCENT
    for r_index, row in enumerate(rows, start=1):
        table.rows[r_index].height = row_height
        for c_index, value in enumerate(row):
            cell = table.cell(r_index, c_index)
            cell.text = str(value)
            para = cell.text_frame.paragraphs[0]
            para.runs[0].font.size = Pt(font_size)
            para.runs[0].font.name = "Arial"
            para.runs[0].font.color.rgb = INK
            cell.fill.solid()
            cell.fill.fore_color.rgb = (RGBColor(0xFF, 0xFF, 0xFF) if r_index % 2
                                        else RGBColor(0xF3, 0xF5, 0xF7))
    return table


# --------------------------------------------------------------------------
# Presentation formatting (CAL-12: rounding happens only here)
# --------------------------------------------------------------------------

def eur(value: float | None, places: int = 0) -> str:
    if value is None:
        return NOT_SUPPLIED
    return f"€{value:,.{places}f}"


def units(value: float | None) -> str:
    if value is None:
        return NOT_SUPPLIED
    return f"{value:,.0f}"


def pct(value: float | None, places: int = 1) -> str:
    if value is None:
        return NOT_SUPPLIED
    return f"{value:.{places}f}%"


def ratio(value: float) -> str:
    return f"€{value:,.2f}"


MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


# --------------------------------------------------------------------------
# Slides
# --------------------------------------------------------------------------

def _slide_ask(prs, record) -> None:
    slide = _blank(prs)
    inputs = record["inputs"]
    result = record["result"]
    blocked = result["status"] != "OK"
    _chrome(slide, "The ask", record["case_title"])

    if inputs["depth"] == "activation":
        mechanic = (inputs["mechanic"] or NOT_SUPPLIED).replace("_", " ").title()
        period = (f"{inputs['period_weeks']} weeks from "
                  f"{MONTHS[inputs['period_start_month']]}"
                  if inputs["period_weeks"] and inputs["period_start_month"]
                  else NOT_SUPPLIED)
        ask = (f"{mechanic} for {inputs['brand_name']} in "
               f"{inputs['market']}, {period}.")
    else:
        ask = (f"{inputs['concept_name']} in {inputs['market']} — "
               f"{inputs['category']} / {inputs['need_state']}.")
    _text(slide, Inches(0.7), Inches(1.75), Inches(7.4), Inches(1.0), ask, size=16)

    _metric(slide, Inches(0.7), Inches(2.9), "A&P requested",
            eur(inputs["ap_request_eur"]))
    if blocked:
        _metric(slide, Inches(4.6), Inches(2.9), "Gross profit", NOT_SUPPLIED,
                value_color=WARN, width=Inches(8.0))
        reason = _blocked_reason(result)
        _text(slide, Inches(0.7), Inches(4.1), Inches(11.9), Inches(1.6), reason,
              size=14, color=WARN)
        _text(slide, Inches(0.7), Inches(5.5), Inches(11.9), Inches(0.9),
              "No forecast slides follow. Supply what is listed above and the "
              "case can be built.", size=13, color=MUTED)
        return

    if inputs["depth"] == "activation":
        base = result["base_case"]
        _metric(slide, Inches(4.6), Inches(2.9), "Gross profit (base case)",
                eur(base["gross_profit_eur"]))
        _metric(slide, Inches(8.5), Inches(2.9), "Gross profit per €1 A&P",
                ratio(base["gp_per_ap_euro"]))
        _text(slide, Inches(0.7), Inches(4.3), Inches(11.9), Inches(1.0),
              f"Based on {result['comparables_used']} comparable activations in "
              f"{inputs['market']}, same mechanic and category, at a comparable "
              f"spend level.", size=13, color=MUTED)
    else:
        _metric(slide, Inches(4.6), Inches(2.9), "Year 1 gross profit",
                eur(result["year1_gross_profit_eur"]))
        _metric(slide, Inches(8.5), Inches(2.9), "Gross profit per €1 A&P",
                ratio(result["gp_per_ap_euro"]))
        _text(slide, Inches(0.7), Inches(4.3), Inches(11.9), Inches(1.0),
              f"Based on {result['analogues_used']} analogue launches in "
              f"comparable markets.", size=13, color=MUTED)

    if record["advisories"]:
        _text(slide, Inches(0.7), Inches(5.1), Inches(11.9), Inches(1.6),
              "\n".join("• " + a["text"] for a in record["advisories"]),
              size=12, color=WARN)


def _blocked_reason(result) -> str:
    if result["status"] == "INSUFFICIENT_COMPARABLES":
        return (f"{NOT_SUPPLIED}: a measured uplift for this brand, market, "
                f"mechanic and spend level. Only {result.get('comparables_used', 0)} "
                "past activation(s) match, and at least two are needed before an "
                "uplift can be read from history.")
    fields = ", ".join(result.get("missing_fields", []))
    return f"{NOT_SUPPLIED}: {fields}."


def _slide_forecast(prs, record) -> None:
    slide = _blank(prs)
    result = record["result"]
    base = result["base_case"]
    inputs = record["inputs"]
    _chrome(slide, "Forecast", "Base case — median of the matched comparables")

    _table(slide, Inches(0.7), Inches(1.8), Inches(7.2),
           ["Step", "Figure"],
           [["Baseline units over the period", units(base["baseline_units"])],
            ["Uplift applied", pct(base["uplift_pct"])],
            ["Incremental units", units(base["incremental_units"])],
            ["Less cannibalised units", units(-base["cannibalised_units"])],
            ["Net incremental units", units(base["net_incremental_units"])],
            ["Net price per unit", eur(inputs["net_price_eur"], 2)],
            ["Contribution margin", pct(inputs["contribution_margin_pct"] * 100)],
            ["Gross profit", eur(base["gross_profit_eur"])]],
           col_widths=[Inches(4.6), Inches(2.6)])

    _metric(slide, Inches(8.5), Inches(1.9), "Gross profit per €1 A&P",
            ratio(base["gp_per_ap_euro"]))
    _metric(slide, Inches(8.5), Inches(3.1), "Break-even uplift",
            pct(result["break_even_uplift_pct"]))
    _text(slide, Inches(8.5), Inches(4.2), Inches(4.1), Inches(1.6),
          "Break-even uplift is the uplift at which gross profit exactly repays "
          "the A&P request, after cannibalisation.", size=12, color=MUTED)


def _slide_portfolio(prs, record) -> None:
    slide = _blank(prs)
    inputs = record["inputs"]
    result = record["result"]
    _chrome(slide, "Portfolio impact",
            "Volume moving from other SKUs in the same need state")

    if inputs["depth"] != "activation" or not inputs["siblings"]:
        _text(slide, Inches(0.7), Inches(1.9), Inches(11.9), Inches(1.2),
              "No sibling SKU shares this need state in the reference data, so no "
              "cannibalisation has been deducted. The volume shown elsewhere in "
              "this deck is gross of any switching from the own portfolio.",
              size=15, color=WARN)
        return

    base = result["base_case"]
    rows = []
    for sib in inputs["siblings"][:10]:
        sib_baseline = (sib["base_rate_of_sale_units_week"] * base["period_weeks"]
                        * sib["seasonality_index"])
        rows.append([sib["sku_id"], units(sib_baseline),
                     pct(sib["cannibalisation_rate"] * 100, 2),
                     units(sib_baseline * sib["cannibalisation_rate"])])
    _table(slide, Inches(0.7), Inches(1.8), Inches(7.6),
           ["Sibling SKU", "Baseline units", "Rate", "Units lost"], rows,
           col_widths=[Inches(2.6), Inches(1.8), Inches(1.4), Inches(1.8)])

    _metric(slide, Inches(8.9), Inches(1.9), "Incremental units",
            units(base["incremental_units"]))
    _metric(slide, Inches(8.9), Inches(3.0), "Cannibalised units",
            units(base["cannibalised_units"]))
    _metric(slide, Inches(8.9), Inches(4.1), "Net units",
            units(base["net_incremental_units"]),
            value_color=WARN if base["net_incremental_units"] < 0 else INK)
    if len(inputs["siblings"]) > 10:
        _text(slide, Inches(0.7), Inches(6.3), Inches(7.6), Inches(0.3),
              f"{len(inputs['siblings'])} sibling SKUs in total; the ten with the "
              "largest identifiers are listed. All are included in the figures.",
              size=10, color=MUTED)


def _scenario_rows(record):
    result = record["result"]
    order = ["low", "base", "high"]           # OUT-8: low first
    rows = []
    for name in order:
        s = result["scenarios"][name]
        if record["inputs"]["depth"] == "activation":
            rows.append([name.title(), pct(s["uplift_pct"]),
                         f"{s['period_weeks']} weeks",
                         units(s["net_incremental_units"]),
                         eur(s["gross_profit_eur"]), ratio(s["gp_per_ap_euro"]),
                         "yes" if s["above_break_even"] else "no"])
        else:
            rows.append([name.title(), units(s["year1_units"]),
                         eur(s["gross_profit_eur"]), ratio(s["gp_per_ap_euro"]),
                         "yes" if s["above_break_even"] else "no"])
    return rows


def _slide_sensitivity(prs, record) -> None:
    slide = _blank(prs)
    _chrome(slide, "Sensitivity", "Low scenario shown first")
    if record["inputs"]["depth"] == "activation":
        headers = ["Scenario", "Uplift", "Period", "Net units", "Gross profit",
                   "Per €1 A&P", "Repays A&P"]
        widths = [Inches(1.5), Inches(1.3), Inches(1.5), Inches(2.0), Inches(2.2),
                  Inches(1.8), Inches(1.6)]
        note = ("Low is the 25th percentile of the comparables and two weeks "
                "shorter. High is the 75th percentile and two weeks longer.")
    else:
        headers = ["Scenario", "Year 1 units", "Gross profit", "Per €1 A&P",
                   "Repays A&P"]
        widths = [Inches(1.8), Inches(2.4), Inches(2.6), Inches(2.0), Inches(2.0)]
        note = ("Low is the 25th percentile of the analogue launches, base the "
                "median, high the 75th percentile.")
    _table(slide, Inches(0.7), Inches(1.9), Inches(11.9), headers,
           _scenario_rows(record), col_widths=widths, row_height=Inches(0.42),
           font_size=12)
    _text(slide, Inches(0.7), Inches(4.2), Inches(11.9), Inches(0.9), note,
          size=12, color=MUTED)
    flags = [a["text"] for a in record["advisories"]
             if a["code"] in ("LOW_BELOW_BREAK_EVEN", "SPEND_SCALE_MISMATCH",
                              "SEASON_MISMATCH")]
    if flags:
        _text(slide, Inches(0.7), Inches(5.0), Inches(11.9), Inches(1.5),
              "\n".join("• " + f for f in flags), size=12, color=WARN)


def _slide_assumptions(prs, record) -> None:
    slide = _blank(prs)
    _chrome(slide, "Assumptions and check-back",
            "Every figure traces to a source and an owner")
    rows = [[a["assumption"], a["value"], a["source"], a["owner"]]
            for a in record["assumptions"]]
    _table(slide, Inches(0.7), Inches(1.8), Inches(11.9),
           ["Assumption", "Value", "Source", "Owner"], rows,
           col_widths=[Inches(3.3), Inches(3.6), Inches(2.9), Inches(2.1)])
    check = record["check_back"]
    top = Inches(1.8) + Inches(0.3) * (len(rows) + 1) + Inches(0.35)
    _text(slide, Inches(0.7), top, Inches(11.9), Inches(1.0),
          f"Check-back: {check['measure']}. Owner: {check['owner']}. "
          f"Date: {check['date']}.", size=13)
    track = record.get("forecast_track_record") or {}
    if track.get("mean_forecast_to_actual_ratio"):
        _text(slide, Inches(0.7), top + Inches(0.55), Inches(11.9), Inches(0.6),
              f"Across {track['n']} past launches on file, forecasts came in at "
              f"{track['mean_forecast_to_actual_ratio']:.2f}x actual year 1 volume.",
              size=12, color=MUTED)


def _slide_market(prs, record) -> None:
    slide = _blank(prs)
    inputs = record["inputs"]
    result = record["result"]
    _chrome(slide, "Market and analogues",
            f"{inputs['category']} / {inputs['need_state']} in {inputs['market']}")
    rows = [[a["launch_id"], a["market"], a["launch_year"],
             f"{float(a['market_population_m']):.1f}m",
             units(float(a["actual_year1_units"]))]
            for a in record["analogues"]]
    _table(slide, Inches(0.7), Inches(1.8), Inches(7.6),
           ["Launch", "Market", "Year", "Population", "Actual year 1 units"], rows,
           col_widths=[Inches(1.5), Inches(1.3), Inches(1.2), Inches(1.8), Inches(1.8)])
    _metric(slide, Inches(8.9), Inches(1.9), "Analogues used",
            str(result["analogues_used"]))
    _metric(slide, Inches(8.9), Inches(3.0), "Target market",
            f"{inputs['market_population_m']:.1f}m people")
    _text(slide, Inches(8.9), Inches(4.1), Inches(3.7), Inches(1.6),
          "Analogue volumes are size-adjusted to the target market before the "
          "median is taken.", size=12, color=MUTED)


def _slide_year1(prs, record) -> None:
    slide = _blank(prs)
    result = record["result"]
    inputs = record["inputs"]
    _chrome(slide, "Year 1 forecast", "Median of the size-adjusted analogues, ramped")
    quarters = result["year1_quarter_units"]
    _table(slide, Inches(0.7), Inches(1.8), Inches(7.2),
           ["Quarter", "Units", "Gross profit"],
           [[f"Q{i + 1}", units(q), eur(q * result["unit_gross_profit_eur"])]
            for i, q in enumerate(quarters)],
           col_widths=[Inches(2.0), Inches(2.6), Inches(2.6)])
    _metric(slide, Inches(8.5), Inches(1.9), "Year 1 units",
            units(result["year1_units"]))
    _metric(slide, Inches(8.5), Inches(3.0), "Year 1 gross profit",
            eur(result["year1_gross_profit_eur"]))
    _metric(slide, Inches(8.5), Inches(4.1), "Launch investment",
            eur(inputs["ap_request_eur"]))


def _slide_three_year(prs, record) -> None:
    slide = _blank(prs)
    result = record["result"]
    _chrome(slide, "Three-year view", "Volume and gross profit, years 1 to 3")
    _table(slide, Inches(0.7), Inches(1.8), Inches(8.4),
           ["Year", "Units", "Gross profit"],
           [[f"Year {y['year']}", units(y["units"]), eur(y["gross_profit_eur"])]
            for y in result["years"]],
           col_widths=[Inches(2.4), Inches(3.0), Inches(3.0)],
           row_height=Inches(0.42), font_size=12)
    _metric(slide, Inches(9.3), Inches(1.9), "Cumulative gross profit",
            eur(result["cumulative_gross_profit_eur"]), width=Inches(3.3))


def _slide_payback(prs, record) -> None:
    slide = _blank(prs)
    result = record["result"]
    inputs = record["inputs"]
    _chrome(slide, "Payback", "Months until gross profit repays the investment")
    months = result.get("payback_months")
    _metric(slide, Inches(0.7), Inches(2.0), "Payback",
            f"{months:.1f} months" if months else "not within three years",
            value_color=INK if months else WARN, width=Inches(5.0))
    _metric(slide, Inches(6.5), Inches(2.0), "Investment",
            eur(inputs["ap_request_eur"]), width=Inches(5.0))
    _text(slide, Inches(0.7), Inches(3.4), Inches(11.9), Inches(1.2),
          "Gross profit is spread evenly across the months of each year. Payback "
          "is the point at which cumulative gross profit equals the investment.",
          size=13, color=MUTED)


def _slide_appendix(prs, record) -> None:
    slide = _blank(prs)
    inputs = record["inputs"]
    _chrome(slide, APPENDIX_TITLE, "Raw inputs and every comparable used")

    raw = [["Depth", inputs["depth"]], ["Market", inputs["market"]],
           ["Category", inputs["category"]], ["Need state", inputs["need_state"]]]
    if inputs["depth"] == "activation":
        raw += [["Brand", f"{inputs['brand_name']} ({inputs['brand_id']})"],
                ["Mechanic", inputs["mechanic"] or NOT_SUPPLIED],
                ["Period", (f"{inputs['period_weeks']} weeks from "
                            f"{MONTHS[inputs['period_start_month']]}"
                            if inputs["period_weeks"]
                            and inputs["period_start_month"] else NOT_SUPPLIED)],
                ["Baseline rate of sale",
                 f"{units(inputs['base_rate_of_sale_units_week'])} units/week"]]
    cm = inputs["contribution_margin_pct"]
    raw += [["Net price", eur(inputs["net_price_eur"], 2)],
            ["Contribution margin", pct(cm * 100 if cm is not None else None)],
            ["A&P request", eur(inputs["ap_request_eur"])]]
    _table(slide, Inches(0.7), Inches(1.8), Inches(5.4), ["Input", "Value"], raw,
           col_widths=[Inches(2.4), Inches(3.0)], font_size=10,
           row_height=Inches(0.28))

    if inputs["depth"] == "activation":
        headers = ["Activation", "Year", "Month", "Weeks", "Spend", "Uplift",
                   "Quality"]
        rows = [[c["activation_id"], c["year"], c["start_month"],
                 c["duration_weeks"], eur(float(c["spend_eur"])),
                 pct(float(c["measured_uplift_pct"])), c["data_quality"]]
                for c in record["comparables"][:12]]
        widths = [Inches(1.3), Inches(0.7), Inches(0.8), Inches(0.8), Inches(1.2),
                  Inches(1.0), Inches(1.0)]
    else:
        headers = ["Launch", "Market", "Year", "Forecast", "Actual"]
        rows = [[a["launch_id"], a["market"], a["launch_year"],
                 units(float(a["forecast_year1_units"])),
                 units(float(a["actual_year1_units"]))]
                for a in record["analogues"][:12]]
        widths = [Inches(1.4), Inches(1.2), Inches(1.0), Inches(1.6), Inches(1.6)]
    if rows:
        _table(slide, Inches(6.5), Inches(1.8), Inches(6.1), headers, rows,
               col_widths=widths, font_size=10, row_height=Inches(0.28))
    else:
        _text(slide, Inches(6.5), Inches(1.8), Inches(6.1), Inches(0.6),
              "No comparables matched this request.", size=12, color=WARN)


BUILDERS = {
    "The ask": _slide_ask,
    "Forecast": _slide_forecast,
    "Portfolio impact": _slide_portfolio,
    "Sensitivity": _slide_sensitivity,
    "Assumptions and check-back": _slide_assumptions,
    "Market and analogues": _slide_market,
    "Year 1 forecast": _slide_year1,
    "Three-year view": _slide_three_year,
    "Payback": _slide_payback,
}


def slide_titles(record: dict) -> list[str]:
    """The fixed slide order for this record (OUT-3, OUT-4, OUT-6, OUT-10)."""
    if record["result"]["status"] != "OK":
        return ["The ask", APPENDIX_TITLE]
    return BODY_SLIDES[record["depth"]] + [APPENDIX_TITLE]


def render(record: dict, out_path: Path) -> Path:
    prs = Presentation(str(TEMPLATE)) if TEMPLATE.exists() else Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    for title in slide_titles(record):
        if title == APPENDIX_TITLE:
            _slide_appendix(prs, record)
        else:
            BUILDERS[title](prs, record)

    core = prs.core_properties
    core.title = record["case_title"]
    core.author = "Investment Case skill"
    core.last_modified_by = "Investment Case skill"
    core.comments = FOOTER_TEXT
    core.created = FIXED_TIME
    core.modified = FIXED_TIME
    core.revision = 1

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out_path))
    _freeze_zip(out_path)
    return out_path


def _freeze_zip(path: Path) -> None:
    """Rewrite the package with constant timestamps so runs are byte-identical."""
    temp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path, "r") as source:
        infos = source.infolist()
        with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as target:
            for info in infos:
                data = source.read(info.filename)
                frozen = zipfile.ZipInfo(info.filename, date_time=(1980, 1, 1, 0, 0, 0))
                frozen.compress_type = zipfile.ZIP_DEFLATED
                frozen.external_attr = info.external_attr
                frozen.create_system = 0
                target.writestr(frozen, data)
    shutil.move(str(temp), str(path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a case deck.")
    parser.add_argument("calculation", type=Path, help="calculation .json file")
    parser.add_argument("--out", type=Path, required=True, help="output .pptx")
    args = parser.parse_args()
    record = json.loads(args.calculation.read_text(encoding="utf-8"))
    path = render(record, args.out)
    print(f"wrote {path} ({len(slide_titles(record))} slides)")


if __name__ == "__main__":
    main()
