"""M5: what-ifs, simulated transfers and reset."""

import re
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

AUSTIN = {"description": "What if I take the Austin job? $8,000 more a year, but rent is $300 higher.",
          "preset": "new_job", "income_change_yearly": 8000, "spending_change_monthly": 300,
          "start_month": "2027-01"}
PRESETS = {
    "new_job": AUSTIN,
    "move": {"description": "Move somewhere $200 cheaper", "preset": "move", "spending_change_monthly": -200},
    "big_purchase": {"description": "Buy a $1,800 laptop", "preset": "big_purchase", "one_time_cost": 1800},
    "save_more": {"description": "Save $100 more a month", "preset": "save_more", "savings_change_monthly": 100},
    "job_loss": {"description": "Lose my job for 3 months", "preset": "job_loss", "job_loss_months": 3},
}
TRANSFER = {"amount": 150, "from_account_id": "spend", "to_account_id": "reserve", "frequency": "payday",
            "confirmed": True}


@pytest.fixture(autouse=True)
def fresh_state():
    client.post("/api/reset")
    yield
    client.post("/api/reset")


def plan_2031(body):
    return body["paths"]["plan"]["snapshots"][-1]


# --- what-ifs ----------------------------------------------------------------

def test_austin_job_is_about_170_a_month():
    r = client.post("/api/update_plan", json=AUSTIN)
    assert r.status_code == 200
    body = r.json()
    assert body["sentence"].startswith("Taking the new job leaves about $170 more a month after taxes and the higher rent.")
    monthly = next(d for d in body["deltas"] if d["id"] == "whatif.monthly_change")
    assert monthly["value"] == pytest.approx(8000 * (1 - 0.22 - 0.0765) / 12 - 300, abs=0.01)  # 169.00
    assert body["path"] == "plan"


@pytest.mark.parametrize("preset", PRESETS)
def test_every_preset_works(preset):
    body = client.post("/api/update_plan", json=PRESETS[preset]).json()
    assert body["sentence"].endswith(".")
    assert {d["id"] for d in body["deltas"]} >= {"whatif.cushion_2031", "whatif.net_worth_2031", "whatif.score_2031"}
    assert all(d["math"]["formula"] for d in body["deltas"])
    assert body["applied"][-1]["preset"] == preset
    assert "WHAT-IFS APPLIED" in body["fact_sheet"]["text"]


def test_directions_make_sense():
    def nw_delta(p):
        client.post("/api/reset")
        body = client.post("/api/update_plan", json=PRESETS[p]).json()
        return next(d["value"] for d in body["deltas"] if d["id"] == "whatif.net_worth_2031")
    assert nw_delta("new_job") > 0
    assert nw_delta("move") > 0
    assert nw_delta("save_more") > 0
    assert nw_delta("big_purchase") < 0
    assert nw_delta("job_loss") < 0


def test_sentence_numbers_come_from_the_engine():
    body = client.post("/api/update_plan", json=PRESETS["job_loss"]).json()
    snap = body["result"]["snapshots"][-1]
    assert f"{snap['cushion_months']:.1f} months" in body["sentence"]


def test_what_ifs_only_touch_the_plan_path():
    before = client.get("/api/futures").json()
    client.post("/api/update_plan", json=AUSTIN)
    after = client.get("/api/futures").json()
    assert after["paths"]["same_path"] == before["paths"]["same_path"]
    assert plan_2031(after)["net_worth"] > plan_2031(before)["net_worth"]


def test_what_ifs_stack_and_reset_clears_them():
    base = client.get("/api/futures").json()
    client.post("/api/update_plan", json=AUSTIN)
    body = client.post("/api/update_plan", json=PRESETS["save_more"]).json()
    assert [a["preset"] for a in body["applied"]] == ["new_job", "save_more"]
    assert client.post("/api/reset").json() == {"ok": True, "customer": "maya"}
    assert client.get("/api/futures").json() == base
    assert client.get("/api/health").json()["score"]["value"] == 55


def test_bad_what_ifs_are_422():
    assert client.post("/api/update_plan", json={"description": "nothing"}).status_code == 422
    assert client.post("/api/update_plan", json={**AUSTIN, "start_month": "soon"}).status_code == 422
    home = {"description": "buy a home", "preset": "buy_home",
            "home": {"price": 300000, "down_payment": 30000, "rate": 6.5}}
    assert client.post("/api/update_plan", json=home).status_code == 422  # M11


def test_what_if_is_fast():
    client.get("/api/futures")  # warm
    t = time.perf_counter()
    client.post("/api/update_plan", json=AUSTIN)
    assert time.perf_counter() - t < 1.0


# --- transfers ---------------------------------------------------------------

def test_transfer_needs_a_clear_yes():
    r = client.post("/api/start_transfer", json={**TRANSFER, "confirmed": False})
    assert r.status_code == 400 and "Nothing moved" in r.json()["detail"]


def test_transfer_schedules_on_next_payday():
    body = client.post("/api/start_transfer", json=TRANSFER).json()
    assert body["status"] == "scheduled" and body["simulated"] is True
    assert body["first_date"] == "2026-11-13"
    assert body["sentence"] == "Done. $150 moves from Spend to Reserve every payday, starting Friday, November 13."


def test_retried_yes_does_not_double_schedule():
    a = client.post("/api/start_transfer", json=TRANSFER).json()
    b = client.post("/api/start_transfer", json=TRANSFER).json()
    assert a["id"] == b["id"]


def test_transfer_validates_accounts():
    assert client.post("/api/start_transfer", json={**TRANSFER, "to_account_id": "nope"}).status_code == 400
    assert client.post("/api/start_transfer", json={**TRANSFER, "to_account_id": "spend"}).status_code == 400


def test_reset_clears_transfers():
    a = client.post("/api/start_transfer", json=TRANSFER).json()
    client.post("/api/reset")
    b = client.post("/api/start_transfer", json=TRANSFER).json()
    assert re.fullmatch(r"tr_maya_1", a["id"]) and b["id"] == "tr_maya_1"
