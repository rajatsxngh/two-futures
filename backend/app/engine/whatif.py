"""What-if rules (F6): turn a WhatIfRequest into month-by-month changes, and describe the result in one sentence.

Rules (from the PRD):
- Raise or pay cut: monthly take-home change = yearly change x (1 - 22% federal - 7.65% payroll) / 12.
  No state income tax (Texas).
- Spending change: added to monthly spending from the start month.
- Savings change: added to the automatic transfer. The money has to come from somewhere, so
  spending drops by the same amount (moving money between your own accounts creates none).
- One-time cost: paid from savings first, then the card.
- Job loss: income drops to $0 for the chosen months; plan transfers pause meanwhile.
- Buy a home: the down payment is paid like a one-time cost; the full housing cost (loan + Texas property
  tax + insurance + PMI under 20% down) replaces rent. Upkeep isn't included.
- Buy a car: the down payment is paid like a one-time cost; the loan payment runs for the term. The loan
  counts as debt; the car counts as an asset losing 15% a year. Insurance, gas and repairs aren't included.
What-ifs apply to the plan path only, and they stack in the order given.
"""

from __future__ import annotations

from datetime import date

import numpy as np

from ..models import CarLoanOption, CarPurchase, HomePurchase, PathResult, WhatIfRequest
from . import assumptions as A
from .fmt import round_half_up, usd
from .params import Params
from .sim import Adjust, CarPlan, HomePlan, SimResult, reserve_ids


def _mo(x: float) -> str:
    """Months with the same rounding as the on-screen numbers (half up)."""
    return f"{round_half_up(x, 1):.1f}"


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


def loan_payment(principal: float, apr: float, n_months: int) -> float:
    """Standard amortized monthly payment: L x r / (1 - (1 + r)^-n), r = APR / 12. At 0% APR it's L / n."""
    if principal <= 0:
        return 0.0
    r = apr / 100 / 12
    return principal / n_months if r == 0 else principal * r / (1 - (1 + r) ** -n_months)


def mortgage_payment(principal: float, rate: float, years: int) -> float:
    """Monthly principal and interest."""
    return loan_payment(principal, rate, years * 12)


def home_costs(h: HomePurchase) -> dict[str, float]:
    """The full monthly cost of a home: loan (principal and interest), property tax, insurance, and PMI
    (only with under 20% down; the sim drops it once the loan falls to 80% of the price)."""
    loan = h.price - h.down_payment
    return {
        "loan": mortgage_payment(loan, h.rate, h.term_years),
        "tax": h.price * A.HOME_PROPERTY_TAX / 12,
        "insurance": h.price * A.HOME_INSURANCE / 12,
        "pmi": loan * A.HOME_PMI / 12 if h.down_payment < 0.20 * h.price else 0.0,
    }


def home_breakdown(h: HomePurchase) -> tuple[float, dict[str, float]]:
    """The home costs rounded to whole dollars, and their total (the sum of the rounded parts, so it adds up)."""
    parts = {k: round_half_up(v) for k, v in home_costs(h).items()}
    return sum(parts.values()), parts


def car_payment(c: CarPurchase) -> float:
    return loan_payment(c.price - c.down, c.apr, c.term_months)


def car_options(c: CarPurchase) -> list[CarLoanOption]:
    """Same loan amount at 36/48/60/72 months (chosen APR), then the chosen term at APR -2 and +2 points."""
    loan = c.price - c.down
    if loan <= 0:
        return []  # paid in cash: no loan to compare
    combos = [(t, float(c.apr)) for t in A.CAR_OPTION_TERMS]
    for d in (-A.CAR_OPTION_APR_STEP, A.CAR_OPTION_APR_STEP):
        combos.append((c.term_months, min(35.0, max(0.0, c.apr + d))))
    out: list[CarLoanOption] = []
    seen: set[tuple[int, float]] = set()
    for term, apr in combos:
        if (term, apr) in seen:
            continue
        seen.add((term, apr))
        pay = loan_payment(loan, apr, term)
        out.append(CarLoanOption(term_months=term, apr=round(apr, 2), payment=round(pay, 2),
                                 total_interest=round(max(pay * term - loan, 0.0), 2),
                                 chosen=(term, apr) == (c.term_months, c.apr)))
    return out


def take_home_change(wi: WhatIfRequest) -> float:
    return (wi.income_change_yearly or 0) * TAKE_HOME_SHARE / 12


def monthly_net(wi: WhatIfRequest) -> float:
    """How much more (or less) is left each month once the change is in effect."""
    return take_home_change(wi) - (wi.spending_change_monthly or 0)


def to_adjust(p: Params, months: list[date], whatifs: list[WhatIfRequest]) -> Adjust:
    n = len(months)
    adj = Adjust.none(n)
    for wi in whatifs:
        s = start_index(months, wi)
        if wi.home:
            h = wi.home
            if h.price <= 0 or not 0 <= h.down_payment < h.price or h.rate < 0 or h.term_years <= 0:
                raise WhatIfError("A home needs a price, a down payment below the price, a rate and a term.")
            rent = sum(b.amount for b in p.fixed_bills if b.category == "housing" and b.due_rule.kind == "monthly")
            adj.spending[s:] -= rent
            adj.one_time[s] += h.down_payment
            costs = home_costs(h)
            adj.home = HomePlan(start=s, price=h.price, down=h.down_payment, rate=h.rate, term_years=h.term_years,
                                payment=costs["loan"], rent=rent, tax=costs["tax"], insurance=costs["insurance"],
                                pmi=costs["pmi"])
        if wi.car:
            c = wi.car
            if not (0 < c.price and 0 <= c.down <= c.price and c.apr >= 0 and c.term_months > 0):
                raise WhatIfError("A car needs a price, a down payment no more than the price, an APR and a term.")
            adj.one_time[s] += c.down
            adj.car = CarPlan(start=s, price=c.price, down=c.down, apr=c.apr, term_months=c.term_months,
                              payment=car_payment(c))
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


def _down_short(p: Params, sim: SimResult, start: int, down: float) -> str:
    """Can savings cover the down payment at `start`? If not, say so plainly: an unmet need, not affordable."""
    liquid = sim.balances[p.checking.id][:, start] + sum((sim.balances[r][:, start] for r in reserve_ids(p)), 0.0)
    short = float(np.median(np.maximum(down - liquid, 0)))
    card = p.card
    room = (float(np.median(np.maximum(card.limit - sim.balances[card.id][:, start], 0)))
            if card and card.limit else (short if card else 0.0))
    if short >= 50 and short - room >= 50:
        return (f" You'd be about {_about(short)} short for the down payment then: more than the card's "
                f"{usd(room)} of room, so about {_about(short - room)} of bills would go unpaid.")
    if short >= 50:
        return f" You'd be about {_about(short)} short for the down payment then, so that part would go on the card."
    return ""


def _leftover(sim: SimResult, i: int) -> float:
    """Take-home minus typical monthly spending (bills, everyday spending, loan payments) at the end of month i."""
    return float(sim.income[i] - np.median(sim.spend_typical[:, i + 1])) if sim.income is not None else 0.0


def _left_text(after: float, before: float) -> str:
    def say(x: float) -> str:
        return f"about {_about(x)} left" if x >= 0 else f"about {_about(x)} short"
    if after >= 0:
        return f"you'd have {say(after)} each month instead of {say(before)}"
    return f"you'd come up {say(after)} each month instead of having {say(before)}"


def car_sentence(p: Params, before_sim: SimResult | None, after_sim: SimResult, months: list[date]) -> str:
    c = after_sim.car
    s = c.start
    when = months[s]
    if c.payment > 0:
        out = (f"Buying a {usd(c.price)} car in {when:%B %Y} with {usd(c.down)} down means a {usd(c.payment)} "
               f"payment every month for {c.term_months} months.")
    else:
        out = f"Buying a {usd(c.price)} car in {when:%B %Y} with cash means no loan payment."
    if before_sim is not None:
        k = min(s + 1, len(months))
        c0, c1 = float(np.median(before_sim.cushion[:, k])), float(np.median(after_sim.cushion[:, k]))
        out += (f" Right after, your cushion would be {_mo(c1)} months instead of {_mo(c0)}, and "
                f"{_left_text(_leftover(after_sim, s), _leftover(before_sim, s))}.")
    out += _down_short(p, after_sim, s, c.down)
    # When would checking come up short (savings gone, so the card or unpaid bills cover the gap)?
    liquid = after_sim.balances[p.checking.id] + sum((after_sim.balances[r] for r in reserve_ids(p)), 0.0)
    dry = np.median(liquid, axis=0) < 50
    unpaid = np.median(after_sim.balances["unpaid_bills"], axis=0) >= 50
    if before_sim is not None:
        liquid0 = before_sim.balances[p.checking.id] + sum((before_sim.balances[r] for r in reserve_ids(p)), 0.0)
        dry &= np.median(liquid0, axis=0) >= 50  # only gaps the car causes
        unpaid &= np.median(before_sim.balances["unpaid_bills"], axis=0) < 50
    late = next((j for j in range(s + 2, len(months) + 1) if unpaid[j]), None)
    gap = next((j for j in range(s + 2, len(months) + 1) if dry[j]), None)
    if late is not None:
        out += f" From {months[late - 1]:%B %Y}, bills would start going unpaid."
    elif gap is not None:
        out += (f" Checking would come up short around {months[gap - 1]:%B %Y}, "
                "so the card would have to cover the gap.")
    return out + " Insurance, gas and repairs aren't included."


def sentence(wi: WhatIfRequest, before: PathResult, after: PathResult, months: list[date],
             after_sim: SimResult, p: Params | None = None, before_sim: SimResult | None = None) -> str:
    """One ready-made sentence the agent can say. Every number in it comes from the engine."""
    year = after.snapshots[-1].year
    c0, c1 = before.snapshots[-1].cushion_months, after.snapshots[-1].cushion_months
    nw = after.snapshots[-1].net_worth - before.snapshots[-1].net_worth
    if abs(c1 - c0) >= 0.05:
        tail = f"By {year}, your cushion would be about {_mo(c1)} months instead of {_mo(c0)}."
    elif abs(nw) >= 50:
        tail = f"By {year}, that's about {_about(nw)} {'more' if nw > 0 else 'less'} in net worth."
    else:
        tail = f"By {year}, it barely changes your numbers."
    net = monthly_net(wi)

    if wi.car and after_sim.car and p is not None:
        return car_sentence(p, before_sim, after_sim, months)
    if wi.home and after_sim.home:
        h = after_sim.home
        when = months[h.start]
        total, parts = home_breakdown(wi.home)
        pmi = f" + {usd(parts['pmi'])} PMI" if parts["pmi"] else ""
        out = (f"Buying a {usd(h.price)} home in {when:%B %Y} with {usd(h.down)} down means {usd(total)} a month: "
               f"{usd(parts['loan'])} loan + {usd(parts['tax'])} tax + {usd(parts['insurance'])} insurance{pmi} "
               f"instead of {usd(h.rent)} rent. {tail}")
        if p is not None:
            out += _down_short(p, after_sim, h.start, h.down)
        return out + " Upkeep isn't included."
    if wi.job_loss_months:
        s = start_index(months, wi)
        e = min(len(months), s + wi.job_loss_months)
        k = wi.job_loss_months
        gone = f"{k} month{'s' if k != 1 else ''} without pay"
        low = float(np.median(after_sim.cushion[:, s + 1:e + 2].min(axis=1)))
        unpaid = after_sim.balances["unpaid_bills"]
        peak_unpaid = float(np.median(unpaid.max(axis=1)))
        end_unpaid = float(np.median(unpaid[:, -1]))
        card = p.card if p is not None else None
        card_maxed = bool(card and card.limit and
                          float(np.median(after_sim.balances[card.id].max(axis=1))) >= card.limit - 1)
        if low >= 0.05:
            out = f"Going {gone}, your cushion would bottom out around {_mo(low)} months."
        else:
            hits = ["your savings would run out"]
            if card_maxed:
                hits.append(f"your card would hit its {usd(card.limit)} limit")
            if peak_unpaid >= 50:
                hits.append(f"about {_about(peak_unpaid)} of bills would go unpaid")
            joined = hits[0] if len(hits) == 1 else ", ".join(hits[:-1]) + (", and " if len(hits) > 2 else " and ") + hits[-1]
            out = f"Going {gone}, {joined}."
        if end_unpaid >= 50:
            out += f" By {year} you'd still be catching up, with about {_about(end_unpaid)} of bills unpaid."
        elif c1 >= 0.05:
            out += f" You'd be back to about {_mo(c1)} months of cushion by {year}."
        else:
            out += f" By {year} you'd still be rebuilding your savings."
        card_end = after.snapshots[-1].card_debt
        if card_end >= 1:
            out += f" Your card would end {year} at about {usd(card_end)}."
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
