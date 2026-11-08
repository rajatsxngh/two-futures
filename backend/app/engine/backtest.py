"""Backtest: would the forecast have worked on history we already have?

Hide the last HOLDOUT_MONTHS of history, learn the parameters from the months
before it only, run the same daily Monte Carlo from the real checking balance
on the cutoff day, and compare it with the real daily balance afterwards.

The history has 12 months. Holding out 3 leaves 9 monthly samples per spending
category to learn from (enough for an average and a spread) and gives 91 test
days, which cover three full rent / card-payment / pay cycles and match the
forecast's own 90-day risk window. Holding out more would leave too few months
to learn from; less would test barely two cycles.

Nothing here is tuned: it calls `build_params` and `simulate_daily` as they are.
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

import numpy as np

from ..models import AccountGroup, BacktestPoint, BacktestResponse
from . import assumptions as A
from .data import CustomerData, load
from .fmt import metric, pct, usd
from .forecast import simulate_daily
from .params import build_params

HISTORY_MONTHS = 12
HOLDOUT_MONTHS = 3
TRAIN_MONTHS = HISTORY_MONTHS - HOLDOUT_MONTHS
HOLDOUT_DAYS = round(HISTORY_MONTHS * 365 / 12) - round(TRAIN_MONTHS * 365 / 12)  # 365 - 274 = 91

CAVEAT = "Tested on made-up history, so this checks the method, not real-world accuracy."


def balance_on(data: CustomerData, account_id: str, d: date) -> float:
    """An account's end-of-day balance on `d`, rebuilt from today's balance and every later transaction.

    Debts are stored as amounts owed, so a later charge (negative amount) means less was owed on `d`.
    """
    acct = data.account(account_id)
    later = sum(t.amount for t in data.transactions if t.account_id == account_id and t.date > d)
    return acct.balance + later if acct.group == AccountGroup.debt else acct.balance - later


def as_of(data: CustomerData, cutoff: date) -> CustomerData:
    """The customer as they stood at the end of `cutoff`: no later transactions, and checking and card
    balances rebuilt for that day. Bills and loan terms are as listed (the data keeps no history of them)."""
    checking = next(a for a in data.accounts if a.type.value == "checking")
    rebuilt = {a.id for a in data.accounts if a.id == checking.id or a.type.value == "credit_card"}
    accounts = [a.model_copy(update={"balance": round(balance_on(data, a.id, cutoff), 2)}) if a.id in rebuilt else a
                for a in data.accounts]
    return data.model_copy(update={"accounts": accounts,
                                   "transactions": [t for t in data.transactions if t.date <= cutoff]})


def run_backtest(data: CustomerData, today: date) -> BacktestResponse:
    cutoff = today - timedelta(days=HOLDOUT_DAYS)
    past = as_of(data, cutoff)
    p = build_params(past, cutoff, months=TRAIN_MONTHS)
    train_start = cutoff - timedelta(days=round(TRAIN_MONTHS * 365 / 12) - 1)
    bal, _ = simulate_daily(p)  # the same simulation as the forecast, as if today were the cutoff
    n = HOLDOUT_DAYS + 1  # day 0 is the cutoff itself (known), days 1..91 are the test
    bal = bal[:, :n]
    p10, p25, p50, p75, p90 = np.percentile(bal, [10, 25, 50, 75, 90], axis=0)

    dates = [cutoff + timedelta(days=i) for i in range(n)]
    actual = np.array([balance_on(data, p.checking.id, d) for d in dates])

    test = slice(1, n)  # day 0 matches by construction, so it isn't scored
    a = actual[test]
    in80 = (a >= p10[test]) & (a <= p90[test])
    in50 = (a >= p25[test]) & (a <= p75[test])
    cov80 = float(in80.mean() * 100)
    cov50 = float(in50.mean() * 100)
    mae = float(np.abs(p50[test] - a).mean())

    lows = bal[:, test].min(axis=1)  # each run's lowest balance in the test window
    low_p10, low_p50, low_p90 = (float(x) for x in np.percentile(lows, [10, 50, 90]))
    i_low = int(np.argmin(a))
    actual_low, low_date = float(a[i_low]), dates[1 + i_low]
    low_in_band = bool(low_p10 <= actual_low <= low_p90)

    once = [b for b in p.fixed_bills if b.due_rule.kind == "once" and b.due_rule.date
            and cutoff < b.due_rule.date <= today]
    name = p.checking.name
    window = f"{dates[1]:%b} {dates[1].day} to {today:%b} {today.day}, {today.year}"
    assumptions = [
        CAVEAT + " The history comes from our own generator, which builds spending the way the model assumes "
        "(steady monthly averages plus random noise), so a good score partly reflects that match.",
        f"The model learned only from {train_start:%b} {train_start.day}, {train_start.year} to "
        f"{cutoff:%b} {cutoff.day}, {cutoff.year} ({TRAIN_MONTHS} months). The last {HOLDOUT_DAYS} days "
        f"({window}) were hidden from it.",
        f"Same simulation as the forecast: {A.RUNS:,} runs, seed {A.SEED}, the same bills, paydays, loan and card "
        f"payments, started from the real {name} balance on {cutoff:%b} {cutoff.day} ({usd(float(actual[0]))}).",
        (f"One-off bills in the hidden window were fed in, as the forecast would: {', '.join(b.name for b in once)}."
         if once else "No one-off bills fall in the hidden window, so none were fed in."),
        f"Real daily balances are rebuilt from the transactions: today's {name} balance minus every later "
        "transaction. Bills and loan terms are as listed today; the data keeps no history of them.",
        f"Neighboring days are linked (each balance carries into the next), so {HOLDOUT_DAYS} days are far fewer "
        f"than {HOLDOUT_DAYS} independent checks. Treat these numbers as rough.",
    ]

    days_in = int(in80.sum())
    series = [BacktestPoint(date=d, actual=round(float(v), 2), p10=round(float(q10), 2), p25=round(float(q25), 2),
                            p50=round(float(q50), 2), p75=round(float(q75), 2), p90=round(float(q90), 2))
              for d, v, q10, q25, q50, q75, q90 in zip(dates, actual, p10, p25, p50, p75, p90)]
    return BacktestResponse(
        customer=data.customer.id, as_of=today, cutoff=cutoff, train_start=train_start, train_months=TRAIN_MONTHS,
        holdout_days=HOLDOUT_DAYS, runs=A.RUNS, seed=A.SEED, series=series,
        verdict=(f"Over the last {HOLDOUT_DAYS} days of history, the real balance stayed inside our range "
                 f"{pct(cov80)} of days."),
        coverage_80=metric(
            "backtest.coverage_10_90", "Days inside the range", round(cov80, 1), "pct", pct(cov80),
            f"Share of the {HOLDOUT_DAYS} hidden days where the real {name} balance was between the 10th and 90th "
            f"percentile of the simulated runs (the range on the chart). A well-sized range catches about 80%.",
            [("Days inside", days_in, "count"), ("Days tested", HOLDOUT_DAYS, "count"), ("Target", 80, "pct")],
            assumptions),
        coverage_50=metric(
            "backtest.coverage_25_75", "Days inside the middle half", round(cov50, 1), "pct", pct(cov50),
            f"Share of the {HOLDOUT_DAYS} hidden days where the real balance was between the 25th and 75th "
            "percentile of the simulated runs. A well-sized middle half catches about 50%.",
            [("Days inside", int(in50.sum()), "count"), ("Days tested", HOLDOUT_DAYS, "count"), ("Target", 50, "pct")],
            assumptions),
        median_error=metric(
            "backtest.median_error", "Typical miss", round(mae, 2), "usd", usd(mae),
            f"Average over the {HOLDOUT_DAYS} hidden days of |typical (median) forecast - real balance|",
            [("Days tested", HOLDOUT_DAYS, "count"), ("Largest daily miss", round(float(np.abs(p50[test] - a).max()), 2),
                                                       "usd"),
             ("Real balance at the cutoff", round(float(actual[0]), 2), "usd", name)],
            assumptions),
        low_actual=metric(
            "backtest.low_actual", "Real low point", round(actual_low, 2), "usd", usd(actual_low),
            f"Lowest real end-of-day {name} balance in the hidden window ({low_date:%b} {low_date.day})",
            [("Date", low_date.isoformat(), "date"), ("Predicted low (typical)", round(low_p50, 2), "usd"),
             ("Predicted low, bad case (10th percentile)", round(low_p10, 2), "usd"),
             ("Predicted low, good case (90th percentile)", round(low_p90, 2), "usd")],
            assumptions),
        low_predicted=metric(
            "backtest.low_predicted", "Predicted low point", round(low_p50, 2), "usd", usd(low_p50),
            f"Each simulated run's lowest balance in the hidden window; this is the middle of those {A.RUNS:,} lows, "
            f"and the range is their 10th to 90th percentile ({usd(low_p10)} to {usd(low_p90)}). The real low "
            f"({usd(actual_low)}) was {'inside' if low_in_band else 'outside'} it.",
            [("Bad case (10th percentile)", round(low_p10, 2), "usd"), ("Good case (90th percentile)",
                                                                         round(low_p90, 2), "usd"),
             ("Real low", round(actual_low, 2), "usd", name)],
            assumptions),
        low_in_band=low_in_band, caveat=CAVEAT, assumptions=assumptions,
    )


@lru_cache(maxsize=None)
def backtest_for(customer_id: str, today: date) -> BacktestResponse:
    return run_backtest(load(customer_id), today)
