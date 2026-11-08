"""Plaid sandbox -> Customer adapter, and the engine on odd bank shapes.

Fixtures are saved sandbox responses (scripts/capture_plaid_fixture.py): no tokens, sandbox ids only.
  plaid_user_good.json    First Platypus Bank, user_good: 14 accounts, 24 months, liabilities
  plaid_user_yuppie.json  one checking account, about a month of history
"""

from __future__ import annotations

import copy
import json
import re
from datetime import date
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import connected, plaid_client
from app.config import DEMO_TODAY
from app.engine import plaid_adapter as pa
from app.engine.data import load
from app.main import app
from app.models import AccountType

FIXTURES = Path(__file__).parent / "fixtures"
client = TestClient(app)


def raw(name: str = "user_good") -> dict:
    return json.loads((FIXTURES / f"plaid_{name}.json").read_text(encoding="utf-8"))


def build(r: dict | None = None):
    r = r or raw()
    return pa.to_customer(r, DEMO_TODAY, date.fromisoformat(r["captured_on"]))


@pytest.fixture
def sandbox():
    """Register a customer as 'sandbox' for the test, and always disconnect afterwards."""
    def _connect(data, institution="First Platypus Bank"):
        return connected.connect_data(data, institution)
    yield _connect
    connected.disconnect()


# ---------------------------------------------------------------------------
# The saved fixtures themselves
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["user_good", "user_yuppie"])
def test_fixture_has_no_tokens(name):
    text = (FIXTURES / f"plaid_{name}.json").read_text(encoding="utf-8")
    assert not re.search(r"(access|public|link)-(sandbox|development|production)-", text)
    for key in ("access_token", "public_token", "link_token", "request_id", "item_id", "property_address"):
        assert f'"{key}"' not in text


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------

def test_account_types_and_main_accounts():
    d = build()
    by_name = {a.name: a for a in d.accounts}
    assert by_name["Plaid Checking"].type == AccountType.checking
    assert by_name["Plaid Money Market"].type == AccountType.savings
    assert by_name["Plaid CD"].type == AccountType.cd
    assert by_name["Plaid 401k"].type == AccountType.ira
    assert by_name["Plaid HSA"].type == AccountType.ira  # not counted in the cushion
    assert by_name["Plaid Auto Loan"].type == AccountType.auto_loan
    assert by_name["Plaid Mortgage"].type == AccountType.mortgage
    assert by_name["Plaid Student Loan"].type == AccountType.personal_loan
    # the engine treats the first checking / savings / card as the main ones
    first = {t: next(a for a in d.accounts if a.type == t).name for t in
             (AccountType.checking, AccountType.savings, AccountType.credit_card)}
    assert first == {AccountType.checking: "Plaid Checking", AccountType.savings: "Plaid Saving",
                     AccountType.credit_card: "Plaid Credit Card"}
    assert len({a.id for a in d.accounts}) == len(d.accounts) == 14


def test_liabilities_fill_rates_limits_and_payments():
    d = build()
    by_name = {a.name: a for a in d.accounts}
    card = by_name["Plaid Credit Card"]
    assert (card.rate, card.limit, card.min_payment, card.due_day) == (12.5, 2000, 20, 28)  # all from Plaid
    auto = by_name["Plaid Auto Loan"]
    assert (auto.rate, auto.min_payment, auto.due_day) == (6.24, 411.37, 15)
    biz = by_name["Plaid Business Credit Card"]  # no liabilities record: defaults, each listed
    assert biz.rate == pa.DEFAULTS["card_apr"] and biz.limit == 10000
    assert any("default" in n for n in d.account_notes[biz.id])
    # a $25 payment on $65k at 5.25% never shrinks the loan: replaced, and said so
    student = by_name["Plaid Student Loan"]
    assert student.min_payment > student.balance * student.rate / 100 / 12
    assert any("never shrink" in n for n in d.account_notes[student.id])
    assert d.indicator_notes["debt_load"]


def test_signs_and_categories():
    d = build()
    pay = [t for t in d.transactions if t.category == "paycheck"]
    assert len(pay) == 24 and all(t.amount == 5850 for t in pay)  # sandbox records them as money out: flipped
    assert any("recorded by the sandbox as money out" in s for s in d.assumptions)
    starbucks = [t for t in d.transactions if t.merchant == "Starbucks"]
    assert starbucks and all(t.amount < 0 and t.category == "dining" for t in starbucks)
    cats = {t.category for t in d.transactions}
    assert {"card_payment", "interest", "transfer", "shopping", "travel"} <= cats
    assert all(t.date <= DEMO_TODAY for t in d.transactions)


@pytest.mark.parametrize("primary,detailed,name,acct,expected", [
    ("INCOME", "INCOME_SALARY", "Salary Deposit ACME", AccountType.checking, "paycheck"),
    ("TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER", "ACH Electronic CreditGUSTO PAY 123456", AccountType.savings,
     "paycheck"),
    ("INCOME", "INCOME_INTEREST_EARNED", "Interest", AccountType.savings, "interest"),
    ("INCOME", "INCOME_DIVIDENDS", "Dividend", AccountType.savings, "other_income"),
    ("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "CREDIT CARD 3333 PAYMENT", AccountType.checking,
     "card_payment"),
    ("LOAN_PAYMENTS", "LOAN_PAYMENTS_CAR_PAYMENT", "Auto pay", AccountType.checking, "auto_loan"),
    ("TRANSFER_OUT", "TRANSFER_OUT_SAVINGS", "To savings", AccountType.checking, "savings_transfer"),
    ("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT", "Rent ACH", AccountType.checking, "housing"),
    ("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_TELEPHONE", "T-Mobile", AccountType.checking, "utilities"),
    ("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "Whole Foods", AccountType.checking, "groceries"),
    ("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", "Starbucks", AccountType.credit_card, "dining"),
    ("GENERAL_SERVICES", "GENERAL_SERVICES_INSURANCE", "Geico", AccountType.checking, "insurance"),
    ("BANK_FEES", "BANK_FEES_LATE_FEES", "Late fee", AccountType.credit_card, "late_fee"),
    (None, None, "Mystery", AccountType.checking, "misc"),
])
def test_category_rules(primary, detailed, name, acct, expected):
    t = {"name": name, "personal_finance_category": {"primary": primary, "detailed": detailed}}
    assert pa.category_of(t, acct) == expected


def test_pay_schedule_and_next_payday():
    d = build()
    c = d.customer
    assert c.pay_schedule == "monthly" and c.take_home_per_paycheck == 5850
    assert c.next_payday > DEMO_TODAY and (c.next_payday - DEMO_TODAY).days <= 31


def test_defaults_are_listed_not_hidden():
    d = build()
    assert d.source and d.source.startswith("plaid_sandbox")
    text = " ".join(d.assumptions)
    assert "Plaid sandbox test data" in text and "Age 35 is a default" in text
    assert "Defaults filled in" in text
    # the setup answers are defaults until answered; each is listed on its indicator
    assert d.indicator_notes["insurance"] and d.indicator_notes["planning_ahead"]
    assert d.customer.setup.insurance.auto is True  # there's an auto loan (lenders require insurance)
    assert d.customer.setup.insurance.renters_or_home is True  # there's a mortgage


def test_data_checks_say_where_money_doesnt_fit():
    d = build()
    text = " ".join(d.data_checks)
    assert "pay lands in Plaid Money Market" in text  # the sandbox deposits pay outside checking
    assert "Plaid Mortgage ($3,141.54 a month)" in text  # liabilities list it; no payment ever appears
    assert set(d.data_checks) <= set(d.assumptions)  # listed, not hidden


def test_dates_shift_to_demo_today():
    r = raw()
    last = max(date.fromisoformat(t["date"]) for t in r["transactions"])
    d = pa.to_customer(r, DEMO_TODAY, date(2026, 11, 15))  # pulled a week after the demo's today
    assert max(t.date for t in d.transactions) == last - (date(2026, 11, 15) - DEMO_TODAY)
    assert any("Dates moved 7 days earlier" in s for s in d.assumptions)


def test_bills_found_from_repeating_essentials():
    assert build(raw("user_yuppie")).bills == []  # one month of history: nothing has repeated 3 times yet
    r = raw("user_yuppie")
    rent = next(t for t in r["transactions"] if t["name"].startswith("Rent"))
    r["transactions"] = [t for t in r["transactions"] if t is not rent] + [
        {**rent, "transaction_id": f"rent{i}", "date": d}
        for i, d in enumerate(("2026-08-03", "2026-09-03", "2026-10-03", "2026-11-03"))]
    d = build(r)
    assert [(b.category, b.amount, b.due_rule.day) for b in d.bills] == [("housing", 3200, 3)]
    assert any("Bills found" in s for s in d.assumptions)


# ---------------------------------------------------------------------------
# The engine on the connected customer
# ---------------------------------------------------------------------------

def test_all_endpoints_run_on_connected_customer(sandbox):
    summary = sandbox(build())
    assert summary.customer == "sandbox" and summary.forecast_ready and summary.backtest_ready
    q = {"customer": "sandbox"}
    for path in ("/api/profile", "/api/health", "/api/forecast", "/api/futures", "/api/backtest"):
        r = client.get(path, params=q)
        assert r.status_code == 200, (path, r.text[:300])
    health = client.get("/api/health", params=q).json()
    assert any("Plaid sandbox test data" in a for a in health["score"]["math"]["assumptions"])
    ins = next(i for i in health["indicators"] if i["id"] == "insurance")
    assert any("Not answered yet" in a for a in ins["value"]["math"]["assumptions"])
    profile = client.get("/api/profile", params=q).json()
    m = next(x for x in profile["account_metrics"] if x["label"] == "Plaid Business Credit Card")
    assert any("default" in a for a in m["math"]["assumptions"])
    assert all("Made-up demo data" not in a for x in profile["account_metrics"] for a in x["math"]["assumptions"])
    fc = client.get("/api/forecast", params=q).json()
    assert fc["headline"] and any("Plaid sandbox" in a for a in fc["assumptions"])
    bt = client.get("/api/backtest", params=q).json()
    assert "Plaid sandbox" in bt["caveat"] and "expect a poor match" in bt["caveat"]
    assert any(a.startswith("Data check") for a in bt["assumptions"])
    # many savings accounts: shortfalls draw on all of them (the $43k money market), so no bill goes unpaid
    fut = client.get("/api/futures", params=q).json()
    money_market = next(a["id"] for a in profile["accounts"] if a["name"] == "Plaid Money Market")
    snaps = fut["paths"]["same_path"]["snapshots"]
    assert all(s["balances"]["unpaid_bills"] == 0 for s in snaps)
    assert min(s["balances"][money_market] for s in snaps) < 43200
    # what-ifs, job loss, setup answers, a simulated transfer, reset
    assert client.post("/api/update_plan", json={"customer": "sandbox", "description": "raise", "preset": "new_job",
                                                 "income_change_yearly": 5000}).status_code == 200
    assert client.post("/api/shock", json={"customer": "sandbox", "job_loss_months": 3}).status_code == 200
    setup = profile["customer"]["setup"] | {"planning_ahead": "yes"}
    assert client.post("/api/setup", json={"customer": "sandbox", "setup": setup}).status_code == 200
    accts = {a["type"]: a["id"] for a in reversed(profile["accounts"])}
    t = client.post("/api/start_transfer", json={"customer": "sandbox", "amount": 100, "frequency": "payday",
                                                 "from_account_id": accts["checking"],
                                                 "to_account_id": accts["savings"], "confirmed": True})
    assert t.status_code == 200, t.text
    assert client.post("/api/reset", params=q).status_code == 200


def test_maya_unchanged_by_a_connection(sandbox):
    before = client.get("/api/futures").json()
    sandbox(build())
    assert client.get("/api/health").json()["score"]["value"] == 55
    assert client.get("/api/futures").json()["next_step"] == before["next_step"]


def test_sandbox_is_404_until_connected():
    connected.disconnect()
    r = client.get("/api/profile", params={"customer": "sandbox"})
    assert r.status_code == 404 and "connected" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Odd shapes: no card, no loans, many accounts, little history, nothing at all
# ---------------------------------------------------------------------------

def _only(r: dict, keep) -> dict:
    r = copy.deepcopy(r)
    r["accounts"] = [a for a in r["accounts"] if keep(a)]
    ids = {a["account_id"] for a in r["accounts"]}
    r["transactions"] = [t for t in r["transactions"] if t["account_id"] in ids]
    return r


def _all_ok(sandbox, data) -> dict:
    sandbox(data)
    q = {"customer": "sandbox"}
    out = {}
    for path in ("/api/profile", "/api/health", "/api/forecast", "/api/futures", "/api/backtest"):
        r = client.get(path, params=q)
        assert r.status_code in (200, 422), (path, r.status_code, r.text[:300])
        out[path] = r
    return out


def test_no_card_no_loans(sandbox):
    d = build(_only(raw(), lambda a: a["type"] == "depository"))
    assert not any(a.group.value == "debt" for a in d.accounts)
    res = _all_ok(sandbox, d)
    assert all(r.status_code == 200 for r in res.values())


def test_card_only_bank_is_refused_plainly():
    with pytest.raises(pa.AdapterError, match="no checking or savings"):
        build(_only(raw(), lambda a: a["type"] == "credit"))


def test_savings_only_becomes_checking(sandbox):
    d = build(_only(raw(), lambda a: a["subtype"] in ("savings", "money market")))
    assert d.accounts[0].type == AccountType.checking
    assert any("treated as checking" in n for n in d.account_notes[d.accounts[0].id])
    res = _all_ok(sandbox, d)
    assert res["/api/forecast"].status_code == 200


def test_many_accounts(sandbox):
    r = raw()
    extra = copy.deepcopy([a for a in r["accounts"] if a["subtype"] == "checking"][0])
    for i in range(6):
        r["accounts"].append({**copy.deepcopy(extra), "account_id": f"extra{i}", "name": f"Extra checking {i}"})
    d = build(r)
    assert sum(a.type == AccountType.checking for a in d.accounts) == 7
    assert d.accounts[0].name == "Plaid Checking"  # the one with the transactions stays the main account
    res = _all_ok(sandbox, d)
    assert all(r.status_code == 200 for r in res.values())


def test_little_history_gives_clear_messages(sandbox):
    d = build(raw("user_yuppie"))
    summary = sandbox(d)
    assert not summary.forecast_ready and summary.note
    res = _all_ok(sandbox, d)
    assert res["/api/profile"].status_code == 200 and res["/api/health"].status_code == 200
    for path in ("/api/forecast", "/api/futures", "/api/backtest"):
        assert res[path].status_code == 422
        assert "Not enough history" in res[path].json()["detail"]
    # health averages over the month there is, not a whole year
    health = res["/api/health"].json()
    ratio = next(i for i in health["indicators"] if i["id"] == "spending_vs_income")
    assert 0 < ratio["value"]["value"] < 200
    r = client.post("/api/update_plan", json={"customer": "sandbox", "description": "x", "spending_change_monthly": 50})
    assert r.status_code == 422


def test_short_but_enough_history(sandbox):
    """Four months of user_good: forecast and futures run on 4-month averages; the backtest says it needs 12."""
    r = raw()
    r["transactions"] = [t for t in r["transactions"] if t["date"] >= "2026-07-01"]
    d = build(r)
    res = _all_ok(sandbox, d)
    assert res["/api/forecast"].status_code == 200 and res["/api/futures"].status_code == 200
    assert res["/api/backtest"].status_code == 422
    assert d.customer.take_home_per_paycheck == pytest.approx(5850, rel=0.01)


def test_no_transactions(sandbox):
    r = raw()
    r["transactions"] = []
    d = build(r)
    assert d.customer.take_home_per_paycheck == 0
    res = _all_ok(sandbox, d)
    assert res["/api/profile"].status_code == 200 and res["/api/health"].status_code == 200


# ---------------------------------------------------------------------------
# Keys and safety
# ---------------------------------------------------------------------------

def test_exchange_validates_input_without_calling_plaid(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("Plaid must not be called")
    monkeypatch.setattr(plaid_client.httpx, "post", boom)
    for bad in ({}, {"public_token": "x"}, {"public_token": "access-sandbox-1234567890abcdef1234"},
                {"public_token": "public-sandbox-<script>alert(1)</script>"},
                {"public_token": "public-sandbox-" + "a" * 300},
                {"public_token": "public-sandbox-1234567890abcdef", "extra": 1}):
        r = client.post("/api/plaid/exchange", json=bad)
        assert r.status_code == 422, bad


def test_missing_keys_explain_and_never_crash(monkeypatch):
    monkeypatch.setattr(plaid_client, "settings", lambda: {})
    s = client.get("/api/plaid/status").json()
    assert s["configured"] is False and "PLAID_CLIENT_ID" in s["reason"]
    r = client.post("/api/plaid/link_token")
    assert r.status_code == 503 and "keys" in r.json()["detail"]


def test_plaid_errors_never_leak_secrets(monkeypatch):
    secret = "sk_TEST_SECRET_VALUE_123"
    monkeypatch.setattr(plaid_client, "settings",
                        lambda: {"PLAID_CLIENT_ID": "cid_TEST_123", "PLAID_SECRET": secret, "PLAID_ENV": "sandbox"})

    def fake_post(url, json, timeout):  # noqa: A002 - mirrors httpx.post
        body = {"error_code": "INVALID_API_KEYS", "error_message": f"bad secret {json['secret']}",
                "display_message": None}
        return httpx.Response(400, json=body)
    monkeypatch.setattr(plaid_client.httpx, "post", fake_post)
    for call in (lambda: client.post("/api/plaid/link_token"),
                 lambda: client.post("/api/plaid/exchange", json={"public_token": "public-sandbox-0000-1111-2222"})):
        r = call()
        assert r.status_code == 503
        assert secret not in r.text and "cid_TEST_123" not in r.text


def test_status_never_returns_keys():
    text = client.get("/api/plaid/status").text
    s = plaid_client.settings()
    for k in ("PLAID_CLIENT_ID", "PLAID_SECRET"):
        if s.get(k):
            assert s[k] not in text
