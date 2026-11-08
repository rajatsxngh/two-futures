"""Generate the made-up demo customers in `data/`.

    uv run python scripts/generate_data.py

Writes `data/maya.json` and `data/household.json`: customer, accounts, bills
and 12 months of transactions. A fixed seed makes the output identical on
every run.

Maya's numbers are calibrated to the PRD so the health engine lands on the
same values from first principles:
  - 12-month spending is exactly 93% of 12-month take-home pay
  - checking + savings = exactly one month of spending
  - $100/month to the IRA, $200/month to savings, no late fees
  - car $387 + card $117 minimum = 12% of take-home
  - card $3,900 of a $5,000 limit (78%)
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.engine.data import DATA_DIR, TRANSFER_CATEGORIES, CustomerData  # noqa: E402
from app.models import ACCOUNT_GROUP_OF, AccountType  # noqa: E402

TODAY = date(2026, 11, 8)
WINDOW_START = TODAY - timedelta(days=364)  # 365 days of history, inclusive


def days(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def month_starts(start: date, end: date):
    d = start.replace(day=1)
    while d <= end:
        yield d
        d = (d + timedelta(days=32)).replace(day=1)


def on_day(month: date, day: int) -> date:
    """`day` of `month`, clamped to the month's last day."""
    last_day = ((month.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day
    return month.replace(day=min(day, last_day))


class Builder:
    def __init__(self, seed: int):
        self.rng = np.random.default_rng(seed)
        self.txns: list[dict] = []
        self._n = 0

    def add(self, d: date, amount: float, merchant: str, category: str, account_id: str, recurring: bool):
        if not (WINDOW_START <= d <= TODAY):
            return
        self._n += 1
        self.txns.append({"id": f"t{self._n:05d}", "date": d.isoformat(), "amount": round(amount, 2),
                          "merchant": merchant, "category": category, "account_id": account_id,
                          "recurring": recurring})

    def calibrate(self, target_spending: float, variable_categories: set[str], spend_accounts: set[str]):
        """Scale variable spending so total spending in the window hits `target_spending` to the cent."""
        def is_spending(t):
            return t["amount"] < 0 and t["account_id"] in spend_accounts and t["category"] not in TRANSFER_CATEGORIES

        var = [t for t in self.txns if is_spending(t) and t["category"] in variable_categories]
        fixed = sum(-t["amount"] for t in self.txns if is_spending(t) and t["category"] not in variable_categories)
        var_total = sum(-t["amount"] for t in var)
        scale = (target_spending - fixed) / var_total
        assert scale > 0, "fixed costs already exceed the spending target"
        for t in var:
            t["amount"] = round(t["amount"] * scale, 2)
        residual = round(target_spending - fixed - sum(-t["amount"] for t in var), 2)
        var[-1]["amount"] = round(var[-1]["amount"] - residual, 2)
        total = round(sum(-t["amount"] for t in self.txns if is_spending(t)), 2)
        assert abs(total - target_spending) < 0.005, (total, target_spending)

    def sorted(self) -> list[dict]:
        out = sorted(self.txns, key=lambda t: (t["date"], t["id"]))
        for i, t in enumerate(out, 1):
            t["id"] = f"t{i:05d}"
        return out


def account(**kw) -> dict:
    kw["group"] = ACCOUNT_GROUP_OF[AccountType(kw["type"])].value
    return kw


def bill(id, name, amount, category, account_id, day=None, kind="monthly", on=None) -> dict:
    return {"id": id, "name": name, "amount": amount, "category": category, "account_id": account_id,
            "due_rule": {"kind": kind, "day": day, "date": on.isoformat() if on else None}}


def add_variable(b: Builder, account_id: str, category: str, merchants: list[str], per_week: float,
                 mean: float, sd: float):
    """Random everyday purchases: ~per_week times a week, amounts ~ N(mean, sd)."""
    for d in days(WINDOW_START, TODAY):
        if b.rng.random() < per_week / 7:
            amt = max(3.0, b.rng.normal(mean, sd))
            b.add(d, -amt, str(b.rng.choice(merchants)), category, account_id, False)


# ---------------------------------------------------------------------------
# Maya
# ---------------------------------------------------------------------------

def maya() -> dict:
    b = Builder(seed=27)
    take_home_month = 4200.0
    paycheck = round(take_home_month * 12 / 26, 2)  # 1938.46
    next_payday = date(2026, 11, 13)

    accounts = [
        account(id="spend", type="checking", name="Spend", institution="PNC", balance=1556.0, rate=0.01),
        account(id="reserve", type="savings", name="Reserve", institution="PNC", balance=2350.0, rate=0.03,
                monthly_contribution=200.0),
        account(id="cd", type="cd", name="12-month CD", institution="PNC", balance=2000.0, rate=4.0,
                maturity_date="2027-04-15", term_months=12, original_amount=2000.0),
        account(id="ira", type="ira", name="Roth IRA", institution="Bluebonnet Investments", balance=6800.0,
                monthly_contribution=100.0),
        account(id="auto", type="auto_loan", name="Auto loan", institution="Lone Star Credit Union",
                balance=14000.0, rate=6.9, min_payment=387.0, due_day=5, original_amount=22000.0, term_months=60),
        account(id="card", type="credit_card", name="Cash Rewards Visa", institution="PNC", balance=3900.0,
                rate=24.99, limit=5000.0, min_payment=117.0, due_day=22),
    ]
    bills = [
        bill("rent", "Rent", 1450.0, "housing", "spend", day=1),
        bill("gym", "Gym membership", 40.0, "subscription", "spend", day=3),
        bill("car", "Car payment", 387.0, "auto_loan", "spend", day=5),
        bill("stream1", "Streaming (video)", 15.99, "subscription", "spend", day=9),
        bill("insurance", "Car insurance", 142.0, "insurance", "spend", day=15),
        bill("phone", "Phone", 65.0, "utilities", "spend", day=18),
        bill("card_pay", "Credit card payment", 117.0, "card_payment", "spend", day=22),
        bill("stream2", "Streaming (music)", 11.99, "subscription", "spend", day=27),
        bill("renters", "Renters insurance", 168.0, "insurance", "spend", kind="yearly", on=date(2027, 1, 12)),
        bill("cd_maturity", "CD matures", 2080.0, "cd_maturity", "cd", kind="once", on=date(2027, 4, 15)),
    ]

    # paychecks: every 14 days back from the last one before today
    d = next_payday - timedelta(days=14)
    while d >= WINDOW_START:
        b.add(d, paycheck, "Baylor Scott & White payroll", "paycheck", "spend", True)
        d -= timedelta(days=14)

    for m in month_starts(WINDOW_START, TODAY):
        b.add(m, -1450.0, "Oak Lawn Apartments", "housing", "spend", True)
        b.add(on_day(m, 2), -200.0, "Transfer to Reserve", "savings_transfer", "spend", True)
        b.add(on_day(m, 2), 200.0, "Transfer from Spend", "savings_transfer", "reserve", True)
        b.add(on_day(m, 2), -100.0, "Transfer to Roth IRA", "retirement_contribution", "spend", True)
        b.add(on_day(m, 2), 100.0, "Contribution from PNC", "retirement_contribution", "ira", True)
        b.add(on_day(m, 3), -40.0, "Iron Gym", "subscription", "spend", True)
        b.add(on_day(m, 5), -387.0, "Lone Star CU auto payment", "auto_loan", "spend", True)
        b.add(on_day(m, 9), -15.99, "Streamly", "subscription", "spend", True)
        b.add(on_day(m, 15), -142.0, "Lone Star Auto Insurance", "insurance", "spend", True)
        b.add(on_day(m, 18), -65.0, "Metro Mobile", "utilities", "spend", True)
        b.add(on_day(m, 20), -float(round(b.rng.normal(115, 22), 2)), "Dallas Power & Light", "utilities", "spend", True)
        b.add(on_day(m, 25), -round(3900 * 0.2499 / 12, 2), "Interest charge", "interest", "card", True)
        b.add(on_day(m, 27), -11.99, "Tunewave", "subscription", "spend", True)
    b.add(date(2026, 1, 12), -168.0, "Lone Star Renters Insurance", "insurance", "spend", True)

    # everyday spending (calibrated below)
    add_variable(b, "spend", "groceries", ["Kroger", "Tom Thumb", "H-E-B", "Trader Joe's"], 2.0, 55, 18)
    add_variable(b, "spend", "gas", ["Shell", "QuikTrip", "Exxon"], 1.0, 42, 9)
    add_variable(b, "card", "dining", ["Taco Joint", "Pho Is For Lovers", "Starbucks", "Velvet Taco"], 3.0, 19, 9)
    add_variable(b, "card", "shopping", ["Target", "Amazon", "Old Navy"], 1.0, 48, 25)
    add_variable(b, "spend", "health", ["CVS Pharmacy", "Walgreens"], 0.4, 32, 12)
    add_variable(b, "card", "entertainment", ["AMC", "Topgolf", "Ticketmaster"], 0.5, 38, 15)
    add_variable(b, "spend", "personal_care", ["Great Clips", "Ulta"], 0.3, 40, 15)
    add_variable(b, "spend", "misc", ["Venmo", "Etsy", "USPS", "Petco"], 1.0, 45, 30)

    income = sum(t["amount"] for t in b.txns if t["category"] == "paycheck")
    assert len([t for t in b.txns if t["category"] == "paycheck"]) == 26
    b.calibrate(round(income * 0.93, 2),
                {"groceries", "gas", "dining", "shopping", "health", "entertainment", "personal_care", "misc"},
                {"spend", "card"})

    # card payments: pay each month's card charges so the balance holds near $3,900
    card_by_month: dict[str, float] = {}
    for t in b.txns:
        if t["account_id"] == "card" and t["amount"] < 0:
            card_by_month[t["date"][:7]] = card_by_month.get(t["date"][:7], 0) - t["amount"]
    for m in month_starts(WINDOW_START, TODAY):
        amt = round(max(117.0, card_by_month.get(m.strftime("%Y-%m"), 0)), 2)
        b.add(on_day(m, 22), -amt, "Payment to Cash Rewards Visa", "card_payment", "spend", True)
        b.add(on_day(m, 22), amt, "Payment from Spend", "card_payment", "card", True)

    return {
        "customer": {"id": "maya", "name": "Maya", "age": 27, "city": "Dallas", "state": "TX",
                     "occupation": "Nurse", "pay_schedule": "biweekly", "take_home_per_paycheck": paycheck,
                     "next_payday": next_payday.isoformat(),
                     "setup": {"insurance": {"health": True, "auto": True, "renters_or_home": True,
                                             "disability": False},
                               "planning_ahead": "sometimes",
                               # Her answers to "Still using this?" for the repeating charges the app found
                               # (engine/subscriptions.py). She told the app; the data can't know.
                               "subscriptions": {"iron_gym": False, "streamly": True, "tunewave": True}}},
        "accounts": accounts, "bills": bills, "transactions": b.sorted(),
    }


# ---------------------------------------------------------------------------
# Jordan and Priya: covers all 8 account types (mortgage, personal loan)
# ---------------------------------------------------------------------------

def household() -> dict:
    b = Builder(seed=34)
    paycheck = 5400.0  # semimonthly, combined
    accounts = [
        account(id="spend", type="checking", name="Spend", institution="PNC", balance=5200.0, rate=0.01),
        account(id="reserve", type="savings", name="Reserve", institution="PNC", balance=14800.0, rate=0.03,
                monthly_contribution=400.0),
        account(id="cd", type="cd", name="18-month CD", institution="PNC", balance=10000.0, rate=4.1,
                maturity_date="2027-09-01", term_months=18, original_amount=10000.0),
        account(id="ira", type="ira", name="Traditional IRA", institution="Bluebonnet Investments", balance=48200.0,
                monthly_contribution=500.0),
        account(id="auto1", type="auto_loan", name="Auto loan (SUV)", institution="Lone Star Credit Union",
                balance=21500.0, rate=5.9, min_payment=520.0, due_day=10, original_amount=34000.0, term_months=72),
        account(id="auto2", type="auto_loan", name="Auto loan (sedan)", institution="PNC", balance=6300.0, rate=4.9,
                min_payment=280.0, due_day=20, original_amount=18000.0, term_months=60),
        account(id="personal", type="personal_loan", name="Personal loan", institution="PNC", balance=7800.0,
                rate=11.5, min_payment=260.0, due_day=12, original_amount=12000.0, term_months=48),
        account(id="card", type="credit_card", name="Cash Rewards Visa", institution="PNC", balance=1900.0,
                rate=22.99, limit=12000.0, min_payment=57.0, due_day=25),
        account(id="mortgage", type="mortgage", name="Mortgage", institution="PNC", balance=286000.0, rate=6.25,
                min_payment=1950.0, due_day=1, original_amount=300000.0, term_months=360),
    ]
    bills = [
        bill("mortgage", "Mortgage", 1950.0, "mortgage", "spend", day=1),
        bill("auto1", "SUV payment", 520.0, "auto_loan", "spend", day=10),
        bill("personal", "Personal loan", 260.0, "personal_loan", "spend", day=12),
        bill("insurance", "Car insurance (2 cars)", 238.0, "insurance", "spend", day=14),
        bill("utilities", "Utilities", 260.0, "utilities", "spend", day=18),
        bill("auto2", "Sedan payment", 280.0, "auto_loan", "spend", day=20),
        bill("card_pay", "Credit card payment", 57.0, "card_payment", "spend", day=25),
        bill("daycare_deposit", "Daycare deposit", 600.0, "childcare", "spend", kind="once", on=date(2027, 2, 1)),
        bill("cd_maturity", "CD matures", 10615.0, "cd_maturity", "cd", kind="once", on=date(2027, 9, 1)),
    ]
    for m in month_starts(WINDOW_START, TODAY):
        for day in (1, 15):
            b.add(on_day(m, day), paycheck, "Plano ISD / Ridgeline Labs payroll", "paycheck", "spend", True)
        b.add(m, -1950.0, "PNC Mortgage", "mortgage", "spend", True)
        b.add(on_day(m, 2), -400.0, "Transfer to Reserve", "savings_transfer", "spend", True)
        b.add(on_day(m, 2), 400.0, "Transfer from Spend", "savings_transfer", "reserve", True)
        b.add(on_day(m, 2), -500.0, "Transfer to IRA", "retirement_contribution", "spend", True)
        b.add(on_day(m, 2), 500.0, "Contribution from PNC", "retirement_contribution", "ira", True)
        b.add(on_day(m, 10), -520.0, "Lone Star CU auto payment", "auto_loan", "spend", True)
        b.add(on_day(m, 12), -260.0, "PNC personal loan", "personal_loan", "spend", True)
        b.add(on_day(m, 14), -238.0, "Lone Star Auto Insurance", "insurance", "spend", True)
        b.add(on_day(m, 18), -float(round(b.rng.normal(260, 40), 2)), "Plano Utilities", "utilities", "spend", True)
        b.add(on_day(m, 20), -280.0, "PNC auto payment", "auto_loan", "spend", True)
        b.add(on_day(m, 25), -round(1900 * 0.2299 / 12, 2), "Interest charge", "interest", "card", True)
    add_variable(b, "spend", "groceries", ["Kroger", "Costco", "H-E-B"], 2.5, 95, 30)
    add_variable(b, "spend", "gas", ["Shell", "QuikTrip"], 1.5, 48, 10)
    add_variable(b, "card", "dining", ["Chuy's", "Starbucks", "Torchy's"], 2.5, 34, 14)
    add_variable(b, "card", "shopping", ["Target", "Amazon", "Buy Buy Baby"], 1.5, 70, 35)
    add_variable(b, "spend", "health", ["CVS Pharmacy", "Texas Health OB-GYN"], 0.5, 60, 30)
    add_variable(b, "spend", "misc", ["Venmo", "USPS", "Home Depot"], 1.0, 60, 35)
    income = sum(t["amount"] for t in b.txns if t["category"] == "paycheck")
    b.calibrate(round(income * 0.84, 2), {"groceries", "gas", "dining", "shopping", "health", "misc"},
                {"spend", "card"})
    card_by_month: dict[str, float] = {}
    for t in b.txns:
        if t["account_id"] == "card" and t["amount"] < 0:
            card_by_month[t["date"][:7]] = card_by_month.get(t["date"][:7], 0) - t["amount"]
    for m in month_starts(WINDOW_START, TODAY):
        amt = round(max(57.0, card_by_month.get(m.strftime("%Y-%m"), 0)), 2)
        b.add(on_day(m, 25), -amt, "Payment to Cash Rewards Visa", "card_payment", "spend", True)
        b.add(on_day(m, 25), amt, "Payment from Spend", "card_payment", "card", True)
    return {
        "customer": {"id": "household", "name": "Jordan and Priya", "age": 34, "city": "Plano", "state": "TX",
                     "occupation": "Teacher and engineer", "pay_schedule": "semimonthly",
                     "take_home_per_paycheck": paycheck, "next_payday": "2026-11-15",
                     "setup": {"insurance": {"health": True, "auto": True, "renters_or_home": True,
                                             "disability": True},
                               "planning_ahead": "yes"}},
        "accounts": accounts, "bills": bills, "transactions": b.sorted(),
    }


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    for cid, build in (("maya", maya), ("household", household)):
        raw = build()
        CustomerData.model_validate(raw)  # fail loudly if the file wouldn't load
        path = DATA_DIR / f"{cid}.json"
        path.write_text(json.dumps(raw, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(DATA_DIR.parent)} ({len(raw['transactions'])} transactions)")
