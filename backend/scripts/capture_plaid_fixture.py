"""Save a Plaid sandbox pull as a test fixture (tests/fixtures/plaid_<name>.json).

    uv run python scripts/capture_plaid_fixture.py               # First Platypus Bank, user_good
    uv run python scripts/capture_plaid_fixture.py user_yuppie   # a sandbox persona with ~1 month of history
    uv run python scripts/capture_plaid_fixture.py --rescrub     # drop fields from the saved files again

Sandbox only, no Link UI (/sandbox/public_token/create). The file keeps the
responses' data (accounts, transactions, liabilities) and drops every token,
request id and the item id. Account and transaction ids are Plaid sandbox ids.
The item is removed from Plaid afterwards. Keys are read by app/plaid_client.py
and never printed.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import plaid_client as pc  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
DROP = {"access_token", "public_token", "link_token", "request_id", "item_id", "consent_expiration_time",
        # personal-looking fields (sandbox values are made up, but a fixture shouldn't carry them)
        "property_address", "servicer_address", "account_owner", "account_number", "owners", "location"}


def scrub(x):
    if isinstance(x, dict):
        return {k: scrub(v) for k, v in x.items() if k not in DROP}
    if isinstance(x, list):
        return [scrub(v) for v in x]
    return x


def rescrub(path: Path) -> None:
    """Apply `scrub` to a saved fixture again (after DROP grows)."""
    data = scrub(json.loads(path.read_text(encoding="utf-8")))
    path.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    if sys.argv[1:2] == ["--rescrub"]:
        for p in sorted(OUT.glob("plaid_*.json")):
            rescrub(p)
            print(f"Rescrubbed {p.name}")
        return
    user = sys.argv[1] if len(sys.argv) > 1 else "user_good"
    ok, reason = pc.configured()
    if not ok:
        sys.exit(reason)
    body = {"institution_id": "ins_109508", "initial_products": ["transactions", "liabilities"],
            "options": {"transactions": {"days_requested": pc.DAYS_REQUESTED}}}
    if user != "user_good":
        body["options"].update(override_username=user, override_password="pass_good")
    public = pc._post("/sandbox/public_token/create", body)["public_token"]
    access = pc.exchange(public)
    try:
        acc = pc.accounts(access)
        txns = pc.transactions(access)
        liab = pc.liabilities(access)
        inst = pc.institution_name(acc.get("item", {}).get("institution_id"))
    finally:
        pc.remove_item(access)
    sample = scrub({
        "captured_on": date.today().isoformat(),
        "sandbox_user": user,
        "institution": {"id": acc.get("item", {}).get("institution_id"), "name": inst},
        "accounts": acc["accounts"],
        "transactions": txns,
        "liabilities": liab,
    })
    OUT.mkdir(parents=True, exist_ok=True)
    name = "user_good" if user == "user_good" else user
    path = OUT / f"plaid_{name}.json"
    path.write_text(json.dumps(sample, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Saved {path.name}: {len(sample['accounts'])} accounts, {len(txns)} transactions, "
          f"liabilities {'yes' if liab else 'no'}")


if __name__ == "__main__":
    main()
