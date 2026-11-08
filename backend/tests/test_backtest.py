"""Backtest: deterministic, sane, and blind to the hidden days."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import DEMO_TODAY
from app.engine.backtest import HOLDOUT_DAYS, balance_on, run_backtest
from app.engine.data import load
from app.main import app

client = TestClient(app)


def forecast_part(r):
    """Everything the model predicted (not the real balances or the scores)."""
    lows = [i.value for i in r.low_predicted.math.inputs if i.label != "Real low"]
    return [(p.date, p.p10, p.p25, p.p50, p.p75, p.p90) for p in r.series], r.low_predicted.value, lows


@pytest.mark.parametrize("customer", ["maya", "household"])
def test_deterministic(customer):
    a = run_backtest(load(customer), DEMO_TODAY)
    b = run_backtest(load(customer), DEMO_TODAY)
    assert a == b


@pytest.mark.parametrize("customer", ["maya", "household"])
def test_numbers_are_sane(customer):
    r = run_backtest(load(customer), DEMO_TODAY)
    assert r.holdout_days == HOLDOUT_DAYS == 91
    assert r.cutoff == DEMO_TODAY - timedelta(days=91)
    assert len(r.series) == HOLDOUT_DAYS + 1
    assert 0 <= r.coverage_80.value <= 100
    assert 0 <= r.coverage_50.value <= r.coverage_80.value  # the middle half sits inside the wider range
    assert r.median_error.value >= 0
    assert r.series[-1].actual == load(customer).account("spend").balance  # rebuilt series ends at today's balance
    assert all(p.p10 <= p.p25 <= p.p50 <= p.p75 <= p.p90 for p in r.series)
    assert "made-up history" in r.caveat
    for m in (r.coverage_80, r.coverage_50, r.median_error, r.low_actual, r.low_predicted):
        assert m.math.formula and any("made-up history" in a for a in m.math.assumptions)


def test_rebuilt_balance_matches_transactions():
    data = load("maya")
    d = DEMO_TODAY - timedelta(days=10)
    later = sum(t.amount for t in data.transactions if t.account_id == "spend" and d < t.date)
    assert balance_on(data, "spend", d) == pytest.approx(data.account("spend").balance - later)


@pytest.mark.parametrize("customer", ["maya", "household"])
def test_hidden_days_are_never_used_for_fitting(customer):
    """Change what happened after the cutoff (keeping everything up to it the same): the forecast must not move,
    while the real balances it is scored against do."""
    data = load(customer)
    base = run_backtest(data, DEMO_TODAY)
    cutoff = base.cutoff

    hidden = [t for t in data.transactions if t.date > cutoff and t.amount < 0]
    spend = next(t for t in hidden if t.account_id == "spend")
    card = [t for t in hidden if t.account_id == "card"][-1]
    changed = {spend.id: -1500.0, card.id: -999.0}  # one checking and one card charge, made much bigger
    txns, delta = [], {"spend": 0.0, "card": 0.0}
    for t in data.transactions:
        if t.id in changed:
            delta[t.account_id] += changed[t.id] - t.amount
            t = t.model_copy(update={"amount": changed[t.id]})
        txns.append(t)
    # Today's balances follow from the changed future, so the past (and the balance on the cutoff day) is unchanged.
    accounts = [a.model_copy(update={"balance": a.balance + delta["spend"]}) if a.id == "spend" else
                a.model_copy(update={"balance": a.balance - delta["card"]}) if a.id == "card" else a
                for a in data.accounts]
    future = data.model_copy(update={"transactions": txns, "accounts": accounts})
    assert balance_on(future, "spend", cutoff) == pytest.approx(balance_on(data, "spend", cutoff))

    after = run_backtest(future, DEMO_TODAY)
    assert forecast_part(after) == forecast_part(base)
    assert [p.actual for p in after.series] != [p.actual for p in base.series]


@pytest.mark.parametrize("customer", ["maya", "household"])
def test_route(customer):
    res = client.get("/api/backtest", params={"customer": customer})
    assert res.status_code == 200
    body = res.json()
    assert body["customer"] == customer
    assert body["verdict"].startswith("Over the last 91 days")
    assert len(body["series"]) == 92


def test_route_unknown_customer_is_404():
    assert client.get("/api/backtest", params={"customer": "nobody"}).status_code == 404
