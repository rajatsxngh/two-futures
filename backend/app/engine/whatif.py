"""What-if rules (F6): turn a WhatIfRequest into month-by-month changes, and describe the result in one sentence.

Rules (from the PRD):
- Raise or pay cut: monthly take-home change = yearly change x (1 - 22% federal - 7.65% payroll) / 12.
  No state income tax (Texas).
- Spending change: added to monthly spending from the start month.
- Savings change: added to the automatic transfer. The money has to come from somewhere, so
  spending drops by the same amount (moving money between your own accounts creates none).
- One-time cost: paid from savings first, then the card.
- Job loss: income drops to $0 for the chosen months; plan transfers pause meanwhile.
What-ifs apply to the plan path only, and they stack in the order given.
"""

from __future__ import annotations

from datetime import date

import numpy as np

from ..models import PathResult, WhatIfRequest
from .fmt import round_half_up, usd
from .params import Params
from .sim import Adjust, SimResult

FEDERAL_TAX = 0.22
PAYROLL_TAX = 0.0765
TAKE_HOME_SHARE = 1 - FEDERAL_TAX - PAYROLL_TAX


class WhatIfError(ValueError):
    pass


def start_index(months: list[date], wi: WhatIfRequest) -> int:
    if not wi.start_month:
        return 0
    try:
        y, m = (int(x) for x in wi.start_month.split("-"))
    except ValueError as e:
        raise WhatIfError(f"start_month must look like YYYY-MM, got '{wi.start_month}'") from e
    for i, d in enumerate(months):
        if (d.year, d.month) >= (y, m):
            return i
    raise WhatIfError(f"start_month {wi.start_month} is after {months[-1]:%B %Y}")


def take_home_change(wi: WhatIfRequest) -> float:
    return (wi.income_change_yearly or 0) * TAKE_HOME_SHARE / 12


def monthly_net(wi: WhatIfRequest) -> float:
    """How much more (or less) is left each month once the change is in effect."""
    return take_home_change(wi) - (wi.spending_change_monthly or 0)


def to_adjust(p: Params, months: list[date], whatifs: list[WhatIfRequest]) -> Adjust:
    n = len(months)
    adj = Adjust.none(n)
    for wi in whatifs:
        if wi.home:
            raise WhatIfError("The buy-a-home what-if isn't built yet (milestone M11).")
        s = start_index(months, wi)
        if wi.income_change_yearly:
            adj.income[s:] += take_home_change(wi)
        if wi.spending_change_monthly:
            adj.spending[s:] += wi.spending_change_monthly
        if wi.savings_change_monthly:
            adj.pool[s:] += wi.savings_change_monthly
            adj.spending[s:] -= wi.savings_change_monthly
        if wi.one_time_cost:
            adj.one_time[s] += wi.one_time_cost
        if wi.job_loss_months:
            e = min(n, s + wi.job_loss_months)
            adj.income[s:e] = -p.take_home_monthly  # no pay at all, including any raise
            adj.pause[s:e] = True
    return adj


def _key(path: PathResult, name: str):
    return next(m for m in path.key_numbers if m.id.endswith(name))


def _about(x: float) -> str:
    """Money said out loud: nearest $10 under $1,000, nearest $100 above."""
    step = 10 if abs(x) < 1000 else 100
    return usd(round_half_up(abs(x) / step) * step)


def sentence(wi: WhatIfRequest, before: PathResult, after: PathResult, months: list[date],
             after_sim: SimResult) -> str:
    """One ready-made sentence the agent can say. Every number in it comes from the engine."""
    year = after.snapshots[-1].year
    c0, c1 = before.snapshots[-1].cushion_months, after.snapshots[-1].cushion_months
    nw = after.snapshots[-1].net_worth - before.snapshots[-1].net_worth
    if abs(c1 - c0) >= 0.05:
        tail = f"By {year}, your cushion would be about {c1:.1f} months instead of {c0:.1f}."
    elif abs(nw) >= 50:
        tail = f"By {year}, that's about {_about(nw)} {'more' if nw > 0 else 'less'} in net worth."
    else:
        tail = f"By {year}, it barely changes your numbers."
    net = monthly_net(wi)

    if wi.job_loss_months:
        s = start_index(months, wi)
        e = min(len(months), s + wi.job_loss_months)
        low = float(np.median(after_sim.cushion[:, s + 1:e + 2].min(axis=1)))
        card_peak = after.snapshots[-1].card_debt
        k = wi.job_loss_months
        gone = f"{k} month{'s' if k != 1 else ''} without pay"
        out = (f"Going {gone}, your savings would run out and the rest would go on the card; "
               f"you'd be back to about {c1:.1f} months of cushion by {year}." if low < 0.05 else
               f"Going {gone}, your cushion would bottom out around {low:.1f} months, "
               f"and you'd be back to about {c1:.1f} months by {year}.")
        if card_peak >= 1:
            out += f" Your card would end {year} at about {usd(card_peak)}."
        return out
    if wi.income_change_yearly:
        verb = "Taking the new job" if wi.preset in ("new_job", "move") else (
            "The raise" if wi.income_change_yearly > 0 else "The pay cut")
        costs = " and the higher costs" if (wi.spending_change_monthly or 0) > 0 else ""
        if wi.spending_change_monthly and wi.preset in ("new_job", "move"):
            costs = " and the higher rent"
        direction = "more" if net >= 0 else "less"
        return f"{verb} leaves about {_about(net)} {direction} a month after taxes{costs}. {tail}"
    if wi.spending_change_monthly:
        word = "costs" if wi.spending_change_monthly > 0 else "saves"
        return f"That {word} about {_about(wi.spending_change_monthly)} a month. {tail}"
    if wi.savings_change_monthly:
        return f"Saving {usd(wi.savings_change_monthly)} more a month, by spending that much less: {tail[0].lower() + tail[1:]}"
    if wi.one_time_cost:
        when = months[start_index(months, wi)]
        return (f"Paying {usd(wi.one_time_cost)} in {when:%B %Y} comes out of savings first, then the card. "
                f"{tail}")
    sign = "more" if nw >= 0 else "less"
    return f"That change leaves you about {_about(nw)} {sign} in net worth by {year}. {tail}"
