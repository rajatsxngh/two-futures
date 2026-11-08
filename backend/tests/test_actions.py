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
    "buy_car": {"description": "Buy a $30,000 car with $5,000 down", "preset": "buy_car",
                "car": {"price": 30000, "down": 5000, "apr": 8, "term_months": 60}},
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
    on_screen = body["result"]["key_numbers"][0]["display"]  # e.g. "3.6 months", same rounding as the sentence
    assert on_screen in body["sentence"]


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
    bad_home = {"description": "buy a home", "preset": "buy_home",
                "home": {"price": 300000, "down_payment": 400000, "rate": 6.5}}
    assert client.post("/api/update_plan", json=bad_home).status_code == 422


def test_500_percent_mortgage_rate_is_422():
    r = client.post("/api/update_plan", json={**HOME_REQ, "home": {**HOME_REQ["home"], "rate": 500}})
    assert r.status_code == 422
    assert r.json()["detail"] == "home.rate: must be 35 or less"


def test_nan_and_infinity_are_422_not_500():
    for bad in ("NaN", "Infinity", "-Infinity"):
        raw = '{"description": "raise", "preset": "new_job", "income_change_yearly": %s}' % bad
        r = client.post("/api/update_plan", content=raw, headers={"Content-Type": "application/json"})
        assert r.status_code == 422, bad
        assert "NaN" in r.json()["detail"]
    raw = '{"description": "home", "home": {"price": 250000, "down_payment": 12500, "rate": NaN}}'
    assert client.post("/api/update_plan", content=raw, headers={"Content-Type": "application/json"}).status_code == 422
    raw = '{"amount": NaN, "from_account_id": "spend", "to_account_id": "reserve", "frequency": "payday", "confirmed": true}'
    assert client.post("/api/start_transfer", content=raw, headers={"Content-Type": "application/json"}).status_code == 422


def test_what_if_ranges_are_enforced():
    for field, value in (("income_change_yearly", 10_000_000), ("spending_change_monthly", -50_000),
                         ("job_loss_months", 100)):
        assert client.post("/api/update_plan", json={**AUSTIN, field: value}).status_code == 422, field


def test_what_if_is_fast():
    client.get("/api/futures")  # warm
    t = time.perf_counter()
    client.post("/api/update_plan", json=AUSTIN)
    assert time.perf_counter() - t < 1.0


HOME_REQ = {"description": "Buy a $250,000 home", "preset": "buy_home", "start_month": "2029-06",
            "home": {"price": 250000, "down_payment": 12500, "rate": 6.5}}


# --- transfers ---------------------------------------------------------------

def test_transfer_needs_a_clear_yes():
    r = client.post("/api/start_transfer", json={**TRANSFER, "confirmed": False})
    assert r.status_code == 400 and "Nothing moved" in r.json()["detail"]


def test_transfer_schedules_on_next_payday():
    body = client.post("/api/start_transfer", json=TRANSFER).json()
    assert body["status"] == "scheduled" and body["simulated"] is True
    assert body["first_date"] == "2026-11-13"
    assert body["sentence"] == ("Done. $150 moves from Spend to Reserve every payday, starting Friday, November 13. "
                                "This is a simulation: no real money moves.")


def test_retried_yes_does_not_double_schedule():
    a = client.post("/api/start_transfer", json=TRANSFER).json()
    b = client.post("/api/start_transfer", json=TRANSFER).json()
    assert a["id"] == b["id"]


def test_transfer_validates_accounts():
    assert client.post("/api/start_transfer", json={**TRANSFER, "to_account_id": "nope"}).status_code == 400
    assert client.post("/api/start_transfer", json={**TRANSFER, "to_account_id": "spend"}).status_code == 400


def test_transfer_confirmed_must_be_strictly_true():
    for fake_yes in ("yes", "true", 1, "1"):
        r = client.post("/api/start_transfer", json={**TRANSFER, "confirmed": fake_yes})
        assert r.status_code == 422, fake_yes
        assert "confirmed" in r.json()["detail"]


def test_transfer_amount_over_the_max_is_refused():
    r = client.post("/api/start_transfer", json={**TRANSFER, "amount": 1025})
    assert 400 <= r.status_code < 500
    assert "amount" in r.json()["detail"] and "1,000" in r.json()["detail"]


def test_transfer_amount_must_be_a_step():
    r = client.post("/api/start_transfer", json={**TRANSFER, "amount": 160})
    assert 400 <= r.status_code < 500
    assert "multiple of 25" in r.json()["detail"]
    assert 400 <= client.post("/api/start_transfer", json={**TRANSFER, "amount": 0}).status_code < 500


def test_transfer_only_goes_from_checking_to_savings():
    for frm, to in (("card", "reserve"), ("reserve", "spend"), ("spend", "ira"), ("cd", "reserve")):
        r = client.post("/api/start_transfer", json={**TRANSFER, "from_account_id": frm, "to_account_id": to})
        assert 400 <= r.status_code < 500, (frm, to)
        assert "Nothing moved" in r.json()["detail"]


def test_stopping_a_transfer_works():
    a = client.post("/api/start_transfer", json=TRANSFER).json()
    r = client.post("/api/stop_transfer", json={"transfer_id": a["id"]})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "stopped" and body["id"] == a["id"] and body["simulated"] is True
    assert body["sentence"].startswith("Stopped.") and "no real money moves" in body["sentence"]
    # stopping twice is fine; a yes after stopping schedules a new one
    assert client.post("/api/stop_transfer", json={"transfer_id": a["id"]}).json()["status"] == "stopped"
    b = client.post("/api/start_transfer", json=TRANSFER).json()
    assert b["status"] == "scheduled" and b["id"] != a["id"]
    assert client.post("/api/stop_transfer", json={"transfer_id": "nope"}).status_code == 404


def test_reset_clears_transfers():
    a = client.post("/api/start_transfer", json=TRANSFER).json()
    client.post("/api/reset")
    b = client.post("/api/start_transfer", json=TRANSFER).json()
    assert re.fullmatch(r"tr_maya_1", a["id"]) and b["id"] == "tr_maya_1"


# --- M11: buy a home, job-loss check, setup questions ---------------------------

HOME = {"description": "Buy a $250,000 home", "preset": "buy_home", "start_month": "2029-06",
        "home": {"price": 250000, "down_payment": 12500, "rate": 6.5}}


def test_buy_a_home_replaces_rent_with_a_mortgage():
    body = client.post("/api/update_plan", json=HOME).json()
    # 237,500 at 6.5% over 30 years = $1,501; tax 1.8% and insurance 1% of the price a year; PMI 0.5% of the loan (5% down)
    assert ("$2,183 a month: $1,501 loan + $375 tax + $208 insurance + $99 PMI instead of $1,450 rent"
            in body["sentence"])
    assert body["sentence"].endswith("Upkeep isn't included.")
    snap = body["result"]["snapshots"][-1]
    assert 0 < snap["balances"]["home_mortgage"] < 237500
    assert snap["balances"]["home_value"] == 250000
    assert any(e["title"] == "Bought a home" for e in body["result"]["events"])
    assert "Bought a home" in body["fact_sheet"]["text"]


def test_home_too_soon_warns_about_the_down_payment():
    early = {**HOME, "start_month": "2027-03", "home": {**HOME["home"], "down_payment": 25000}}
    assert "short for the down payment" in client.post("/api/update_plan", json=early).json()["sentence"]


def test_job_loss_shock_compares_both_futures_and_changes_nothing():
    before = client.get("/api/futures").json()
    body = client.post("/api/shock", json={"job_loss_months": 3, "start_month": "2029-01"}).json()
    same, plan = body["paths"]["same_path"], body["paths"]["plan"]
    assert plan["runway"]["value"] > same["runway"]["value"]
    # same path: card already near its limit, so bills go unpaid; plan: the paid-off card has room
    assert same["unpaid"]["value"] > 0 and plan["unpaid"] is None
    assert same["card"]["value"] <= 5000 - 3900 + 1
    assert same["runway"]["math"]["formula"]
    assert same["sentence"].startswith("Losing your income for 3 months in January 2029")
    assert [y["year"] for y in body["by_year"]] == [2027, 2028, 2029, 2030, 2031]
    assert client.get("/api/futures").json() == before


def test_setup_answers_rescore_and_reset_restores():
    setup = {"insurance": {"health": True, "auto": True, "renters_or_home": True, "disability": True},
             "planning_ahead": "yes"}
    h = client.post("/api/setup", json={"setup": setup}).json()
    scores = {i["id"]: i["score"] for i in h["indicators"]}
    assert scores["insurance"] == 100 and scores["planning_ahead"] == 100
    assert h["score"]["value"] > 55
    assert client.get("/api/profile").json()["customer"]["setup"]["planning_ahead"] == "yes"
    client.post("/api/reset")
    assert client.get("/api/health").json()["score"]["value"] == 55



# --- card limit and unpaid bills ------------------------------------------------

def test_long_job_loss_stays_within_the_card_limit():
    body = client.post("/api/update_plan", json={"description": "Lose my job for a year", "preset": "job_loss",
                                                 "job_loss_months": 12}).json()
    snap = body["result"]["snapshots"][-1]
    assert snap["card_debt"] <= 5000  # the card can't go past its limit any more
    assert snap["balances"]["unpaid_bills"] > 0
    assert "limit" in body["sentence"] and "unpaid" in body["sentence"]
    assert "0.0 months" not in body["sentence"]
    assert any(e["title"] == "Fell behind on bills" for e in body["result"]["events"])
    assert snap["indicator_scores"]["bills_on_time"] < 100  # unpaid months count as late payments


# --- buy a car, full home cost ---------------------------------------------------

from app.engine import assumptions as A  # noqa: E402
from app.engine.sim import HomePlan  # noqa: E402
from app.engine.whatif import home_breakdown, home_costs, loan_payment  # noqa: E402
from app.models import HomePurchase  # noqa: E402

CAR = PRESETS["buy_car"]


def car_req(**car):
    return {**CAR, "car": {**CAR["car"], **car}}


def test_loan_payment_math():
    assert loan_payment(12_000, 0, 12) == pytest.approx(1000.00, abs=0.005)
    assert round(loan_payment(25_000, 8, 60), 2) == 506.91
    assert loan_payment(0, 8, 60) == 0.0
    assert round(loan_payment(237_500, 6.5, 360), 2) == 1501.16


def test_buy_a_car_end_to_end():
    body = client.post("/api/update_plan", json=CAR).json()
    s = body["sentence"]
    assert s.startswith("Buying a $30,000 car in December 2026 with $5,000 down means a $507 payment every month for 60 months.")
    assert "your cushion would be" in s and "each month instead of" in s
    assert s.endswith("Insurance, gas and repairs aren't included.")
    titles = [e["title"] for e in body["result"]["events"]]
    assert "Bought a car" in titles and "Car loan paid off" in titles
    assert "Bought a car" in body["fact_sheet"]["text"]
    snap = body["result"]["snapshots"][1]  # end of 2027
    assert 0 < snap["balances"]["car_loan"] < 25_000
    assert snap["balances"]["car_value"] == pytest.approx(30_000 * 0.85 ** (13 / 12), abs=1)
    pay = next(d for d in body["deltas"] if d["id"] == "whatif.car_payment")
    assert pay["value"] == 506.91 and pay["math"]["inputs"]
    # the car's assumptions show in "show the math"
    assert any("15%" in a for a in body["result"]["key_numbers"][0]["math"]["assumptions"])


def test_car_loan_options():
    opts = client.post("/api/update_plan", json=CAR).json()["car_options"]
    assert [(o["term_months"], o["apr"]) for o in opts] == [(36, 8), (48, 8), (60, 8), (72, 8), (60, 6), (60, 10)]
    chosen = [o for o in opts if o["chosen"]]
    assert len(chosen) == 1 and chosen[0]["payment"] == 506.91
    assert chosen[0]["total_interest"] == pytest.approx(506.91 * 60 - 25_000, abs=1)
    client.post("/api/reset")
    low = client.post("/api/update_plan", json=car_req(apr=1)).json()["car_options"]
    assert [o["apr"] for o in low[4:]] == [0, 3]  # 1 - 2 clamps to 0
    assert low[4]["total_interest"] == 0
    client.post("/api/reset")
    high = client.post("/api/update_plan", json=car_req(apr=34)).json()["car_options"]
    assert [o["apr"] for o in high[4:]] == [32, 35]  # 34 + 2 clamps to 35


def test_car_down_payment_over_the_price_is_422():
    r = client.post("/api/update_plan", json=car_req(down=31_000))
    assert r.status_code == 422
    assert r.json()["detail"] == "car: the down payment can't be more than the price"


def test_car_bounds_are_enforced():
    for field, value in (("price", 999), ("price", 150_001), ("down", -1), ("apr", -0.5), ("apr", 35.5),
                         ("term_months", 11), ("term_months", 85)):
        assert client.post("/api/update_plan", json=car_req(**{field: value})).status_code == 422, (field, value)
    raw = '{"description": "car", "car": {"price": 30000, "down": 5000, "apr": NaN, "term_months": 60}}'
    assert client.post("/api/update_plan", content=raw, headers={"Content-Type": "application/json"}).status_code == 422
    assert client.post("/api/update_plan", json=car_req(price=150_000, down=150_000, apr=0, term_months=84)).status_code == 200


def test_car_down_payment_more_than_cash_says_short():
    s = client.post("/api/update_plan", json=car_req(down=25_000)).json()["sentence"]
    assert "short for the down payment" in s


def test_car_loan_raises_debt_load_and_lowers_the_score():
    before = client.get("/api/futures").json()["paths"]["plan"]["snapshots"][1]
    after = client.post("/api/update_plan", json=car_req(start_month="2027-01")).json()["result"]["snapshots"][1]
    assert after["indicator_scores"]["debt_load"] < before["indicator_scores"]["debt_load"]
    assert after["score"] < before["score"]
    assert after["net_worth"] < before["net_worth"]


def test_home_breakdown_adds_up():
    body = client.post("/api/update_plan", json=HOME).json()
    m = re.search(r"means \$([\d,]+) a month: \$([\d,]+) loan \+ \$([\d,]+) tax \+ \$([\d,]+) insurance"
                  r"(?: \+ \$([\d,]+) PMI)?", body["sentence"])
    total, *parts = (int(x.replace(",", "")) for x in m.groups() if x)
    assert total == sum(parts)
    cost = next(d for d in body["deltas"] if d["id"] == "whatif.home_cost")
    assert cost["value"] == total == sum(i["value"] for i in cost["math"]["inputs"])


def test_pmi_only_under_20_percent_down():
    under = HomePurchase(price=250_000, down_payment=49_999, rate=6.5)
    at = HomePurchase(price=250_000, down_payment=50_000, rate=6.5)
    assert home_costs(under)["pmi"] == pytest.approx(200_001 * A.HOME_PMI / 12)
    assert home_costs(at)["pmi"] == 0
    assert home_breakdown(at)[1]["pmi"] == 0
    # PMI stops once the loan falls to 80% of the price
    plan = HomePlan(start=0, price=250_000, down=12_500, rate=6.5, term_years=30, payment=1501.17, rent=1450, pmi=99)
    assert plan.pmi_now(200_001) == 99 and plan.pmi_now(200_000) == 0
    s = client.post("/api/update_plan", json={**HOME, "home": {**HOME["home"], "down_payment": 50_000}}).json()["sentence"]
    assert "PMI" not in s and "$1,264 loan + $375 tax + $208 insurance instead of $1,450 rent" in s
