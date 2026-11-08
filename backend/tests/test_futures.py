"""M4: forecast, plan rules and the two 5-year paths."""

import time

import pytest
from fastapi.testclient import TestClient

from app.config import DEMO_TODAY
from app.engine.data import load
from app.engine.forecast import forecast_for, rule1_transfer
from app.engine.futures import build_futures, futures_for
from app.engine.params import build_params
from app.main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def maya():
    return futures_for("maya", DEMO_TODAY).response


@pytest.fixture(scope="module")
def forecast():
    return forecast_for("maya", DEMO_TODAY)


# --- params learned from history ---------------------------------------------

def test_params_reconcile_with_health_spending():
    p = build_params(load("maya"), DEMO_TODAY)
    monthly = (p.variable_mean(False, 0) + 1724.98 + 168 / 12  # fixed bills incl. yearly renters
               + 387 + 3900 * 0.2499 / 12)  # car payment + card interest
    assert monthly == pytest.approx(3906, abs=1.0)


# --- 12-month forecast -------------------------------------------------------

def test_forecast_shape(forecast):
    assert forecast.runs == 1000
    assert len(forecast.cash_series) == 366
    assert forecast.cash_series[0].date == DEMO_TODAY
    assert all(pt.p10 <= pt.p50 <= pt.p90 for pt in forecast.cash_series)
    assert forecast.cash_series[0].p50 == 1556.0


def test_forecast_markers_and_bills(forecast):
    kinds = {m.kind for m in forecast.markers}
    assert {"rent", "car", "card", "cd", "insurance"} <= kinds
    assert any(m.kind == "cd" and m.date.isoformat() == "2027-04-15" for m in forecast.markers)
    assert forecast.bills_next_90[0].date >= DEMO_TODAY


def test_forecast_risk_and_accounts(forecast):
    assert 0 <= forecast.overdraft_risk_90d.value <= 100
    assert forecast.overdraft_risk_90d.math.inputs
    assert {a.account_id for a in forecast.accounts} == {"spend", "reserve", "cd", "ira", "auto", "card"}
    cd = next(a for a in forecast.accounts if a.account_id == "cd")
    assert cd.points[0].balance == 2000 and cd.points[-1].balance == 0  # matured in April 2027
    assert forecast.label == "Forecast, not a promise"


# --- plan rules --------------------------------------------------------------

def test_rule1_picks_150_for_maya():
    amount, low = rule1_transfer(build_params(load("maya"), DEMO_TODAY))
    assert amount == 150
    assert low >= 200


def test_plan_actions_in_rule_order(maya):
    rules = [a.rule for a in maya.plan.actions]
    assert rules == sorted(rules)
    assert maya.plan.actions[0].id == "auto_transfer"
    assert any(a.id == "cancel_gym" for a in maya.plan.actions)
    assert any(a.id == "windfall_split" for a in maya.plan.actions)


def test_next_step_is_the_150_transfer(maya):
    ns = maya.next_step
    assert (ns.amount, ns.from_account_id, ns.to_account_id, ns.frequency) == (150, "spend", "reserve", "payday")
    assert ns.first_date.isoformat() == "2026-11-13"
    assert ns.effects


# --- two paths ---------------------------------------------------------------

def test_both_paths_share_the_2028_repair(maya):
    for path in maya.paths.values():
        shared = [e for e in path.events if e.shared]
        assert [(e.date.isoformat(), e.amount) for e in shared] == [("2028-03-14", 2000.0)]


def test_snapshots_start_today(maya):
    for path in maya.paths.values():
        years = [s.year for s in path.snapshots]
        assert years == list(range(2026, 2032))
        assert path.snapshots[0].score == 55
        assert path.snapshots[0].cushion_months == pytest.approx(1.0, abs=0.01)


def test_plan_beats_same_path_in_2031(maya):
    same, plan = maya.paths["same_path"].snapshots[-1], maya.paths["plan"].snapshots[-1]
    assert plan.score > same.score
    assert plan.card_debt == 0 and same.card_debt == pytest.approx(3900)
    assert plan.cushion_months > same.cushion_months
    assert plan.ira_balance > same.ira_balance


def test_key_numbers(maya):
    for k, path in maya.paths.items():
        ids = [m.id for m in path.key_numbers]
        assert ids == [f"{k}.2031.cushion_months", f"{k}.2031.card_debt", f"{k}.2031.card_interest", f"{k}.2031.ira"]
        assert all(m.math.formula for m in path.key_numbers)


def test_fact_sheets_hold_the_facts(maya):
    for k, sheet in maya.fact_sheets.items():
        assert sheet.path == k
        assert "$150" in sheet.text and "2031" in sheet.text
        assert "today's dollars" in sheet.text
        assert sheet.opening_line.startswith("Hey... it's me.")
        assert str(maya.paths[k].snapshots[-1].score) in sheet.text


def test_deterministic_and_fast():
    t = time.perf_counter()
    a = build_futures(load("maya"), DEMO_TODAY).response
    assert time.perf_counter() - t < 1.0
    b = build_futures(load("maya"), DEMO_TODAY).response
    assert a.model_dump() == b.model_dump()


def test_household_futures():
    r = futures_for("household", DEMO_TODAY).response
    assert set(r.paths) == {"same_path", "plan"}
    assert r.paths["plan"].snapshots[-1].score >= r.paths["same_path"].snapshots[-1].score


# --- endpoints ---------------------------------------------------------------

def test_endpoints_serve_engine():
    f = client.get("/api/futures").json()
    assert f["next_step"]["amount"] == 150
    fc = client.get("/api/forecast").json()
    assert len(fc["cash_series"]) == 366


# --- M9: every on-screen number has its math --------------------------------

def test_account_balances_are_metrics():
    body = client.get("/api/profile").json()
    ids = {m["id"]: m for m in body["account_metrics"]}
    assert set(ids) == {f"account.{a['id']}.balance" for a in body["accounts"]}
    card = ids["account.card.balance"]
    assert card["display"] == "$3,900"
    assert any(i["label"] == "Credit limit" for i in card["math"]["inputs"])


def test_forecast_headline_and_account_ends(forecast):
    ids = [m.id for m in forecast.headline]
    assert ids == ["forecast.cash.p50_end", "forecast.cash.range"]
    assert forecast.headline[0].value == forecast.cash_series[-1].p50
    assert all(a.end is not None and a.end.id == f"forecast.account.{a.account_id}.end" for a in forecast.accounts)


def test_next_step_amount_explains_itself(maya):
    m = maya.next_step.amount_metric
    assert m.id == "next_step.amount" and m.value == 150
    assert "largest $25 step" in m.math.formula
    low = next(i.value for i in m.math.inputs if i.label.startswith("Bad-case low point"))
    assert low >= 200



def test_plan_pays_the_card_after_a_starter_cushion(maya):
    plan_events = {e.title: e.date.isoformat()[:7] for e in maya.paths["plan"].events}
    assert plan_events["Cushion reaches 2 months"] < plan_events["Card paid off"] < plan_events["Car paid off"]
    same_interest = next(m.value for m in maya.paths["same_path"].key_numbers if m.id.endswith("card_interest"))
    plan_interest = next(m.value for m in maya.paths["plan"].key_numbers if m.id.endswith("card_interest"))
    assert plan_interest < same_interest / 3
