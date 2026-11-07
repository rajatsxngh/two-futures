"""When bills and paychecks land."""

from __future__ import annotations

from datetime import date, timedelta

from ..models import Bill, Customer, UpcomingBill


def _days(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def _last_day(d: date) -> int:
    return ((d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day


def bill_due_on(bill: Bill, d: date) -> bool:
    r = bill.due_rule
    if r.kind == "monthly" and r.day:
        # a bill due on the 31st lands on the last day of shorter months
        return d.day == min(r.day, _last_day(d))
    if r.kind == "yearly" and r.date:
        return (d.month, d.day) == (r.date.month, r.date.day)
    if r.kind == "once" and r.date:
        return d == r.date
    return False


def paydays(customer: Customer, start: date, end: date) -> list[date]:
    out: list[date] = []
    if customer.pay_schedule in ("weekly", "biweekly"):
        step = 7 if customer.pay_schedule == "weekly" else 14
        d = customer.next_payday
        while d > start:
            d -= timedelta(days=step)
        while d <= end:
            if d >= start:
                out.append(d)
            d += timedelta(days=step)
    else:
        days_of_month = (1, 15) if customer.pay_schedule == "semimonthly" else (1,)
        out = [d for d in _days(start, end) if d.day in days_of_month]
    return out


def upcoming(customer: Customer, bills: list[Bill], start: date, days: int = 90,
             include_income: bool = True, deposit_account: str = "spend") -> list[UpcomingBill]:
    """Bills, CD maturities and (optionally) paychecks from `start` through `start + days`, in date order."""
    end = start + timedelta(days=days)
    out: list[UpcomingBill] = []
    for d in _days(start, end):
        for b in bills:
            if bill_due_on(b, d):
                out.append(UpcomingBill(bill_id=b.id, name=b.name, amount=b.amount, date=d, account_id=b.account_id,
                                        kind="maturity" if b.category == "cd_maturity" else "bill"))
    if include_income:
        for d in paydays(customer, start, end):
            out.append(UpcomingBill(bill_id="paycheck", name="Paycheck", amount=customer.take_home_per_paycheck,
                                    date=d, account_id=deposit_account, kind="income"))
    out.sort(key=lambda u: (u.date, u.kind != "income", u.name))
    return out
