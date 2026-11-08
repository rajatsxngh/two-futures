"""The one Plaid sandbox connection this demo server holds.

Flow: the browser gets a `link_token` (POST /api/plaid/link_token), opens
Plaid Link, the user picks a sandbox bank and logs in with Plaid's test login,
and the browser sends back the `public_token` (POST /api/plaid/exchange). Here
we exchange it for an `access_token`, pull accounts, transactions and
liabilities, build the customer with `engine/plaid_adapter.py`, and register it
as customer `sandbox`.

The `access_token` lives only in this process's memory (never on disk, never
in a response or a log). Connecting again replaces the old connection;
disconnecting removes the item at Plaid and forgets the customer.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from threading import Lock

from . import config, plaid_client
from .engine import backtest, forecast, futures, state
from .engine.data import (
    MIN_BACKTEST_MONTHS,
    MIN_FORECAST_MONTHS,
    CustomerData,
    history_days,
    history_months,
    register,
    unregister,
)
from .engine.plaid_adapter import CUSTOMER_ID, to_customer
from .models import ConnectedAccount, PlaidConnection

LABEL = "Sandbox bank"  # short: it has to fit the customer picker


@dataclass
class _Connection:
    access_token: str
    summary: PlaidConnection


_CONN: _Connection | None = None
_LOCK = Lock()


def _clear_engine_caches() -> None:
    """The engine caches results by customer id; a new connection reuses the id, so drop the old results.
    (Maya's and the household's results simply recompute on their next request, in well under a second.)"""
    forecast._cached_forecast.cache_clear()
    futures._cached.cache_clear()
    backtest.backtest_for.cache_clear()
    state.reset(CUSTOMER_ID)


def summarize(data: CustomerData, institution: str, today: dt.date) -> PlaidConnection:
    months = history_months(data, today)
    days = history_days(data, today)
    note = None
    if months < MIN_FORECAST_MONTHS:
        note = (f"This bank sent {days} days of transactions. The score and accounts work; the forecast, the two "
                f"futures and what-ifs need at least {MIN_FORECAST_MONTHS} months.")
    elif months < MIN_BACKTEST_MONTHS:
        note = f"This bank sent {days} days of transactions; the backtest needs 12 months, so it's skipped."
    names = {a.id: a.name for a in data.accounts}
    defaults = [f"{names.get(acct, acct)}: {n}" for acct, notes in data.account_notes.items() for n in notes[1:]
                if "default" in n or "worked out" in n or "Used" in n]
    labels = {"insurance": "Insurance", "planning_ahead": "Planning ahead"}
    defaults += [f"{labels.get(ind, ind)}: {n}" for ind, notes in data.indicator_notes.items() for n in notes
                 if "default" in n.lower()]
    return PlaidConnection(
        customer=data.customer.id, label=LABEL, institution=institution,
        connected_at=dt.datetime.now(dt.timezone.utc).replace(microsecond=0),
        accounts=[ConnectedAccount(id=a.id, name=a.name, type=a.type, balance=a.balance) for a in data.accounts],
        transactions=len(data.transactions), history_days=days,
        forecast_ready=months >= MIN_FORECAST_MONTHS, backtest_ready=months >= MIN_BACKTEST_MONTHS,
        defaults=defaults, note=note,
    )


def pull(access_token: str) -> dict:
    """Everything the adapter needs, from Plaid."""
    accounts = plaid_client.accounts(access_token)
    institution_id = (accounts.get("item") or {}).get("institution_id")
    return {
        "institution": {"id": institution_id, "name": plaid_client.institution_name(institution_id)},
        "accounts": accounts.get("accounts", []),
        "transactions": plaid_client.transactions(access_token),
        "liabilities": plaid_client.liabilities(access_token),
    }


def connect(public_token: str) -> PlaidConnection:
    """Exchange the public_token, pull the data, build and register the customer. Raises PlaidError or
    AdapterError with plain-words messages."""
    global _CONN
    access = plaid_client.exchange(public_token)
    try:
        raw = pull(access)
        today = config.DEMO_TODAY
        data = to_customer(raw, today, pulled_on=dt.date.today())
    except Exception:
        plaid_client.remove_item(access)  # don't leave an item we can't use
        raise
    summary = summarize(data, raw["institution"]["name"] or "Plaid sandbox bank", config.DEMO_TODAY)
    with _LOCK:
        old = _CONN
        register(data)
        _clear_engine_caches()
        _CONN = _Connection(access_token=access, summary=summary)
    if old is not None and old.access_token != access:
        plaid_client.remove_item(old.access_token)
    return summary


def connect_data(data: CustomerData, institution: str) -> PlaidConnection:
    """Register an already-built customer without Plaid (tests and fixtures)."""
    global _CONN
    summary = summarize(data, institution, config.DEMO_TODAY)
    with _LOCK:
        register(data)
        _clear_engine_caches()
        _CONN = _Connection(access_token="", summary=summary)
    return summary


def disconnect() -> bool:
    global _CONN
    with _LOCK:
        old, _CONN = _CONN, None
        unregister(CUSTOMER_ID)
        _clear_engine_caches()
    if old and old.access_token:
        plaid_client.remove_item(old.access_token)
    return old is not None


def current() -> PlaidConnection | None:
    return _CONN.summary if _CONN else None
