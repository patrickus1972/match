import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / ".claude" / "skills" / "investment-case"
SCRIPTS = SKILL / "scripts"
DATA = SKILL / "reference" / "data"
FIXTURES = Path(__file__).resolve().parent / "fixtures"

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def data_dir() -> Path:
    return DATA


@pytest.fixture(scope="session")
def ds():
    import dataset
    return dataset.Dataset(DATA)


@pytest.fixture
def out_dir(tmp_path) -> Path:
    return tmp_path / "out"
