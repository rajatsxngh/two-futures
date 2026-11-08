"""Repeating charges ("subscriptions") found in the transaction history.

A bank can't know whether you still go to the gym. It can see the same
merchant charging about the same amount on a steady schedule, and ask.
So this module only finds the charges; whether you still use each one is
the customer's answer (`SetupAnswers.subscriptions`), never a guess.

The rule, in plain words:
  1. Take money-out transactions (on or before today), skipping transfers
     between your own accounts, paychecks, loan and card payments, interest
     and fees, and essentials (rent, utilities, insurance, childcare). Those
     repeat too, but they aren't things you'd cancel because you stopped
     using them.
  2. Group them by merchant, after cleaning up the description (case,
     store numbers, "*" prefixes, "Inc."...).
  3. A group is a subscription when it has at least 3 charges, every gap is
     about a month (25-35 days) or about a week (6-8 days), every charge
     before the latest is within 10% of their typical (median) amount, and
     the latest charge is recent (it hasn't been cancelled already).
  4. Price change: the latest charge is more than 5% above the earlier
     typical amount.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from statistics import median
from typing import Literal

from ..models import Bill, DueRule, Metric, Subscription, Transaction
from .data import DEBT_BILL_CATEGORIES, INCOME_CATEGORIES, LATE_FEE, TRANSFER_CATEGORIES
from .fmt import metric, pct, usd

MIN_CHARGES = 3
AMOUNT_TOLERANCE = 0.10  # earlier charges within 10% of their median
PRICE_CHANGE = 0.05  # latest more than 5% above the earlier typical amount
CADENCES: dict[str, tuple[int, int, float]] = {  # name -> (min gap, max gap, charges per month)
    "monthly": (25, 35, 1.0),
    "weekly": (6, 8, 52 / 12),
}
RECENT_GRACE_DAYS = 10  # still active if the last charge is within one period + this many days

# Repeating, but not something you cancel because you stopped using it.
NOT_SUBSCRIPTIONS = TRANSFER_CATEGORIES | INCOME_CATEGORIES | DEBT_BILL_CATEGORIES | {"interest", LATE_FEE}
ESSENTIALS = {"housing", "utilities", "insurance", "childcare"}

_PREFIX = re.compile(r"^(sq|tst|pp|paypal|sp|dd)\s*\*\s*")
_NOISE = re.compile(r"\.(com|net|io)\b|#\s*\d+|\d+|[^a-z\s]")
_SUFFIX_WORDS = {"inc", "llc", "co", "corp", "ltd", "payment", "autopay", "recurring", "bill"}


def normalize_merchant(raw: str) -> str:
    """'SQ *IRON GYM #0042' -> 'iron gym'. Same merchant, same key."""
    s = _PREFIX.sub("", raw.lower().strip())
    s = _NOISE.sub(" ", s)
    words = [w for w in s.split() if w not in _SUFFIX_WORDS]
    return " ".join(words)


@dataclass
class Detected:
    id: str  # slug of the normalized merchant, e.g. 'iron_gym'
    merchant: str  # as it appears on the latest charge
    category: str
    account_id: str
    cadence: Literal["weekly", "monthly"]
    count: int
    first_charge: date
    last_charge: date
    typical_amount: float  # median of the charges before the latest
    latest_amount: float
    monthly_amount: float  # latest amount x charges per month
    median_gap_days: float
    max_spread_pct: float  # largest gap from the typical amount, earlier charges
    price_change: bool

    @property
    def price_change_pct(self) -> float:
        return 100 * (self.latest_amount / self.typical_amount - 1) if self.typical_amount else 0.0


def _cadence(gaps: list[int]) -> str | None:
    for name, (lo, hi, _) in CADENCES.items():
        if all(lo <= g <= hi for g in gaps):
            return name
    return None


def detect(transactions: list[Transaction], today: date) -> list[Detected]:
    """Every subscription in the history, biggest monthly cost first."""
    groups: dict[str, list[Transaction]] = {}
    for t in transactions:
        if t.amount >= 0 or t.date > today or t.category in NOT_SUBSCRIPTIONS or t.category in ESSENTIALS:
            continue
        key = normalize_merchant(t.merchant)
        if key:
            groups.setdefault(key, []).append(t)

    found: list[Detected] = []
    for key, txns in groups.items():
        if len(txns) < MIN_CHARGES:
            continue
        txns.sort(key=lambda t: (t.date, t.id))
        cadence = _cadence([(b.date - a.date).days for a, b in zip(txns, txns[1:])])
        if cadence is None:
            continue
        _, hi, per_month = CADENCES[cadence]
        last = txns[-1]
        if (today - last.date).days > hi + RECENT_GRACE_DAYS:
            continue  # stopped already
        amounts = [-t.amount for t in txns]
        earlier, latest = amounts[:-1], amounts[-1]
        typical = median(earlier)
        spread = max(abs(a - typical) / typical for a in earlier)
        if spread > AMOUNT_TOLERANCE or not typical * 0.5 <= latest <= typical * 2:
            continue
        gaps = [(b.date - a.date).days for a, b in zip(txns, txns[1:])]
        found.append(Detected(
            id=key.replace(" ", "_"), merchant=last.merchant, category=last.category, account_id=last.account_id,
            cadence=cadence, count=len(txns), first_charge=txns[0].date, last_charge=last.date,
            typical_amount=round(typical, 2), latest_amount=round(latest, 2),
            monthly_amount=round(latest * per_month, 2), median_gap_days=float(median(gaps)),
            max_spread_pct=round(100 * spread, 1), price_change=latest > typical * (1 + PRICE_CHANGE),
        ))
    found.sort(key=lambda d: (-d.monthly_amount, d.id))
    return found


def matching_bill(sub: Detected, bills: list[Bill]) -> Bill | None:
    """The bill on file for this charge: same account, monthly, amount within 10% of the latest charge."""
    candidates = [b for b in bills
                  if b.category not in DEBT_BILL_CATEGORIES and b.due_rule.kind == "monthly"
                  and b.account_id == sub.account_id
                  and abs(b.amount - sub.latest_amount) <= AMOUNT_TOLERANCE * sub.latest_amount]
    return min(candidates, key=lambda b: (abs(b.amount - sub.latest_amount),
                                          abs((b.due_rule.day or 0) - sub.last_charge.day)), default=None)


def as_bill(sub: Detected) -> Bill:
    """A subscription with no bill on file, as a monthly bill (so the plan can cancel it)."""
    return Bill(id=f"sub_{sub.id}", name=sub.merchant, amount=sub.monthly_amount, category=sub.category,
                due_rule=DueRule(kind="monthly", day=min(sub.last_charge.day, 28)), account_id=sub.account_id)


def money(x: float) -> str:
    """$40 or $15.99: cents only when there are some."""
    return usd(x) if abs(x - round(x)) < 0.005 else usd(x, cents=True)


def sub_metric(sub: Detected) -> Metric:
    lo, hi, per_month = CADENCES[sub.cadence]
    every = "month" if sub.cadence == "monthly" else "week"
    formula = (f"Same merchant charged {sub.count} times, about every {every} "
               f"(every gap {lo}-{hi} days), each earlier charge within {AMOUNT_TOLERANCE:.0%} of the typical "
               f"amount. Cost a month = latest charge" + (" × 52 ÷ 12" if sub.cadence == "weekly" else ""))
    inputs = [
        ("Charges found", sub.count, "count", "Transaction history"),
        ("First charge", sub.first_charge.isoformat(), "date", "Transaction history"),
        ("Last charge", sub.last_charge.isoformat(), "date", "Transaction history"),
        ("Typical gap (days)", sub.median_gap_days, "count", "Median of the gaps between charges"),
        ("Typical amount", sub.typical_amount, "usd", "Median of the charges before the latest"),
        ("Latest charge", sub.latest_amount, "usd", "Transaction history"),
        ("Largest gap from typical", sub.max_spread_pct, "pct", "Earlier charges"),
        ("Rule: at least this many charges", MIN_CHARGES, "count", "Detection rule"),
        ("Rule: amounts within", AMOUNT_TOLERANCE * 100, "pct", "Detection rule"),
        ("Rule: price change above", PRICE_CHANGE * 100, "pct", "Detection rule"),
    ]
    if sub.cadence == "weekly":
        inputs.append(("Charges a month", round(per_month, 2), "count", "52 weeks ÷ 12 months"))
    notes = [
        "Skipped: transfers between your own accounts, paychecks, loan and card payments, interest and fees, "
        "and essentials (rent, utilities, insurance, childcare).",
        "Whether you still use it comes from your answer, not from the data.",
    ]
    if sub.price_change:
        notes.insert(0, f"Price went up: the latest charge is {pct(sub.price_change_pct)} above the earlier "
                        f"typical {money(sub.typical_amount)}.")
    return metric(f"subscription.{sub.id}.monthly", sub.merchant, sub.monthly_amount, "usd_per_month",
                  f"{money(sub.monthly_amount)}/mo", formula, inputs, notes)


def to_model(sub: Detected, bill: Bill, answers: dict[str, bool]) -> Subscription:
    return Subscription(
        id=sub.id, merchant=sub.merchant, cadence=sub.cadence, count=sub.count, last_charge=sub.last_charge,
        typical_amount=sub.typical_amount, latest_amount=sub.latest_amount, monthly_amount=sub.monthly_amount,
        price_change=sub.price_change, still_using=answers.get(sub.id), bill_id=bill.id, metric=sub_metric(sub))
