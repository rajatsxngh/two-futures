"""Repeating charges found in the transactions, and the customer's "still using?" answers."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.engine.data import load
from app.engine.subscriptions import detect, normalize_merchant
from app.main import app
from app.models import Transaction

client = TestClient(app)
TODAY = date(2026, 11, 8)


@pytest.fixture(autouse=True)
def fresh_state():
    client.post("/api/reset")
    yield
    client.post("/api/reset")


def txns(merchant, amounts, start=None, every=30, category="subscription", account="spend"):
    """Charges every `every` days; by default the last one is on November 1."""
    start = start or date(2026, 11, 1) - timedelta(days=every * (len(amounts) - 1))
    return [Transaction(id=f"{merchant}{i}", date=start + timedelta(days=every * i), amount=-a, merchant=merchant,
                        category=category, account_id=account, recurring=True) for i, a in enumerate(amounts)]


# --- detection ------------------------------------------------------------------

def test_finds_maya_gym_and_streaming():
    found = {s.id: s for s in detect(load("maya").transactions, TODAY)}
    assert set(found) == {"iron_gym", "streamly", "tunewave"}
    gym = found["iron_gym"]
    assert (gym.merchant, gym.cadence, gym.count, gym.monthly_amount) == ("Iron Gym", "monthly", 12, 40.0)
    assert gym.last_charge == date(2026, 11, 3)
    assert found["streamly"].monthly_amount == 15.99
    assert found["tunewave"].monthly_amount == 11.99
    assert not any(s.price_change for s in found.values())


def test_no_false_positives_on_pay_transfers_loans_rent_or_utilities():
    found = {s.id for s in detect(load("maya").transactions, TODAY)}
    found |= {s.id for s in detect(load("household").transactions, TODAY)}
    for skipped in ("payroll", "transfer", "auto", "mortgage", "loan", "interest", "visa", "apartments",
                    "mobile", "insurance", "utilities", "power"):
        assert not any(skipped in s for s in found), skipped
    assert found == {"iron_gym", "streamly", "tunewave"}  # the household has no subscriptions


def test_rules_amount_cadence_count_and_recency():
    assert detect(txns("Gymbox", [40, 40]), TODAY) == []  # only 2 charges
    assert detect(txns("Gymbox", [40, 40, 40, 40], every=14), TODAY) == []  # every 2 weeks: not monthly
    assert detect(txns("Gymbox", [40, 52, 31, 40]), TODAY) == []  # amounts all over the place
    assert detect(txns("Gymbox", [40, 40, 40], start=date(2026, 1, 3)), TODAY) == []  # stopped in March
    weekly = detect(txns("Daily Paper", [5, 5, 5, 5], every=7), TODAY)
    assert weekly[0].cadence == "weekly" and weekly[0].monthly_amount == pytest.approx(5 * 52 / 12, abs=0.01)


def test_price_change_flag():
    up = detect(txns("Streamly", [15.99] * 7 + [17.99]), TODAY)[0]
    assert up.price_change and up.typical_amount == 15.99 and up.latest_amount == 17.99
    small = detect(txns("Streamly", [15.99] * 7 + [16.49]), TODAY)[0]  # +3%: not flagged
    assert not small.price_change


def test_merchant_names_are_normalized():
    assert normalize_merchant("SQ *IRON GYM #0042") == normalize_merchant("Iron Gym") == "iron gym"
    assert normalize_merchant("Streamly.com 8841 Inc.") == "streamly"
    mixed = txns("IRON GYM #12", [40, 40], start=date(2026, 9, 2)) + txns("Iron Gym", [40])
    assert detect(mixed, TODAY)[0].count == 3


# --- API: profile, setup answers, plan, futures --------------------------------------

def test_profile_lists_subscriptions_with_math_and_answers():
    subs = client.get("/api/profile").json()["subscriptions"]
    assert [(s["merchant"], s["monthly_amount"], s["still_using"]) for s in subs] == [
        ("Iron Gym", 40.0, False), ("Streamly", 15.99, True), ("Tunewave", 11.99, True)]
    gym = subs[0]
    assert gym["bill_id"] == "gym"
    assert gym["metric"]["id"] == "subscription.iron_gym.monthly"
    assert gym["metric"]["math"]["formula"] and gym["metric"]["math"]["inputs"]


def _set_gym(still_using: bool):
    setup = client.get("/api/profile").json()["customer"]["setup"]
    setup["subscriptions"]["iron_gym"] = still_using
    assert client.post("/api/setup", json={"setup": setup}).status_code == 200


def test_still_using_yes_removes_cancel_step_and_changes_futures_no_brings_it_back():
    before = client.get("/api/futures").json()
    gym = next(a for a in before["plan"]["actions"] if a["id"] == "cancel_gym")
    assert gym["description"].startswith("You said you don't use it.")
    assert gym["amount"] == 40

    _set_gym(True)
    using = client.get("/api/futures").json()
    assert "cancel_gym" not in {a["id"] for a in using["plan"]["actions"]}
    assert client.get("/api/profile").json()["subscriptions"][0]["still_using"] is True
    plan_before, plan_using = before["paths"]["plan"]["snapshots"][-1], using["paths"]["plan"]["snapshots"][-1]
    assert plan_using["net_worth"] < plan_before["net_worth"]
    # the same path doesn't depend on the plan's choices
    assert using["paths"]["same_path"]["snapshots"] == before["paths"]["same_path"]["snapshots"]

    _set_gym(False)
    back = client.get("/api/futures").json()
    assert "cancel_gym" in {a["id"] for a in back["plan"]["actions"]}
    assert back["paths"]["plan"]["snapshots"] == before["paths"]["plan"]["snapshots"]
    assert back["next_step"] == before["next_step"]


def test_setup_without_subscription_answers_keeps_them():
    setup = client.get("/api/profile").json()["customer"]["setup"]
    del setup["subscriptions"]
    setup["planning_ahead"] = "yes"
    client.post("/api/setup", json={"setup": setup})
    assert client.get("/api/profile").json()["customer"]["setup"]["subscriptions"]["iron_gym"] is False
    assert "cancel_gym" in {a["id"] for a in client.get("/api/futures").json()["plan"]["actions"]}


def test_fact_sheet_lists_the_charges_and_answers():
    text = client.get("/api/futures").json()["fact_sheets"]["plan"]["text"]
    assert "Iron Gym $40 a month (you said you don't use it)" in text
    assert "Streamly $15.99 a month" in text
