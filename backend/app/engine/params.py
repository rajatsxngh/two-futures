"""Turn a customer's data into cash-flow parameters the simulations use.

Fixed bills come from the bills list. Everyday ("variable") spending is
learned from the last 12 months of transactions: for each category, the
monthly average and how much it has moved, minus whatever the bills list
already covers. Debts are modeled from their accounts (balance, APR,
minimum payment), not from bills.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from ..models import Account, AccountGroup, AccountType, Bill
from .assumptions import FLEXIBLE_CATEGORIES
from .calendar import bill_due_on
from .data import INCOME_CATEGORIES, TRANSFER_CATEGORIES, CustomerData

# Bills that are really debt payments or account events: modeled from accounts instead.
DEBT_BILL_CATEGORIES = {"auto_loan", "card_payment", "mortgage", "personal_loan", "cd_maturity"}
NOT_VARIABLE = DEBT_BILL_CATEGORIES | TRANSFER_CATEGORIES | INCOME_CATEGORIES | {"interest"}


@dataclass
class Category:
    name: str
    mean: float  # per month
    std: float  # month-to-month spread
    card_share: float  # fraction charged to the card
    flexible: bool


@dataclass
class Params:
    data: CustomerData
    today: date
    take_home_monthly: float
    checking: Account
    savings: Account | None
    cards: list[Account]
    loans: list[Account]  # non-card debts with a minimum payment
    cds: list[Account]
    iras: list[Account]
    fixed_bills: list[Bill]  # non-debt bills paid from cash
    categories: list[Category]
    reserve_contrib: float  # existing automatic monthly transfer to savings
    ira_contrib: float

    @property
    def card(self) -> Account | None:
        return self.cards[0] if self.cards else None

    def fixed_in_month(self, month: date, plan: bool) -> float:
        """Fixed bills due in the calendar month starting at `month`."""
        end = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
        total = 0.0
        for b in self.fixed_bills:
            if plan and b.unused:
                continue
            r = b.due_rule
            if r.kind == "monthly":
                total += b.amount
            elif r.date and ((r.kind == "yearly" and r.date.month == month.month) or
                             (r.kind == "once" and month <= r.date < end)):
                total += b.amount
        return total

    def variable_mean(self, plan: bool, trim: float) -> float:
        return sum(c.mean * (1 - trim if plan and c.flexible else 1) for c in self.categories)


def build_params(data: CustomerData, today: date) -> Params:
    by_type = lambda t: [a for a in data.accounts if a.type == t]  # noqa: E731
    checking = by_type(AccountType.checking)[0]
    savings = next(iter(by_type(AccountType.savings)), None)
    cards = by_type(AccountType.credit_card)
    loans = [a for a in data.accounts
             if a.group == AccountGroup.debt and a.type != AccountType.credit_card and a.min_payment]
    spend_accounts = {checking.id} | {c.id for c in cards}

    start = today - timedelta(days=364)
    window = [t for t in data.transactions if start <= t.date <= today]
    income = sum(t.amount for t in window if t.category in INCOME_CATEGORIES)

    # 12 equal buckets of the 365-day window, so bucket means are exact monthly means
    def bucket(d: date) -> int:
        return min(11, (d - start).days * 12 // 365)

    totals: dict[str, np.ndarray] = {}
    on_card: dict[str, float] = {}
    for t in window:
        if t.amount >= 0 or t.account_id not in spend_accounts or t.category in NOT_VARIABLE:
            continue
        arr = totals.setdefault(t.category, np.zeros(12))
        arr[bucket(t.date)] += -t.amount
        if t.account_id != checking.id:
            on_card[t.category] = on_card.get(t.category, 0.0) - t.amount

    # subtract what the bills list already covers
    fixed_bills = [b for b in data.bills if b.category not in DEBT_BILL_CATEGORIES]
    d = start
    while d <= today:
        for b in fixed_bills:
            if b.category in totals and bill_due_on(b, d):
                totals[b.category][bucket(d)] -= b.amount
        d += timedelta(days=1)

    categories = []
    for name, arr in sorted(totals.items()):
        if abs(arr.mean()) < 1.0:
            continue
        gross = arr.sum()
        categories.append(Category(
            name=name, mean=float(arr.mean()), std=float(arr.std(ddof=1)),
            card_share=float(min(1.0, on_card.get(name, 0.0) / gross)) if gross > 0 else 0.0,
            flexible=name in FLEXIBLE_CATEGORIES,
        ))

    return Params(
        data=data, today=today, take_home_monthly=income / 12, checking=checking, savings=savings,
        cards=cards, loans=loans, cds=by_type(AccountType.cd), iras=by_type(AccountType.ira),
        fixed_bills=fixed_bills, categories=categories,
        reserve_contrib=sum(a.monthly_contribution or 0 for a in by_type(AccountType.savings)),
        ira_contrib=sum(a.monthly_contribution or 0 for a in by_type(AccountType.ira)),
    )
