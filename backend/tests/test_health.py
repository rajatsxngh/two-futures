"""M2-M3: the generated data and the health engine reproduce the PRD's numbers from first principles."""

import pytest
from fastapi.testclient import TestClient

from app.config import DEMO_TODAY
from app.engine.data import load
from app.engine.fmt import round_half_up
from app.engine.health import health_for, linear_score, state_from_data
from app.main import app
from app.models import AccountType

client = TestClient(app)

MAYA_INDICATORS = {
    "spending_vs_income": 47,
    "bills_on_time": 100,
    "savings_cushion": 20,
    "long_term_saving": 24,
    "debt_load": 90,
    "credit_health": 20,
    "insurance": 75,
    "planning_ahead": 60,
}


@pytest.fixture(scope="module")
def maya_health():
    return health_for(load("maya"), DEMO_TODAY)


# --- the scoring rules -------------------------------------------------------

def test_round_half_up():
    assert round_half_up(73.5) == 74
    assert round_half_up(67.5) == 68
    assert round_half_up(54.75) == 55
    assert round_half_up(2.5) == 3  # Python's round() would give 2


@pytest.mark.parametrize("value,best,worst,expected", [
    (85, 85, 100, 100), (100, 85, 100, 0), (93, 85, 100, 47), (80, 85, 100, 100), (110, 85, 100, 0),
    (3, 3, 0.5, 100), (0.5, 3, 0.5, 0), (1.0, 3, 0.5, 20), (5, 3, 0.5, 100),
    (78, 30, 90, 20), (12, 10, 30, 90), (2.381, 10, 0, 24),
])
def test_linear_score(value, best, worst, expected):
    assert linear_score(value, best, worst) == expected


# --- the generated data -----------------------------------------------------

def test_maya_data_is_calibrated():
    s = state_from_data(load("maya"), DEMO_TODAY)
    assert round(s.take_home_monthly, 2) == 4200.00
    assert round(100 * s.spending_monthly / s.take_home_monthly, 3) == 93.0
    assert round((s.checking + s.savings) / s.spending_monthly, 3) == 1.0
    assert round(s.retirement_contrib_monthly, 2) == 100.00
    assert sum(p for _, p in s.debt_payments) == 504
    assert s.card_balance / s.card_limit == 0.78
    assert s.late_payments_12m == 0


def test_household_has_all_8_account_types():
    assert {a.type for a in load("household").accounts} == set(AccountType)


def test_maya_has_6_accounts():
    assert len(load("maya").accounts) == 6


# --- the health score -------------------------------------------------------

def test_maya_indicators(maya_health):
    assert {i.id: i.score for i in maya_health.indicators} == MAYA_INDICATORS


def test_maya_pillars_and_score(maya_health):
    assert [p.score.value for p in maya_health.pillars] == [74, 22, 55, 68]
    assert maya_health.score.value == 55
    assert maya_health.band == "coping"


def test_status_colors(maya_health):
    status = {i.id: i.status for i in maya_health.indicators}
    assert status["credit_health"] == "red"
    assert status["bills_on_time"] == "green"
    assert status["insurance"] == "amber"


def test_every_indicator_shows_its_math(maya_health):
    for i in maya_health.indicators:
        assert i.value.math.formula
        assert i.value.math.inputs
        assert i.value.math.thresholds is not None
        assert i.reason.endswith(".")


# --- the endpoints ----------------------------------------------------------

def test_health_endpoint_uses_engine():
    body = client.get("/api/health").json()
    assert body["score"]["value"] == 55
    assert body["indicators"][2]["value"]["math"]["inputs"][0]["value"] == 1556.0


def test_profile_summary_and_groups():
    body = client.get("/api/profile").json()
    assert body["summary"] == [
        "You're steady month to month, but you have about one month of backup.",
        "Your credit card is at 78% of its limit, and that's the biggest drag on your score.",
    ]
    assert [g["group"] for g in body["groups"]] == ["cash", "savings_cds", "retirement", "debt"]
    assert body["groups"][3]["total"]["value"] == 17900.0


def test_profile_bills_next_90():
    bills = client.get("/api/profile").json()["bills_next_90"]
    names = {b["name"] for b in bills}
    assert {"Rent", "Car payment", "Credit card payment", "Car insurance", "Paycheck"} <= names
    assert bills[0]["date"] >= DEMO_TODAY.isoformat()
    assert bills == sorted(bills, key=lambda b: b["date"])
    # paydays every 14 days from Nov 13
    paydays = [b["date"] for b in bills if b["kind"] == "income"]
    assert paydays[:3] == ["2026-11-13", "2026-11-27", "2026-12-11"]


def test_household_profile_from_engine():
    body = client.get("/api/profile", params={"customer": "household"}).json()
    assert len(body["accounts"]) == 9
    assert body["summary"][1].startswith("Debt payments take 28%")
