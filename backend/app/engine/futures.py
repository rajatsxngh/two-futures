"""Both 5-year paths as the API returns them: yearly snapshots, key numbers, events, plan, next step, fact sheets."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import json
from functools import lru_cache

import numpy as np

from ..models import (
    AccountType,
    FactSheet,
    FuturesResponse,
    HealthResponse,
    LifeEvent,
    Metric,
    NextStep,
    PathResult,
    Plan,
    PlanAction,
    SetupAnswers,
    WhatIfRequest,
    YearSnapshot,
)
from . import assumptions as A
from .data import CustomerData, load
from .fmt import metric, months as fmt_months, round_half_up, usd
from .forecast import rule1_transfer
from .health import FinancialState, band_of, health_for, score_state
from .params import Params, build_params
from .sim import PathId, SimResult, make_draws, month_starts, simulate
from .whatif import to_adjust

LABELS: dict[PathId, str] = {"same_path": "Same path", "plan": "With a plan"}


def med(x: np.ndarray) -> float:
    return float(np.median(x))


def mon(d: date) -> str:
    return d.strftime("%b %Y")


@dataclass
class FuturesBundle:
    response: FuturesResponse
    params: Params
    sims: dict[PathId, SimResult]
    month_labels: list[str]  # index 0 is today's month
    monthly_same: dict[str, list[float]]  # median balance per account per month index


# ---------------------------------------------------------------------------
# reading a simulation
# ---------------------------------------------------------------------------

def year_index(sim: SimResult, year: int, today: date) -> int:
    if year == today.year:
        return 0
    return next(i + 1 for i, m in enumerate(sim.months) if m.year == year and m.month == 12)


def first_month(sim: SimResult, hit: np.ndarray) -> date | None:
    """Median month (across runs) when `hit` (runs x months+1) first becomes true. None if most runs never get there."""
    any_hit = hit.any(axis=1)
    idx = np.where(any_hit, hit.argmax(axis=1), 10**6).astype(float)
    m = float(np.median(idx))
    if m >= 10**6 or m == 0:
        return None
    return sim.months[int(round_half_up(m)) - 1]


def payoff_date(sim: SimResult, account_id: str, due_day: int | None) -> date | None:
    arr = sim.balances[account_id]
    if arr[0, 0] <= 0.005:
        return None
    d = first_month(sim, arr <= 0.005)
    if d is None:
        return None
    return d.replace(day=min(due_day or 1, 28))


def state_for_year(p: Params, sim: SimResult, year: int, today: date) -> FinancialState:
    j = year_index(sim, year, today)
    cols = [i for i, m in enumerate(sim.months) if m.year == year]
    bal = {k: med(v[:, j]) for k, v in sim.balances.items()}
    plan = sim.path == "plan"
    debts = [(l.name, l.min_payment or 0) for l in p.loans if bal[l.id] > 0.005]
    debts += [(c.name, c.min_payment or 0) for c in p.cards if bal[c.id] > 0.005 and c.min_payment]
    if sim.home and bal.get("home_mortgage", 0) > 0.005:
        debts.append(("New mortgage", round(sim.home.payment, 2)))
    auto = [f"IRA ${p.ira_contrib:,.0f}/month"] if p.ira_contrib else []
    if plan and sim.transfer:
        auto.insert(0, f"Payday transfer ${sim.transfer:,.0f}")
    elif p.reserve_contrib:
        auto.insert(0, f"Savings ${p.reserve_contrib:,.0f}/month")
    return FinancialState(
        take_home_monthly=float(sim.income[cols].mean()) if sim.income is not None else p.take_home_monthly,
        spending_monthly=med(sim.spending[:, cols].mean(axis=1)),
        late_payments_12m=int(round(med(sim.late[:, cols].sum(axis=1)))) if sim.late is not None else 0,
        checking=bal[p.checking.id],
        savings=bal[p.savings.id] if p.savings else 0.0,
        retirement_contrib_monthly=p.ira_contrib + med(sim.ira_extra[:, cols].mean(axis=1)),
        debt_payments=debts,
        card_balance=sum(bal[c.id] for c in p.cards),
        card_limit=sum(c.limit or 0 for c in p.cards),
        insurance=p.data.customer.setup.insurance,
        planning_ahead=p.data.customer.setup.planning_ahead,
        automatic_saving=auto,
    )


# ---------------------------------------------------------------------------
# building the response
# ---------------------------------------------------------------------------

def _snapshots(p: Params, sim: SimResult, health_today: HealthResponse, today: date):
    snaps: list[YearSnapshot] = []
    scored: dict[int, HealthResponse] = {}
    for year in range(today.year, A.TARGET_YEAR + 1):
        j = year_index(sim, year, today)
        if year == today.year:
            h = health_today
            state_cushion = float(next(i for i in h.indicators if i.id == "savings_cushion").value.value)
        else:
            s = state_for_year(p, sim, year, today)
            h = score_state(s, date(year, 12, 31), prefix=f"{sim.path}.{year}")
            state_cushion = (s.checking + s.savings) / s.spending_monthly
        scored[year] = h
        assets = sum(sim.balances[a.id][:, j] for a in p.data.accounts if a.group.value != "debt")
        debts = sum(sim.balances[a.id][:, j] for a in p.data.accounts if a.group.value == "debt")
        debts = debts + sim.balances["unpaid_bills"][:, j]  # bills that went unpaid are owed
        if sim.home:  # the home counts at its purchase price (today's dollars), the mortgage as debt
            assets = assets + sim.balances["home_value"][:, j]
            debts = debts + sim.balances["home_mortgage"][:, j]
        snaps.append(YearSnapshot(
            year=year, age=p.data.customer.age + (year - today.year),
            balances={k: round(med(v[:, j]), 2) for k, v in sim.balances.items()},
            cushion_months=round(state_cushion, 2),
            card_debt=round(sum(med(sim.balances[c.id][:, j]) for c in p.cards), 2),
            ira_balance=round(sum(med(sim.balances[a.id][:, j]) for a in p.iras), 2),
            net_worth=round(med(assets - debts), 2),
            score=int(h.score.value), band=band_of(int(h.score.value)),
            indicator_scores={i.id: i.score for i in h.indicators},
        ))
    return snaps, scored


def _key_numbers(p: Params, sim: SimResult, snap: YearSnapshot, health: HealthResponse,
                 car_paid: date | None) -> list[Metric]:
    pre = f"{sim.path}.{snap.year}"
    note = A.listed(plan=sim.path == "plan")
    cushion_ind = next(i for i in health.indicators if i.id == "savings_cushion")
    out = [
        metric(f"{pre}.cushion_months", "Savings cushion", snap.cushion_months, "months",
               fmt_months(snap.cushion_months), f"(Checking + savings) ÷ monthly spending, end of {snap.year}",
               [(i.label, i.value, i.unit) for i in cushion_ind.value.math.inputs], note),
        metric(f"{pre}.card_debt", "Card debt", snap.card_debt, "usd", usd(snap.card_debt),
               f"Credit card balance at the end of {snap.year} (typical run)", [], note),
    ]
    if p.card:
        paid = med(sim.card_interest.sum(axis=1))
        out.append(metric(
            f"{pre}.card_interest", "Card interest paid", round(paid, 2), "usd", usd(paid),
            f"Interest paid on the credit card from {p.today.year} through {snap.year} (typical run)",
            [("Card balance today", p.card.balance, "usd", p.card.name), ("APR", p.card.rate or 0, "pct"),
             ("Car paid off", mon(car_paid) if car_paid else "not yet", "date", "for reference")], note))
    out.append(metric(f"{pre}.ira", "IRA", snap.ira_balance, "usd", usd(snap.ira_balance),
                      f"IRA balance at the end of {snap.year} (typical run, 5% growth)",
                      [("Balance today", sum(a.balance for a in p.iras), "usd"),
                       ("Monthly deposit", p.ira_contrib, "usd_per_month")], note))
    return out


def _events(p: Params, sim: SimResult, shared: list[dict], car_paid: date | None, card_paid: date | None,
            other_car_paid: date | None) -> list[LifeEvent]:
    ev: list[LifeEvent] = []
    for e in shared:
        ev.append(LifeEvent(date=e["date"], title=e["title"], description=e["description"], amount=e["amount"],
                            shared=True))
        sav_part, card_part = sim.event_split.get(e["title"], (e["amount"], 0.0))
        if card_part >= 1:
            desc = (f"{usd(sav_part)} came out of savings and {usd(card_part)} went on the card."
                    if sav_part >= 1 else f"With a thin cushion, all {usd(card_part)} went on the card.")
            title = f"{e['title']} goes on the card"
        else:
            desc, title = "The cushion covered it. The card didn't move.", f"{e['title']} paid from savings"
        ev.append(LifeEvent(date=e["date"], title=title, description=desc, amount=e["amount"], shared=False))
    for cd in p.cds:
        if cd.maturity_date and cd.maturity_date.year <= A.TARGET_YEAR:
            value = cd.balance * (1 + (cd.rate or 0) / 100 * (cd.term_months or 12) / 12)
            split = (sim.path == "plan" and p.card is not None
                     and 100 * p.card.balance / (p.card.limit or 1) > A.CARD_UTIL_LIMIT)
            ev.append(LifeEvent(
                date=cd.maturity_date, title=f"{cd.name} matures", amount=round(value, 2), shared=False,
                description="Half goes to the card, half to savings." if split else f"{usd(value)} moves to savings."))
    if sim.home:
        h = sim.home
        ev.append(LifeEvent(
            date=sim.months[h.start], title="Bought a home", amount=h.price, shared=False,
            description=(f"A {usd(h.price)} home with {usd(h.down)} down. The {usd(h.payment)} mortgage payment "
                         f"replaces {usd(h.rent)} rent.")))
    unpaid = sim.balances["unpaid_bills"]
    behind = first_month(sim, unpaid > 50)
    if behind:
        peak = med(unpaid.max(axis=1))
        ev.append(LifeEvent(date=behind, title="Fell behind on bills", amount=round(peak, 2), shared=False,
                            description=f"Savings and the card ran out. At the worst point about {usd(peak)} "
                                        "of bills went unpaid."))
    if card_paid:
        ev.append(LifeEvent(date=card_paid, title="Card paid off", shared=False,
                            description="The card balance hits $0, and its payment rolls into the next debt."))
    if car_paid:
        early = ""
        if other_car_paid and car_paid < other_car_paid:
            gap = (other_car_paid.year - car_paid.year) * 12 + other_car_paid.month - car_paid.month
            early = f" That's {gap} month{'s' if gap != 1 else ''} early."
        ev.append(LifeEvent(date=car_paid, title="Car paid off", shared=False,
                            description=f"The last car payment.{early}"))
    if sim.path == "plan":
        for target in (A.STARTER_CUSHION, A.CUSHION_FULL):
            d = first_month(sim, sim.cushion >= target)
            if d:
                ev.append(LifeEvent(date=d, title=f"Cushion reaches {target:.0f} months", shared=False,
                                    description=f"{target:.0f} months of spending set aside."))
    ev.sort(key=lambda e: (e.date, not e.shared))
    return ev


def _plan(p: Params, plan_sim: SimResult, transfer: float, low: float) -> Plan:
    acts: list[PlanAction] = []
    chk, sav = p.checking, p.savings
    customer = p.data.customer
    if transfer > 0 and sav:
        old = f" It replaces the ${p.reserve_contrib:,.0f} monthly transfer." if p.reserve_contrib else ""
        acts.append(PlanAction(
            id="auto_transfer", rule=1, title=f"Move ${transfer:,.0f} from {chk.name} to {sav.name} every payday",
            description=(f"Builds a {A.STARTER_CUSHION:.0f}-month starter cushion, then pays down the card. "
                         f"${transfer:,.0f} is the largest "
                         f"${A.TRANSFER_STEP:,.0f} step that keeps bad-case checking above ${A.CHECKING_FLOOR:,.0f} "
                         f"(its low point: {usd(low)}).{old}"),
            start_date=customer.next_payday, amount=transfer, frequency="payday", from_account_id=chk.id,
            to_account_id=sav.id, automatable=True))
    card = p.card
    for cd in p.cds:
        if card and cd.maturity_date and 100 * card.balance / (card.limit or 1) > A.CARD_UTIL_LIMIT:
            value = cd.balance * (1 + (cd.rate or 0) / 100 * (cd.term_months or 12) / 12)
            acts.append(PlanAction(
                id="windfall_split", rule=2, title=f"Split the {cd.name} between the card and savings",
                description=f"When it matures in {mon(cd.maturity_date)}, half goes to the card and half to savings.",
                start_date=cd.maturity_date, amount=round(value, 2), frequency="once", from_account_id=cd.id,
                automatable=False))
    first_of_next = (p.today.replace(day=28) + timedelta(days=4)).replace(day=1)
    for b in p.fixed_bills:
        if b.unused:
            acts.append(PlanAction(
                id=f"cancel_{b.id}", rule=3, title=f"Cancel the unused {b.name.lower()}",
                description=f"No recent use. Saves ${b.amount:,.0f} a month.", start_date=first_of_next,
                amount=b.amount, frequency="monthly", automatable=False))
    flex = sum(c.mean for c in p.categories if c.flexible) * A.FLEXIBLE_TRIM
    if flex >= 1:
        acts.append(PlanAction(
            id="trim_flexible", rule=3, title=f"Spend {A.FLEXIBLE_TRIM:.0%} less on dining, shopping and fun",
            description=f"About ${flex:,.0f} a month, based on the last 12 months.", start_date=first_of_next,
            amount=round(flex, 2), frequency="monthly", automatable=False))
    d3 = first_month(plan_sim, plan_sim.cushion >= A.STARTER_CUSHION)
    snowball = [c.name.lower() for c in p.cards] + [l.name.lower() for l in sorted(
        (l for l in p.loans if l.type != AccountType.mortgage), key=lambda a: -(a.rate or 0))]
    if snowball and d3:
        acts.append(PlanAction(
            id="debt_snowball", rule=4,
            title=f"Starter cushion at {A.STARTER_CUSHION:.0f} months: point the transfer at debt",
            description=(f"The transfer pays down debt, highest rate first ({', then '.join(snowball)}). "
                         "Each paid-off payment joins the transfer."),
            start_date=d3, frequency="monthly", automatable=False))
    debt_ids = [c.id for c in p.cards] + [l.id for l in p.loans if l.type != AccountType.mortgage]
    if debt_ids:
        all_paid = np.all([plan_sim.balances[i] <= 0.005 for i in debt_ids], axis=0)
        d_free = first_month(plan_sim, all_paid)
        if d_free:
            acts.append(PlanAction(
                id="fill_then_ira", rule=5, title=f"Debts gone: fill savings to {A.CUSHION_FULL:.0f} months, then the IRA",
                description="Freed-up money builds a 6-month cushion, then goes to retirement.",
                start_date=d_free, frequency="monthly", automatable=False))
    return Plan(actions=acts)


def _fact_sheet(path: PathId, p: Params, health_today: HealthResponse, snap: YearSnapshot, events: list[LifeEvent],
                interest_total: float, plan: Plan, next_step_text: str, today: date,
                whatif_lines: list[str] | None = None) -> FactSheet:
    c = p.data.customer
    ind = {i.id: i for i in health_today.indicators}
    rent = next((b for b in p.fixed_bills if b.category == "housing"), None)
    mortgage = next((l for l in p.loans if l.type == AccountType.mortgage), None)
    housing = (f"Rent: {usd(rent.amount)}." if rent else
               f"Mortgage: {usd(mortgage.min_payment or 0)} a month." if mortgage else "")
    loans = " ".join(f"{l.name}: {usd(l.balance)} left." for l in p.loans if l.type != AccountType.mortgage)
    card = p.card
    card_line = (f"Credit card: {usd(card.balance)} of {usd(card.limit or 0)} ({ind['credit_health'].value.display})."
                 if card else "")
    today_facts = [
        f"Today is {today.strftime('%B %Y')}. You are {c.name}, {c.age}, "
        f"{'an' if c.occupation[0].lower() in 'aeiou' else 'a'} {c.occupation.lower()} in {c.city}.",
        " ".join(x for x in [f"Take-home pay: {usd(p.take_home_monthly)} a month.", housing, loans, card_line] if x),
        f"Savings cushion: {ind['savings_cushion'].value.display}. Financial Health Score: "
        f"{int(health_today.score.value)} ({health_today.band}).",
    ]
    y, age = snap.year, snap.age
    how = {e.title: e for e in events if not e.shared}
    facts = [f"It's {y}. You're {age}."]
    if path == "same_path":
        facts[0] += f" You kept doing what you did in {today.year}."
    else:
        first = plan.actions[0].title if plan.actions else "a simple plan"
        facts[0] += f" In {today.year} you started the plan: {first[0].lower() + first[1:]}."
    for e in sorted(events, key=lambda e: e.date):
        if e.shared:
            paid = next((v for k, v in how.items() if k.startswith(e.title)), None)
            facts.append(f"In {mon(e.date)}: {e.title.lower()}, {usd(e.amount or 0)}. "
                         f"{paid.description if paid else ''}".strip())
        elif e.title in ("Card paid off", "Car paid off", "Bought a home", "Fell behind on bills") or e.title.startswith("Cushion reaches"):
            facts.append(f"{e.title} in {mon(e.date)}. {e.description}")
    facts.append(f"In {y}: cushion about {fmt_months(snap.cushion_months)}, card debt {usd(snap.card_debt)}, "
                 f"IRA about {usd(snap.ira_balance)}, net worth about {usd(snap.net_worth)}.")
    if interest_total >= 1:
        facts.append(f"Card interest paid from {today.year} to {y}: about {usd(interest_total)}.")
    facts.append(f"Financial Health Score in {y}: {snap.score} ({snap.band}).")

    plan_summary = "; ".join(a.title for a in plan.actions) or "No changes."
    first_name = c.name.split(" ")[0]
    if path == "same_path":
        opening = ("Hey... it's me. Well, it's you, five years from now. Honestly? Things are okay, "
                   "but that card never really went away." if snap.card_debt >= 1 else
                   "Hey... it's me. Well, it's you, five years from now. Things turned out okay. Ask me anything.")
    else:
        amt = plan.actions[0].amount if plan.actions and plan.actions[0].rule == 1 else None
        opening = (f"Hey... it's me. Well, it's you, five years from now. That little ${amt:,.0f} habit? "
                   "It changed more than I expected." if amt else
                   "Hey... it's me. Well, it's you, five years from now. The plan worked. Ask me anything.")
    text = "\n".join([
        f"WHO: {first_name}'s future self, {y} ({LABELS[path].lower()}). All money in today's dollars.",
        "", f"TODAY ({today.year}):", *today_facts,
        "", f"YOUR LIFE IN {y}:", *facts,
        "", f"PLAN: {plan_summary}", f"NEXT STEP: {next_step_text}",
        *(["", "WHAT-IFS APPLIED (already in the numbers above):", *whatif_lines] if whatif_lines else []),
    ])
    return FactSheet(path=path, today_facts=today_facts, future_facts=facts, plan_summary=plan_summary,
                     next_step=next_step_text, opening_line=opening, text=text)


def build_futures(data: CustomerData, today: date,
                  applied: list[tuple[WhatIfRequest, str]] | None = None) -> FuturesBundle:
    """Both paths. `applied` what-ifs (request, sentence) change the plan path only."""
    applied = applied or []
    p = build_params(data, today)
    health_today = health_for(data, today)
    transfer, low = rule1_transfer(p)
    months = month_starts(today, A.TARGET_YEAR)
    draws = make_draws(p, len(months))
    shared = A.SHARED_EVENTS.get(data.customer.id, [])
    adjust = to_adjust(p, months, [w for w, _ in applied])
    sims: dict[PathId, SimResult] = {
        "same_path": simulate(p, "same_path", draws, 0.0, shared),
        "plan": simulate(p, "plan", draws, transfer, shared, adjust),
    }

    car = next((l for l in p.loans if l.type == AccountType.auto_loan), None)
    car_paid = {k: payoff_date(s, car.id, car.due_day) if car else None for k, s in sims.items()}
    card_paid = {k: payoff_date(s, p.card.id, p.card.due_day) if p.card else None for k, s in sims.items()}

    plan = _plan(p, sims["plan"], transfer, low)
    paths: dict[PathId, PathResult] = {}
    scored_all = {}
    snaps_all = {}
    events_all = {}
    for k, s in sims.items():
        snaps, scored = _snapshots(p, s, health_today, today)
        snaps_all[k], scored_all[k] = snaps, scored
        other = "plan" if k == "same_path" else "same_path"
        events_all[k] = _events(p, s, shared, car_paid[k], card_paid[k], car_paid[other])
        paths[k] = PathResult(
            path=k, label=LABELS[k], snapshots=snaps,
            key_numbers=_key_numbers(p, s, snaps[-1], scored[A.TARGET_YEAR], car_paid[k]),
            payoff_dates={l.id: payoff_date(s, l.id, l.due_day) for l in [*p.cards, *p.loans]},
            events=events_all[k],
        )

    same_end, plan_end = snaps_all["same_path"][-1], snaps_all["plan"][-1]
    j1 = 12
    first = plan.actions[0] if plan.actions and plan.actions[0].automatable else None
    if first:
        next_text = f"{first.title}, starting {first.start_date.strftime('%A, %B')} {first.start_date.day}."
        next_step = NextStep(
            action_id=first.id, title=first.title, amount=first.amount or 0, from_account_id=first.from_account_id or "",
            to_account_id=first.to_account_id or "", frequency="payday", first_date=first.start_date,
            amount_metric=metric(
                "next_step.amount", "Payday transfer", first.amount or 0, "usd", usd(first.amount or 0),
                f"The largest ${A.TRANSFER_STEP:,.0f} step per payday that keeps bad-case (10th percentile) "
                f"{p.checking.name} above ${A.CHECKING_FLOOR:,.0f} for the next 12 months",
                [("Bad-case low point with this amount", round(low, 2), "usd", "12-month simulation"),
                 ("Floor", A.CHECKING_FLOOR, "usd"), ("Step", A.TRANSFER_STEP, "usd"),
                 ("Next step up", (first.amount or 0) + A.TRANSFER_STEP, "usd", "would dip below the floor")],
                [f"The plan spends {A.FLEXIBLE_TRIM:.0%} less on flexible categories and cancels unused "
                 "subscriptions.", f"It replaces the ${p.reserve_contrib:,.0f} monthly savings transfer."
                 if p.reserve_contrib else "No existing savings transfer to replace."]),
            effects=[
                metric("next_step.score_2031", f"Score in {A.TARGET_YEAR}", plan_end.score, "score",
                       f"{plan_end.score} vs {same_end.score}",
                       f"Plan-path {A.TARGET_YEAR} score compared with the same-path {A.TARGET_YEAR} score",
                       [("With the plan", plan_end.score, "score"), ("Same path", same_end.score, "score")]),
                metric("next_step.cushion_1y", "Cushion in a year", round(med(sims["plan"].cushion[:, j1]), 2), "months",
                       f"{fmt_months(med(sims['plan'].cushion[:, j1]))} vs {fmt_months(med(sims['same_path'].cushion[:, j1]))}",
                       f"Projected cushion in {mon(months[j1 - 1])}, with the plan vs. the same path",
                       [("With the plan", round(med(sims["plan"].cushion[:, j1]), 2), "months"),
                        ("Same path", round(med(sims["same_path"].cushion[:, j1]), 2), "months")]),
            ],
        )
    else:
        next_text = "Keep going: your cushion and debts are already on track."
        next_step = NextStep(action_id="none", title=next_text, amount=0, from_account_id=p.checking.id,
                             to_account_id=p.checking.id, frequency="monthly", first_date=today, effects=[])

    fact_sheets = {}
    for k, s in sims.items():
        fact_sheets[k] = _fact_sheet(k, p, health_today, snaps_all[k][-1], events_all[k],
                                     med(s.card_interest.sum(axis=1)), plan, next_text, today,
                                     [f"{w.description} -> {line}" for w, line in applied] if k == "plan" else None)

    response = FuturesResponse(
        as_of=today, target_year=A.TARGET_YEAR, paths=paths, plan=plan, next_step=next_step,
        fact_sheets=fact_sheets,
        assumptions=A.listed(plan=True) + [
            f"Plan rule 1 picks the largest ${A.TRANSFER_STEP:,.0f} payday transfer that keeps bad-case "
            f"(10th percentile) checking above ${A.CHECKING_FLOOR:,.0f} for the next 12 months."],
    )
    same = sims["same_path"]
    labels = [today.strftime("%Y-%m")] + [m.strftime("%Y-%m") for m in months]
    monthly_same = {a.id: [med(same.balances[a.id][:, j]) for j in range(len(labels))] for a in data.accounts}
    return FuturesBundle(response=response, params=p, sims=sims, month_labels=labels, monthly_same=monthly_same)


@lru_cache(maxsize=256)
def _cached(customer_id: str, today: date, key: str, setup_key: str) -> FuturesBundle:
    applied = [(WhatIfRequest.model_validate(w), line) for w, line in json.loads(key)]
    data = load(customer_id)
    if setup_key:
        data = data.model_copy(update={"customer": data.customer.model_copy(
            update={"setup": SetupAnswers.model_validate_json(setup_key)})})
    return build_futures(data, today, applied)


def futures_for(customer_id: str, today: date,
                applied: list[tuple[WhatIfRequest, str]] | None = None,
                setup: SetupAnswers | None = None) -> FuturesBundle:
    key = json.dumps([[w.model_dump(mode="json"), line] for w, line in (applied or [])], sort_keys=True)
    return _cached(customer_id, today, key, setup.model_dump_json() if setup else "")
