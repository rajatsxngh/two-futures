"""12-month daily cash forecast (F3) and plan rule 1's transfer amount.

The daily simulation tracks the checking account only. Fixed flows (pay,
bills, loan payments, automatic transfers) are the same in every run;
everyday spending is drawn per category per month and spread across the
days. Card purchases reach checking as the monthly card payment.
Surprises come out of savings first and then the card, never checking.
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

import numpy as np

from ..models import AccountType, ForecastMarker, ForecastPoint, ForecastResponse, AccountForecast, AccountMonthPoint
from . import assumptions as A
from .calendar import bill_due_on, paydays, upcoming
from .fmt import metric, pct, usd
from .params import Params

DAYS = 366  # today plus 365 days


def _month_index(d: date, today: date) -> int:
    return (d.year - today.year) * 12 + d.month - today.month


def _days_in_month(d: date) -> int:
    return ((d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day


def simulate_daily(p: Params, plan: bool = False, trim: float = 0.0,
                   runs: int = A.RUNS, seed: int = A.SEED) -> tuple[np.ndarray, np.ndarray]:
    """Checking balance per run per day, plus the running count of paydays (for rule 1's transfer).

    Returns (balances[runs, DAYS], paydays_so_far[DAYS]). Day 0 is today, before any flows.
    """
    rng = np.random.default_rng(seed)
    today = p.today
    dates = [today + timedelta(days=i) for i in range(DAYS)]
    n_months = _month_index(dates[-1], today) + 1
    cats = p.categories

    # random monthly spending per category
    means = np.array([c.mean for c in cats])
    stds = np.array([c.std for c in cats])
    draws = np.clip(rng.normal(means, stds, size=(runs, n_months, len(cats))), 0, None)
    if plan:
        draws *= np.array([1 - trim if c.flexible else 1.0 for c in cats])
    card_share = np.array([c.card_share for c in cats])
    cash_monthly = (draws * (1 - card_share)).sum(axis=2)  # runs x months
    card_monthly = (draws * card_share).sum(axis=2)

    pay_set = set(paydays(p.data.customer, today + timedelta(days=1), dates[-1]))
    card = p.card
    card_interest = sum(c.balance * (c.rate or 0) / 100 / 12 for c in p.cards)
    card_day = card.due_day if card and card.due_day else 22

    det = np.zeros(DAYS)
    rand = np.zeros((runs, DAYS))
    k = np.zeros(DAYS)
    count = 0
    for i, d in enumerate(dates):
        if i == 0:
            k[i] = 0
            continue
        m = _month_index(d, today)
        if d in pay_set:
            det[i] += p.data.customer.take_home_per_paycheck
            count += 1
        k[i] = count
        for b in p.fixed_bills:
            if b.account_id == p.checking.id and not (plan and b.id in p.cancelled) and bill_due_on(b, d):
                det[i] -= b.amount
        for loan in p.loans:
            if loan.due_day and d.day == min(loan.due_day, _days_in_month(d)):
                det[i] -= loan.min_payment or 0
        if d.day == 2:
            det[i] -= p.ira_contrib + (0 if plan else p.reserve_contrib)
        rand[:, i] -= cash_monthly[:, m] / _days_in_month(d)
        if card and d.day == min(card_day, _days_in_month(d)):
            rand[:, i] -= card_monthly[:, m]
            det[i] -= card_interest

    balances = p.checking.balance + np.cumsum(det + rand, axis=1)
    return balances, k


def rule1_transfer(p: Params) -> tuple[float, float]:
    """Plan rule 1: the largest $25 step per payday that keeps bad-case (10th percentile) checking above the floor.

    Returns (amount, the bad-case low point with that amount).
    """
    bal, k = simulate_daily(p, plan=True, trim=A.FLEXIBLE_TRIM)
    p10 = np.percentile(bal, 10, axis=0)
    # subtracting T on every payday shifts each day's percentile by exactly T * paydays-so-far
    best, low = 0.0, float(p10.min())
    t = A.TRANSFER_STEP
    while t <= A.TRANSFER_MAX:
        lo = float((p10 - t * k).min())
        if lo < A.CHECKING_FLOOR:
            break
        best, low = t, lo
        t += A.TRANSFER_STEP
    return best, low


@lru_cache(maxsize=None)
def _cached_forecast(customer_id: str, today: date) -> ForecastResponse:
    from .data import load
    from .futures import futures_for
    from .params import build_params

    data = load(customer_id)
    p = build_params(data, today)
    bal, _ = simulate_daily(p)
    p10, p50, p90 = np.percentile(bal, [10, 50, 90], axis=0)
    dates = [today + timedelta(days=i) for i in range(DAYS)]
    series = [ForecastPoint(date=d, p10=round(float(a), 2), p50=round(float(b), 2), p90=round(float(c), 2))
              for d, a, b, c in zip(dates, p10, p50, p90)]

    risk = float((bal[:, :91].min(axis=1) < 0).mean() * 100)
    risk_days = [dates[i] for i in range(91) if p10[i] < 0]

    kind_of = {"housing": "rent", "mortgage": "rent", "auto_loan": "car", "card_payment": "card",
               "insurance": "insurance", "cd_maturity": "cd", "subscription": "subscription"}
    markers = []
    for u in upcoming(data.customer, data.bills, today + timedelta(days=1), 365, include_income=False):
        b = next(x for x in data.bills if x.id == u.bill_id)
        kind = kind_of.get(b.category)
        if kind in ("rent", "car", "card", "cd", "insurance"):
            markers.append(ForecastMarker(date=u.date, label=u.name, kind=kind, amount=u.amount))

    # per-account typical monthly balances come from the same-path 5-year simulation
    fut = futures_for(customer_id, today)
    monthly = fut.monthly_same
    accounts = []
    for a in data.accounts:
        pts = [AccountMonthPoint(month=mo, balance=round(float(v), 2))
               for mo, v in zip(fut.month_labels[:13], monthly[a.id][:13])]
        end = pts[-1]
        accounts.append(AccountForecast(
            account_id=a.id, name=a.name, type=a.type, points=pts,
            end=metric(f"forecast.account.{a.id}.end", f"{a.name} in a year", end.balance, "usd", usd(end.balance),
                       f"Typical (middle) balance of {a.name} in {end.month}, across {A.RUNS:,} simulated runs",
                       [("Balance today", a.balance, "usd", a.name)], A.listed(plan=False))))

    runs_below = int(round(risk / 100 * A.RUNS))
    return ForecastResponse(
        as_of=today, runs=A.RUNS, seed=A.SEED, cash_series=series, accounts=accounts, markers=markers,
        bills_next_90=upcoming(data.customer, data.bills, today, 90, deposit_account=p.checking.id),
        risk_days=risk_days,
        overdraft_risk_90d=metric(
            "forecast.overdraft_risk_90d", "Chance of dipping below $0 (90 days)", round(risk, 1), "pct", pct(risk),
            f"Share of {A.RUNS:,} simulated runs where {p.checking.name} drops below $0 in the next 90 days",
            [("Simulated runs", A.RUNS, "count"), ("Runs below $0", runs_below, "count"),
             ("Starting balance", p.checking.balance, "usd", p.checking.name)],
            A.listed(plan=False)),
        headline=[
            metric("forecast.cash.p50_end", "Typical balance in a year", round(float(p50[-1]), 2), "usd",
                   usd(float(p50[-1])), f"Middle result for {p.checking.name} on {dates[-1]:%b} {dates[-1].day}, "
                   f"{dates[-1].year}, across {A.RUNS:,} simulated runs",
                   [("Balance today", p.checking.balance, "usd", p.checking.name),
                    ("Bad case (10th percentile)", round(float(p10[-1]), 2), "usd"),
                    ("Good case (90th percentile)", round(float(p90[-1]), 2), "usd")], A.listed(plan=False)),
            metric("forecast.cash.range", "Range in a year", f"{usd(float(p10[-1]))} to {usd(float(p90[-1]))}", "usd",
                   f"{usd(float(p10[-1]))} to {usd(float(p90[-1]))}",
                   "From the 10th to the 90th percentile of simulated balances: 8 in 10 runs land inside it",
                   [("Bad case", round(float(p10[-1]), 2), "usd"), ("Good case", round(float(p90[-1]), 2), "usd")],
                   A.listed(plan=False)),
        ],
        assumptions=A.listed(plan=False) + [
            f"Typical low point for {p.checking.name} in the next 90 days: {usd(float(p50[:91].min()))}; "
            f"bad case: {usd(float(p10[:91].min()))}."],
    )


def forecast_for(customer_id: str, today: date) -> ForecastResponse:
    return _cached_forecast(customer_id, today)


__all__ = ["AccountType", "forecast_for", "rule1_transfer", "simulate_daily"]
