"""Build the neutral stand-in gate template (reference/gate_template.pptx).

Open question Q1/Q2 in the requirements: until the real STADA gate and budget
templates are supplied, the deck renders on this neutral 16:9 master. Replacing
this file with the real template is the only change needed.
"""

from __future__ import annotations

import datetime as _dt
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches

OUT = Path(__file__).resolve().parent.parent / "reference" / "gate_template.pptx"
FIXED_TIME = _dt.datetime(2026, 1, 1, 0, 0, 0)


def build(path: Path = OUT) -> Path:
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    core = prs.core_properties
    core.title = "CHC investment case — neutral stand-in template"
    core.author = "Investment Case skill"
    core.last_modified_by = "Investment Case skill"
    core.created = FIXED_TIME
    core.modified = FIXED_TIME
    core.revision = 1
    path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(path))
    return path


if __name__ == "__main__":
    print(f"wrote {build()}")
