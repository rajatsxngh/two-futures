"""Five-year monthly simulation of every account, for both paths (F4).

Both paths use the *same* random draws (spending and surprises) and the same
scheduled event, so the only difference between them is the decisions.

Same path: keep doing what the data shows. Pay the card's interest and new
charges each month (the balance never really shrinks), keep the existing
automatic transfers, and let freed-up money sit in checking.

Plan path (fixed order, no AI):
  1. Cushion under the starter level (2 months): an automatic transfer every payday
     builds savings (amount from `forecast.rule1_transfer`). It replaces the old
     monthly savings transfer.
  2. Card over 30% used: windfalls (a maturing CD) go half to the card, half to savings.
  3. Cancel unused subscriptions; spend less on flexible categories.
  4. Starter cushion in place: the transfer pays down debts, highest rate first
     (mortgage excluded), so a 25% card isn't carried while savings earn almost
     nothing. When a debt is paid off, its payment joins the transfer.
  5. Debts gone: fill savings to 6 months, then send the money to the IRA.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

import numpy as np

from ..models import AccountType
from . import assumptions as A
from .params import Params

PathId = Literal["same_path", "plan"]
PAYS_PER_YEAR = {"weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12}


def month_starts(today: date, end_year: int) -> list[date]:
    """First day of each month from next month through December of `end_year`."""
    out, d = [], (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    while d.year <= end_year:
        out.append(d)
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


@dataclass
class Draws:
    spending: np.ndarray  # runs x months x categories
    surprises: np.ndarray  # runs x months


def make_draws(p: Params, n_months: int, runs: int = A.RUNS, seed: int = A.SEED + 1) -> Draws:
    rng = np.random.default_rng(seed)
    means = np.array([c.mean for c in p.categories])
    stds = np.array([c.std for c in p.categories])
    spending = np.clip(rng.normal(means, stds, size=(runs, n_months, len(p.categories))), 0, None)
    hit = rng.random((runs, n_months)) < A.SURPRISE_PROB
    surprises = hit * rng.uniform(A.SURPRISE_MIN, A.SURPRISE_MAX, size=(runs, n_months))
    return Draws(spending=spending, surprises=surprises)


@dataclass
class HomePlan:
    """A home purchase on the plan path (what-if): a mortgage replaces rent from month `start`."""

    start: int  # month index of the purchase
    price: float
    down: float
    rate: float  # APR, percent
    term_years: int
    payment: float  # monthly principal and interest
    rent: float  # rent it replaces


@dataclass
class Adjust:
    """Month-by-month changes from what-ifs (plan path only). Arrays have one entry per simulated month."""

    income: np.ndarray  # change to monthly take-home
    spending: np.ndarray  # change to monthly spending
    pool: np.ndarray  # extra automatic saving
    one_time: np.ndarray  # one-time costs (savings first, then the card)
    pause: np.ndarray  # bool: plan transfers paused (e.g. while out of work)
    home: HomePlan | None = None

    @classmethod
    def none(cls, n: int) -> "Adjust":
        z = np.zeros(n)
        return cls(income=z.copy(), spending=z.copy(), pool=z.copy(), one_time=z.copy(), pause=np.zeros(n, dtype=bool))


@dataclass
class SimResult:
    path: PathId
    months: list[date]  # index i+1 in the arrays below; index 0 is today
    balances: dict[str, np.ndarray]  # account_id -> runs x (months+1); debts positive
    spending: np.ndarray  # runs x months: spending in each month (health definition)
    ira_extra: np.ndarray  # runs x months: plan rule 5 IRA deposits
    card_interest: np.ndarray  # runs x months: interest paid on cards
    cushion: np.ndarray  # runs x (months+1): (checking + savings) / typical monthly spending
    spend_typical: np.ndarray  # runs x (months+1)
    event_split: dict[str, tuple[float, float]] = field(default_factory=dict)  # title -> (from savings, on card), medians
    transfer: float = 0.0
    income: np.ndarray | None = None  # monthly take-home per month, after what-ifs
    home: HomePlan | None = None
    late: np.ndarray | None = None  # runs x months: bills unpaid at month end
    card_limit: float = float("inf")


def simulate(p: Params, path: PathId, draws: Draws, transfer: float, shared_events: list[dict],
             adjust: Adjust | None = None) -> SimResult:
    plan = path == "plan"
    months = month_starts(p.today, A.TARGET_YEAR)
    n = len(months)
    adj = adjust or Adjust.none(n)
    runs = draws.surprises.shape[0]
    trim = np.array([1 - A.FLEXIBLE_TRIM if (plan and c.flexible) else 1.0 for c in p.categories])

    accounts = p.data.accounts
    bal = {a.id: np.full(runs, float(a.balance)) for a in accounts}
    hist = {a.id: np.zeros((runs, n + 1)) for a in accounts}
    for a in accounts:
        hist[a.id][:, 0] = a.balance
    spending = np.zeros((runs, n))
    home = adj.home
    mortgage = np.zeros(runs)
    if home:
        hist["home_mortgage"] = np.zeros((runs, n + 1))
        hist["home_value"] = np.zeros((runs, n + 1))
    ira_extra = np.zeros((runs, n))
    card_interest = np.zeros((runs, n))
    # Money nothing could cover (savings empty, card at its limit): bills that went unpaid.
    unpaid = np.zeros(runs)
    hist["unpaid_bills"] = np.zeros((runs, n + 1))
    late = np.zeros((runs, n), dtype=bool)
    cushion = np.zeros((runs, n + 1))
    spend_typ = np.zeros((runs, n + 1))

    chk, sav = p.checking.id, (p.savings.id if p.savings else None)
    cards = p.cards
    snowball = [c for c in cards] + sorted(
        [l for l in p.loans if l.type != AccountType.mortgage], key=lambda a: -(a.rate or 0))
    pays = PAYS_PER_YEAR[p.data.customer.pay_schedule]
    base_pool = transfer * pays / 12
    freed = np.zeros(runs)
    paid_off = {a.id: np.zeros(runs, dtype=bool) for a in snowball}
    fixed_regular = sum(b.amount for b in p.fixed_bills if b.due_rule.kind == "monthly" and not (plan and b.unused))
    var_typ = float((np.array([c.mean for c in p.categories]) * trim).sum())
    event_by_month = {(e["date"].year, e["date"].month): e for e in shared_events}
    split_log: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    def typical_spend(extra: float = 0.0) -> np.ndarray:
        card_int = sum(bal[c.id] * (c.rate or 0) / 100 / 12 for c in cards)
        mins = sum(np.where(bal[l.id] > 0.005, l.min_payment or 0, 0) for l in p.loans)
        return fixed_regular + var_typ + card_int + mins + extra

    def liquid() -> np.ndarray:
        return bal[chk] + (bal[sav] if sav else 0)

    card_limit = float(cards[0].limit) if cards and cards[0].limit else float("inf")

    def overflow(amount: np.ndarray) -> None:
        """Money savings couldn't cover: onto the card up to its limit, the rest becomes unpaid bills."""
        rest = amount
        if cards:
            c = cards[0]
            x = np.minimum(amount, np.maximum(card_limit - bal[c.id], 0.0))
            bal[c.id] += x
            rest = amount - x
        unpaid[:] += rest

    st = typical_spend()
    spend_typ[:, 0] = st
    cushion[:, 0] = liquid() / st

    for i, md in enumerate(months):
        # income and fixed bills
        bal[chk] += p.take_home_monthly + adj.income[i]
        fixed = p.fixed_in_month(md, plan)
        var = (draws.spending[:, i, :] * trim).sum(axis=1)
        bal[chk] -= fixed + var + adj.spending[i]
        spent = fixed + var + adj.spending[i]

        # card: pay this month's interest (new charges are already in `var`)
        for c in cards:
            interest = bal[c.id] * (c.rate or 0) / 100 / 12
            bal[chk] -= interest
            spent = spent + interest
            card_interest[:, i] += interest

        # loans: interest accrues, minimum payment from checking
        for l in p.loans:
            owed = bal[l.id] * (1 + (l.rate or 0) / 100 / 12)
            pay = np.minimum(l.min_payment or 0, owed)
            bal[l.id] = owed - pay
            bal[chk] -= pay
            spent = spent + pay
        home_payment = 0.0
        if home and i >= home.start:
            if i == home.start:
                mortgage = np.full(runs, home.price - home.down)
            owed = mortgage * (1 + home.rate / 100 / 12)
            pay = np.minimum(home.payment, owed)
            mortgage = owed - pay
            bal[chk] -= pay
            spent = spent + pay
            home_payment = home.payment

        # retirement and the existing savings habit
        g = A.IRA_GROWTH["typical"] / 12
        for ira in p.iras:
            bal[ira.id] = bal[ira.id] * (1 + g) + (ira.monthly_contribution or 0)
        bal[chk] -= p.ira_contrib
        if not plan and sav:
            bal[sav] += p.reserve_contrib
            bal[chk] -= p.reserve_contrib

        # catch up on unpaid bills first, with whatever checking has this month
        catch_up = np.minimum(unpaid, np.maximum(bal[chk], 0))
        bal[chk] -= catch_up
        unpaid[:] -= catch_up

        # plan waterfall (rules 1, 4, 5)
        if plan:
            st = typical_spend(adj.spending[i] + home_payment)
            cush = liquid() / st
            # no plan transfers while out of work or behind on bills
            pool = np.where(adj.pause[i] | (unpaid > 0.005), 0.0, base_pool + freed + adj.pool[i])
            bal[chk] -= pool
            building = cush < A.STARTER_CUSHION
            to_sav = np.where(building, pool, 0.0)
            remaining = np.where(building, 0.0, pool)
            for d in snowball:
                x = np.minimum(remaining, bal[d.id])
                bal[d.id] -= x
                remaining -= x
            debts_left = sum(bal[d.id] for d in snowball) > 0.005 if snowball else np.zeros(runs, dtype=bool)
            fill = (cush < A.CUSHION_FULL) | debts_left
            to_sav = to_sav + np.where(fill, remaining, 0.0)
            to_ira = np.where(fill, 0.0, remaining)
            if sav:
                bal[sav] += to_sav
            else:
                bal[chk] += to_sav
            if p.iras:
                bal[p.iras[0].id] += to_ira
            ira_extra[:, i] = to_ira

        # surprises: savings first, then the card
        s = draws.surprises[:, i].copy() + adj.one_time[i]
        ev = event_by_month.get((md.year, md.month))
        if ev:
            s = s + ev["amount"]
        from_sav = np.minimum(s, np.maximum(bal[sav], 0)) if sav else np.zeros(runs)
        if sav:
            bal[sav] -= from_sav
        overflow(s - from_sav)
        if ev:
            # how the scheduled event itself was paid (assume it comes first in the month)
            ev_sav = np.minimum(ev["amount"], from_sav)
            split_log[ev["title"]] = (ev_sav, ev["amount"] - ev_sav)

        # maturing CDs (rule 2 on the plan path)
        for cd in p.cds:
            if cd.maturity_date and (cd.maturity_date.year, cd.maturity_date.month) == (md.year, md.month):
                value = bal[cd.id] * (1 + (cd.rate or 0) / 100 * (cd.term_months or 12) / 12)
                bal[cd.id] = np.zeros(runs)
                to_savings = value
                if plan and cards:
                    c = cards[0]
                    util = 100 * bal[c.id] / (c.limit or 1)
                    half = np.where(util > A.CARD_UTIL_LIMIT, value / 2, 0.0)
                    x = np.minimum(half, bal[c.id])
                    bal[c.id] -= x
                    to_savings = value - x
                if sav:
                    bal[sav] += to_savings
                else:
                    bal[chk] += to_savings

        # never let checking go negative: pull from savings, then the card
        short = np.maximum(-bal[chk], 0)
        if sav:
            pull = np.minimum(short, np.maximum(bal[sav], 0))
            bal[sav] -= pull
            short -= pull
        overflow(short)
        bal[chk] += np.maximum(-bal[chk], 0)

        # rule 4: a paid-off debt's payment joins the transfer
        if plan:
            for d in snowball:
                now = bal[d.id] <= 0.005
                newly = now & ~paid_off[d.id]
                freed += np.where(newly, d.min_payment or 0, 0.0)
                paid_off[d.id] |= now

        for a in accounts:
            bal[a.id] = np.where(np.abs(bal[a.id]) < 0.005, 0.0, bal[a.id])
            hist[a.id][:, i + 1] = bal[a.id]
        hist["unpaid_bills"][:, i + 1] = unpaid
        late[:, i] = unpaid > 0.5
        if home:
            hist["home_mortgage"][:, i + 1] = mortgage
            hist["home_value"][:, i + 1] = home.price if i >= home.start else 0.0
        spending[:, i] = spent
        st = typical_spend(adj.spending[i] + home_payment)
        spend_typ[:, i + 1] = st
        cushion[:, i + 1] = liquid() / st

    return SimResult(
        path=path, months=months, balances=hist, spending=spending, ira_extra=ira_extra, card_interest=card_interest, cushion=cushion,
        spend_typical=spend_typ, transfer=transfer, income=p.take_home_monthly + adj.income, home=home,
        late=late, card_limit=card_limit,
        event_split={k: (float(np.median(a)), float(np.median(b))) for k, (a, b) in split_log.items()},
    )
