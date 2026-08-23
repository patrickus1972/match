"""One command, one case: request -> calculation file + comparables CSV + deck.

    python scripts/run_case.py --request tests/fixtures/at1_belgium_display.json

Produces exactly two artefacts per run (OUT-1): a .pptx case deck and a
calculation file (.json plus a comparables .csv alongside it).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import dataset as ds_mod          # noqa: E402
import render_deck                # noqa: E402

DEFAULT_OUT = SCRIPTS.parent / "out"


def write_artefacts(record: dict, out_dir: Path) -> dict[str, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    case_id = record["case_id"]

    calc_path = out_dir / f"{case_id}_calculation.json"
    calc_path.write_text(
        json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8")

    rows = record["comparables"] if record["depth"] == "activation" else record["analogues"]
    comparables_path = out_dir / f"{case_id}_comparables.csv"
    with comparables_path.open("w", newline="\n", encoding="utf-8") as fh:
        if rows:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        else:
            fh.write("no_comparables_matched\n")

    deck_path = render_deck.render(record, out_dir / f"{case_id}_case.pptx")
    return {"calculation": calc_path, "comparables": comparables_path,
            "deck": deck_path}


def run(request: dict, out_dir: Path = DEFAULT_OUT,
        data_dir: Path | None = None) -> tuple[dict, dict[str, Path]]:
    ds = ds_mod.Dataset(data_dir) if data_dir else ds_mod.Dataset()
    record = ds_mod.assemble(ds, request)
    return record, write_artefacts(record, out_dir)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build one investment case.")
    parser.add_argument("--request", type=Path, help="request .json file")
    parser.add_argument("--brand", help="brand id or name")
    parser.add_argument("--mechanic")
    parser.add_argument("--month", type=int)
    parser.add_argument("--weeks", type=int)
    parser.add_argument("--spend", type=float)
    parser.add_argument("--depth", default="activation")
    parser.add_argument("--case-id", default="CASE-0001")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if args.request:
        request = json.loads(args.request.read_text(encoding="utf-8"))
    else:
        request = {"case_id": args.case_id, "depth": args.depth,
                   "brand": args.brand, "mechanic": args.mechanic,
                   "period_start_month": args.month, "period_weeks": args.weeks,
                   "ap_request_eur": args.spend}

    try:
        record, paths = run(request, args.out)
    except (ds_mod.UnknownReference, ds_mod.OutOfScope) as exc:
        print(f"REQUEST REFUSED: {exc}")
        return 2

    status = record["result"]["status"]
    print(f"status: {status}")
    for note in record["advisories"]:
        print(f"  flag [{note['code']}]: {note['text']}")
    for label, path in paths.items():
        print(f"  {label:12s} {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
