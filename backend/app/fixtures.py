"""Load fixture JSON for the stub endpoints."""

import json
from functools import lru_cache
from pathlib import Path

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@lru_cache(maxsize=None)
def load(customer: str, name: str) -> dict:
    """Return `{customer}_{name}.json`, falling back to Maya's when a customer has no fixture yet."""
    for cid in (customer, "maya"):
        path = FIXTURE_DIR / f"{cid}_{name}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError(f"No fixture for {name}")
