"""Plaid sandbox client: every Plaid API call happens here, on the server.

Keys come from `frontend/.env.local` (git-ignored; the same file the ElevenLabs
script reads) or the environment: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV.
Only the sandbox environment is allowed. Key values are never logged, echoed or
put in an error: `PlaidError` carries Plaid's error *code* and a plain message
only, never the request body or the raw response.

The browser only ever sees a `link_token` and sends back a `public_token`. The
`access_token` stays in this process's memory (see `app/connected.py`).
"""

from __future__ import annotations

import os
import re
import time
from datetime import date
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "frontend" / ".env.local"
KEYS = ("PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV")
HOSTS = {"sandbox": "https://sandbox.plaid.com"}
TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# Plaid error codes we turn into plain words. Anything else becomes a generic message.
PLAIN = {
    "INVALID_API_KEYS": "The Plaid keys were rejected. Check PLAID_CLIENT_ID and PLAID_SECRET in frontend/.env.local.",
    "INVALID_PUBLIC_TOKEN": "That bank connection expired or was already used. Connect again.",
    "INVALID_ACCESS_TOKEN": "The bank connection is no longer valid. Connect again.",
    "ITEM_LOGIN_REQUIRED": "The bank needs you to log in again. Connect again.",
    "PRODUCT_NOT_READY": "The bank's transactions aren't ready yet. Try again in a few seconds.",
    "RATE_LIMIT_EXCEEDED": "Plaid is rate-limiting requests. Wait a moment and try again.",
    "INSTITUTION_DOWN": "That test bank is unavailable right now. Try another.",
    "INSTITUTION_NOT_RESPONDING": "That test bank is unavailable right now. Try another.",
}


class PlaidError(Exception):
    """A Plaid failure safe to show: a code and plain words, nothing from the request."""

    def __init__(self, message: str, code: str = "PLAID_ERROR", status: int = 502):
        super().__init__(message)
        self.code = code
        self.status = status


def _read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m and m.group(1) in KEYS and not line.lstrip().startswith("#"):
                values[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return values


def settings() -> dict[str, str]:
    """The three Plaid settings: environment first, then frontend/.env.local. Never print the result."""
    values = _read_env_file()
    for k in KEYS:
        if os.environ.get(k):
            values[k] = os.environ[k]
    return values


def configured() -> tuple[bool, str]:
    """(ready, reason). Ready only with both keys and PLAID_ENV=sandbox."""
    s = settings()
    if not s.get("PLAID_CLIENT_ID") or not s.get("PLAID_SECRET"):
        return False, "Plaid keys aren't set (PLAID_CLIENT_ID and PLAID_SECRET in frontend/.env.local)."
    env = (s.get("PLAID_ENV") or "sandbox").lower()
    if env not in HOSTS:
        return False, "Only the Plaid sandbox is supported here (set PLAID_ENV=sandbox)."
    return True, "ready"


def _post(path: str, body: dict, retries_not_ready: int = 0) -> dict:
    ok, reason = configured()
    if not ok:
        raise PlaidError(reason, "NOT_CONFIGURED", 503)
    s = settings()
    payload = {"client_id": s["PLAID_CLIENT_ID"], "secret": s["PLAID_SECRET"], **body}
    url = HOSTS[(s.get("PLAID_ENV") or "sandbox").lower()] + path
    for attempt in range(retries_not_ready + 1):
        try:
            r = httpx.post(url, json=payload, timeout=TIMEOUT)
        except httpx.HTTPError:
            # The exception text can include the URL but never the body; still, keep it generic.
            raise PlaidError("Couldn't reach Plaid. Check the internet connection and try again.",
                             "NETWORK_ERROR") from None
        try:
            data = r.json()
        except ValueError:
            raise PlaidError("Plaid sent an unreadable answer. Try again.", "BAD_RESPONSE") from None
        if r.status_code == 200:
            return data
        code = str(data.get("error_code") or "") if isinstance(data, dict) else ""
        code = code if re.fullmatch(r"[A-Z_]{1,64}", code) else "PLAID_ERROR"  # only Plaid's fixed codes pass
        if code == "PRODUCT_NOT_READY" and attempt < retries_not_ready:
            time.sleep(min(2.0 + attempt, 5.0))
            continue
        status = 400 if code in ("INVALID_PUBLIC_TOKEN", "INVALID_ACCESS_TOKEN", "ITEM_LOGIN_REQUIRED") else 502
        if code == "INVALID_API_KEYS":
            status = 503
        raise PlaidError(PLAIN.get(code, f"Plaid couldn't complete the request ({code})."), code, status)
    raise PlaidError(PLAIN["PRODUCT_NOT_READY"], "PRODUCT_NOT_READY", 503)  # pragma: no cover


# ---------------------------------------------------------------------------
# The calls we make
# ---------------------------------------------------------------------------

DAYS_REQUESTED = 730  # ask for 24 months of transactions


def create_link_token(client_user_id: str) -> dict:
    return _post("/link/token/create", {
        "client_name": "Two Futures (demo)",
        "language": "en",
        "country_codes": ["US"],
        "user": {"client_user_id": client_user_id},
        "products": ["transactions"],
        "optional_products": ["liabilities"],
        "transactions": {"days_requested": DAYS_REQUESTED},
    })


def sandbox_public_token(institution_id: str = "ins_109508") -> str:
    """Testing only: a public_token without the Link UI (First Platypus Bank, user_good)."""
    data = _post("/sandbox/public_token/create", {
        "institution_id": institution_id,
        "initial_products": ["transactions", "liabilities"],
        "options": {"transactions": {"days_requested": DAYS_REQUESTED}},
    })
    return data["public_token"]


def exchange(public_token: str) -> str:
    return _post("/item/public_token/exchange", {"public_token": public_token})["access_token"]


def accounts(access_token: str) -> dict:
    return _post("/accounts/get", {"access_token": access_token})


def transactions(access_token: str, wait_seconds: float = 45.0) -> list[dict]:
    """Every transaction Plaid has for the item (up to DAYS_REQUESTED days), via /transactions/sync.

    A new sandbox item fills in over a few seconds: first about 30 days, then the full history. Keep syncing
    until Plaid says the historical update is complete and one more call brings nothing new, or `wait_seconds`
    pass (then whatever arrived is used, and the adapter says how much history there was).
    """
    by_id: dict[str, dict] = {}
    cursor: str | None = None
    deadline = time.monotonic() + wait_seconds
    quiet = 0  # sync calls in a row, after the historical update is complete, that brought nothing new
    while time.monotonic() < deadline:
        body = {"access_token": access_token, "count": 500}
        if cursor:
            body["cursor"] = cursor
        data = _post("/transactions/sync", body, retries_not_ready=3)
        new = data.get("added", []) + data.get("modified", [])
        for t in new:
            by_id[t["transaction_id"]] = t
        for r in data.get("removed", []):
            by_id.pop(r.get("transaction_id"), None)
        cursor = data.get("next_cursor") or cursor
        if data.get("has_more"):
            continue
        if data.get("transactions_update_status") == "HISTORICAL_UPDATE_COMPLETE":
            quiet = 0 if new else quiet + 1
            # Plaid can report "complete" a moment before the older history is ready to sync.
            if quiet >= (1 if _span_days(by_id) > 300 else 4):
                break
        time.sleep(1.5)
    return sorted(by_id.values(), key=lambda t: (t.get("date") or "", t.get("transaction_id") or ""))


def _span_days(by_id: dict[str, dict]) -> int:
    dates = sorted(t["date"] for t in by_id.values() if t.get("date"))
    if not dates:
        return 0
    return (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days


def liabilities(access_token: str) -> dict | None:
    """Card limits, APRs and loan payments, when the item has the product. None when it doesn't."""
    try:
        return _post("/liabilities/get", {"access_token": access_token}, retries_not_ready=3).get("liabilities")
    except PlaidError as e:
        if e.code in ("PRODUCTS_NOT_SUPPORTED", "PRODUCT_NOT_ENABLED", "INVALID_PRODUCT", "NO_LIABILITY_ACCOUNTS",
                      "PRODUCT_NOT_READY", "ADDITIONAL_CONSENT_REQUIRED"):
            return None
        raise


def institution_name(institution_id: str | None) -> str | None:
    if not institution_id:
        return None
    try:
        data = _post("/institutions/get_by_id", {"institution_id": institution_id, "country_codes": ["US"]})
        return data.get("institution", {}).get("name")
    except PlaidError:
        return None


def remove_item(access_token: str) -> None:
    try:
        _post("/item/remove", {"access_token": access_token})
    except PlaidError:
        pass  # disconnecting locally still works
