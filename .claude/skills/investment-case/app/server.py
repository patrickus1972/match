"""A front end for the investment case Skill — brief in, PowerPoint out.

Runs the real scripts. Every figure on screen comes from `calculate.py`, and the
download is the same .pptx the Skill produces; nothing here recomputes anything.

    python .claude/skills/investment-case/app/server.py
    open http://localhost:8000

Standard library only, so there is nothing to install beyond python-pptx.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP = Path(__file__).resolve().parent
SCRIPTS = APP.parent / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import calculate as calc  # noqa: E402
import dataset as ds_mod  # noqa: E402
import render_deck as rd  # noqa: E402
import run_case  # noqa: E402
import ui  # noqa: E402

OUT = APP.parent / "out" / "web"

EXAMPLES = [
    "Six-week in-pharmacy display for Kalvora in Q4, €80,000.",
    "New allergy product for Poland, rough case for the ideation committee, around 900k.",
    "Full business case for stage gate 3, gut health line in Serbia, 1.4m.",
    "NPI case for Gate 3, immunity range in Germany, 1.2 mio investment.",
    "Eight-week digital awareness campaign in Germany for Vitarel, €330,000.",
    "Four-week TV burst for Ferrovita in Poland, €90,000.",
]


class Handler(BaseHTTPRequestHandler):
    dataset: ds_mod.Dataset

    # -- plumbing ---------------------------------------------------------
    def log_message(self, fmt, *args):  # quieter console
        pass

    def _send(self, body: bytes, content_type: str, status: int = 200,
              extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _html(self, markup: str, status: int = 200) -> None:
        self._send(markup.encode("utf-8"), "text/html; charset=utf-8", status)

    # -- routes -----------------------------------------------------------
    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            self._html(ui.page(self.dataset, EXAMPLES))
        elif parsed.path == "/download":
            self._download(urllib.parse.parse_qs(parsed.query))
        else:
            self._html(ui.not_found(), 404)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8"))
        field = lambda name: (form.get(name, [""])[0] or "").strip()

        if parsed.path == "/read":
            # Step 1: read the brief and fill the form in. Nothing is calculated.
            brief = field("brief")
            guess = ds_mod.parse_brief(
                brief,
                [b["brand_name"] for b in self.dataset.brands],
                sorted({b["need_state"] for b in self.dataset.brands}))
            self._html(ui.page(self.dataset, EXAMPLES, brief=brief, guess=guess))
            return

        if parsed.path == "/build":
            self._build(field)
            return

        self._html(ui.not_found(), 404)

    # -- actions ----------------------------------------------------------
    def _build(self, field) -> None:
        brief = field("brief")
        depth = field("depth") or "activation"
        number = lambda name: float(field(name)) if field(name) else None
        integer = lambda name: int(field(name)) if field(name) else None

        request = {
            "case_id": field("case_id") or "WEB-0001",
            "case_title": field("title") or None,
            "request_text": brief,
            "depth": depth,
            "ap_request_eur": number("spend"),
        }
        if depth == "activation":
            request |= {
                "brand": field("brand"),
                "mechanic": field("mechanic"),
                "period_start_month": integer("month"),
                "period_weeks": integer("weeks"),
            }
        else:
            request |= {
                "market": field("market"),
                "category": field("category"),
                "need_state": field("need_state"),
                "concept_name": field("concept") or "New product concept",
            }
        if field("cm"):
            request["contribution_margin_pct"] = float(field("cm")) / 100.0

        try:
            # INT-3: ask once for whatever is genuinely absent, before any
            # calculation. Only an insisted-on run produces a marked deck.
            missing = calc.missing_required(ds_mod.build_inputs(self.dataset, request))
            if missing:
                self._html(ui.page(self.dataset, EXAMPLES, brief=brief,
                                   guess=request, needs=missing))
                return
            record, paths = run_case.run(request, OUT)
        except (ds_mod.UnknownReference, ds_mod.OutOfScope) as exc:
            self._html(ui.page(self.dataset, EXAMPLES, brief=brief,
                               guess=request, refusal=str(exc)))
            return

        self._html(ui.page(self.dataset, EXAMPLES, brief=brief, guess=request,
                           record=record, paths=paths))

    def _download(self, query: dict) -> None:
        name = (query.get("f") or [""])[0]
        path = (OUT / name).resolve()
        # Only ever serve a file this run produced.
        if not str(path).startswith(str(OUT.resolve())) or not path.exists():
            self._html(ui.not_found(), 404)
            return
        kinds = {".pptx": "application/vnd.openxmlformats-officedocument"
                          ".presentationml.presentation",
                 ".json": "application/json",
                 ".csv": "text/csv"}
        self._send(path.read_bytes(), kinds.get(path.suffix, "application/octet-stream"),
                   extra={"Content-Disposition": f'attachment; filename="{path.name}"'})


def serve(port: int = 8000) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    Handler.dataset = ds_mod.Dataset()
    try:
        server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    except OSError as exc:
        print(f"Cannot start on port {port}: {exc}")
        print(f"Something else is using it — try --port {port + 1}.")
        raise SystemExit(1)

    print(f"Investment case front end on http://localhost:{port}")
    print(f"Decks are written to {OUT}")
    print(f"Footer on every slide: {rd.FOOTER_TEXT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the demo front end.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    serve(args.port)
