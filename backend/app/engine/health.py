"""Financial Health Score: 8 indicators, 4 pillars, one 0-100 score (F2).

Aligned with the Financial Health Network's Spend / Save / Borrow / Plan
framework, but computed from account data rather than survey answers.

- Each indicator scores 0-100 on a straight line between two thresholds.
- A pillar is the average of its two indicators, rounded half up.
- The score is the average of the four pillar scores, rounded half up.
- Bands: 0-39 vulnerable, 40-79 coping, 80-100 healthy.

`score_state()` takes a `FinancialState`, not a customer file, so the
forecast engine (M4) can score any future year with the same code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from ..models import (
    AccountGroup,
    AccountType,
    Band,
    HealthResponse,
    Indicator,
    InsuranceAnswers,
    Pillar,
    PillarId,
    Status,
)
from .data import (
    history_days,
    INCOME_CATEGORIES,
    LATE_FEE,
    RETIREMENT_CONTRIBUTION,
    TRANSFER_CATEGORIES,
    CustomerData,
)
from .fmt import metric, months, pct, round_half_up, usd

LINEAR = "Scores move in a straight line between the two thresholds."


@dataclass
class FinancialState:
    """Everything the 8 indicators need, as monthly figures in today's dollars."""

    take_home_monthly: float
    spending_monthly: float
    late_payments_12m: int
    checking: float
    savings: float
    retirement_contrib_monthly: float
    debt_payments: list[tuple[str, float]]  # (label, monthly minimum)
    card_balance: float
    card_limit: float
    insurance: InsuranceAnswers
    planning_ahead: str  # "yes" | "sometimes" | "no"
    automatic_saving: list[str] = field(default_factory=list)  # e.g. ["IRA $100/month"]


# ---------------------------------------------------------------------------
# Building a state from a customer's data
# ---------------------------------------------------------------------------

def state_from_data(data: CustomerData, today: date) -> FinancialState:
    start = today - timedelta(days=364)
    window = [t for t in data.transactions if start <= t.date <= today]
    kinds = {a.id: a.type for a in data.accounts}
    spend_accounts = {a.id for a in data.accounts if a.type in (AccountType.checking, AccountType.credit_card)}

    income = sum(t.amount for t in window if t.category in INCOME_CATEGORIES)
    spending = -sum(t.amount for t in window
                    if t.amount < 0 and t.account_id in spend_accounts and t.category not in TRANSFER_CATEGORIES)
    retirement = sum(t.amount for t in window
                     if t.amount > 0 and t.category == RETIREMENT_CONTRIBUTION and kinds[t.account_id] == AccountType.ira)
    late = sum(1 for t in window if t.category == LATE_FEE)

    def total(*types: AccountType) -> float:
        return sum(a.balance for a in data.accounts if a.type in types)

    debts = [(a.name, a.min_payment or 0.0) for a in data.accounts
             if a.group == AccountGroup.debt and a.balance > 0 and a.min_payment]
    auto = [f"{a.name} ${a.monthly_contribution:,.0f}/month" for a in data.accounts if a.monthly_contribution]

    # Monthly averages over the last 12 months, or over the history there is when it's shorter (a connected bank).
    months = 12
    days = history_days(data, today)
    if 0 < days < 365:
        months = days * 12 / 365

    return FinancialState(
        take_home_monthly=income / months,
        spending_monthly=spending / months,
        late_payments_12m=late,
        checking=total(AccountType.checking),
        savings=total(AccountType.savings),
        retirement_contrib_monthly=retirement / months,
        debt_payments=debts,
        card_balance=total(AccountType.credit_card),
        card_limit=sum(a.limit or 0 for a in data.accounts if a.type == AccountType.credit_card),
        insurance=data.customer.setup.insurance,
        planning_ahead=data.customer.setup.planning_ahead,
        automatic_saving=auto,
    )


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def linear_score(value: float, best: float, worst: float) -> int:
    """100 at `best`, 0 at `worst`, straight line between, clamped. Works in either direction."""
    frac = (value - worst) / (best - worst)
    return int(round_half_up(max(0.0, min(1.0, frac)) * 100))


def status_of(score: int) -> Status:
    return "green" if score >= 80 else "amber" if score >= 40 else "red"


def band_of(score: int) -> Band:
    return "healthy" if score >= 80 else "coping" if score >= 40 else "vulnerable"


def _indicator(n: int, id: str, pillar: PillarId, label: str, score: int, reason: str, value) -> Indicator:
    return Indicator(id=id, number=n, pillar=pillar, label=label, score=score, status=status_of(score),
                     reason=reason, value=value)


def indicators(s: FinancialState, prefix: str = "health") -> list[Indicator]:
    th = s.take_home_monthly
    out: list[Indicator] = []

    # 1. Spending vs. income
    ratio = 100 * s.spending_monthly / th if th else 999.0
    score = linear_score(ratio, 85, 100)
    cents = round_half_up(ratio)
    reason = (f"You spend about {cents:.0f} cents of every dollar you bring home." if ratio < 100
              else "You're spending more than you bring home.")
    out.append(_indicator(1, "spending_vs_income", "spend", "Spending vs. income", score, reason, metric(
        f"{prefix}.spending_vs_income", "Spending vs. income", round_half_up(ratio, 1), "pct", pct(ratio),
        "12-month spending ÷ 12-month take-home pay",
        [("Monthly spending (12-month average)", round(s.spending_monthly, 2), "usd_per_month", "Spend and card"),
         ("Monthly take-home pay (12-month average)", round(th, 2), "usd_per_month", "Paychecks")],
        ["Spending excludes transfers between your own accounts.", LINEAR], (85, 100, "pct"))))

    # 2. Bills paid on time
    score = linear_score(s.late_payments_12m, 0, 2)
    reason = ("No late or missed payments in the last 12 months." if s.late_payments_12m == 0
              else f"{s.late_payments_12m} late or missed payment{'s' if s.late_payments_12m > 1 else ''} "
                   "in the last 12 months.")
    out.append(_indicator(2, "bills_on_time", "spend", "Bills paid on time", score, reason, metric(
        f"{prefix}.bills_on_time", "Bills paid on time", s.late_payments_12m, "count",
        f"{s.late_payments_12m} late", "Late or missed payments in the last 12 months",
        [("Late or missed payments", s.late_payments_12m, "count", "Late fees on your accounts")],
        [LINEAR], (0, 2, "count"))))

    # 3. Savings cushion
    liquid = s.checking + s.savings
    cushion = liquid / s.spending_monthly if s.spending_monthly else 99.0
    score = linear_score(cushion, 3, 0.5)
    if cushion < 1.25:
        reason = "Your checking and savings would cover about one month of spending."
    elif cushion < 3:
        reason = f"Your checking and savings would cover about {round_half_up(cushion, 1):.1f} months of spending."
    else:
        reason = f"You have {round_half_up(cushion, 1):.1f} months of spending set aside. 3 or more is healthy."
    out.append(_indicator(3, "savings_cushion", "save", "Savings cushion", score, reason, metric(
        f"{prefix}.savings_cushion", "Savings cushion", round_half_up(cushion, 2), "months", months(cushion),
        "(Checking + savings) ÷ monthly spending",
        [("Checking", round(s.checking, 2), "usd"), ("Savings", round(s.savings, 2), "usd"),
         ("Monthly spending", round(s.spending_monthly, 2), "usd_per_month")],
        ["CDs and retirement accounts are not counted: they're not instantly available.", LINEAR],
        (3, 0.5, "months"))))

    # 4. Long-term saving
    lts = 100 * s.retirement_contrib_monthly / th if th else 0.0
    score = linear_score(lts, 10, 0)
    reason = (f"About {pct(lts, 1)} of your pay goes to retirement. 10% is the healthy mark." if lts < 10
              else f"{pct(lts, 1)} of your pay goes to retirement, at or above the 10% mark.")
    out.append(_indicator(4, "long_term_saving", "save", "Long-term saving", score, reason, metric(
        f"{prefix}.long_term_saving", "Long-term saving", round_half_up(lts, 1), "pct", pct(lts, 1),
        "Monthly retirement contributions ÷ take-home pay",
        [("Retirement contributions", round(s.retirement_contrib_monthly, 2), "usd_per_month", "IRA deposits"),
         ("Monthly take-home pay", round(th, 2), "usd_per_month")],
        [LINEAR], (10, 0, "pct"))))

    # 5. Debt load
    payments = sum(p for _, p in s.debt_payments)
    load = 100 * payments / th if th else 999.0
    score = linear_score(load, 10, 30)
    reason = (f"Your debt payments take {pct(load)} of your pay, which is manageable." if load <= 20
              else f"Your debt payments take {pct(load)} of your pay. Under 10% is the healthy mark.")
    out.append(_indicator(5, "debt_load", "borrow", "Debt load", score, reason, metric(
        f"{prefix}.debt_load", "Debt load", round_half_up(load, 1), "pct", pct(load),
        "Monthly minimum debt payments ÷ take-home pay",
        [*[(f"{name} minimum", p, "usd_per_month") for name, p in s.debt_payments],
         ("Monthly take-home pay", round(th, 2), "usd_per_month")],
        [LINEAR], (10, 30, "pct"))))

    # 6. Credit health
    util = 100 * s.card_balance / s.card_limit if s.card_limit else 0.0
    score = linear_score(util, 30, 90)
    reason = (f"Your card is at {pct(util)} of its limit. Under 30% is healthy." if util > 30
              else f"Your card use is {pct(util)} of its limit, under the 30% mark.")
    out.append(_indicator(6, "credit_health", "borrow", "Credit health", score, reason, metric(
        f"{prefix}.credit_health", "Credit health", round_half_up(util, 1), "pct", pct(util),
        "Card balances ÷ card limits",
        [("Card balances", round(s.card_balance, 2), "usd"), ("Card limits", round(s.card_limit, 2), "usd")],
        [LINEAR], (30, 90, "pct"))))

    # 7. Insurance
    ins = s.insurance
    have = {"Health": ins.health, "Auto": ins.auto, "Renters or home": ins.renters_or_home,
            "Disability": ins.disability}
    count = sum(have.values())
    score = linear_score(count, 4, 0)
    missing = [k.lower() for k, v in have.items() if not v]
    reason = ("You have all four key types of insurance." if not missing
              else f"You have {count} of the 4 key insurance types. Missing: {', '.join(missing)}.")
    out.append(_indicator(7, "insurance", "plan", "Insurance", score, reason, metric(
        f"{prefix}.insurance", "Insurance", count, "count", f"{count} of 4",
        "How many of the 4 key insurance types you have (from your setup answers)",
        [(k, "yes" if v else "no", "count", "Setup answer") for k, v in have.items()],
        [LINEAR], (4, 0, "count"))))

    # 8. Planning ahead
    base = {"yes": 80, "sometimes": 40, "no": 0}[s.planning_ahead]
    bonus = 20 if s.automatic_saving else 0
    score = min(100, base + bonus)
    answer = s.planning_ahead.capitalize()
    reason = {
        "yes": "You plan ahead",
        "sometimes": "You plan ahead sometimes",
        "no": "You don't usually plan ahead",
    }[s.planning_ahead] + (", and some of your saving is automatic." if bonus else ", and none of your saving is automatic yet.")
    out.append(_indicator(8, "planning_ahead", "plan", "Planning ahead", score, reason, metric(
        f"{prefix}.planning_ahead", "Planning ahead", s.planning_ahead, "score", answer,
        "Setup answer (yes 80, sometimes 40, no 0) plus 20 for any automatic saving, capped at 100",
        [("Setup answer", s.planning_ahead, "score", "Setup question"),
         ("Automatic saving", "; ".join(s.automatic_saving) or "none", "score")],
        [], (100, 0, "score"))))

    return out


PILLARS: list[tuple[PillarId, str]] = [("spend", "Spend"), ("save", "Save"), ("borrow", "Borrow"), ("plan", "Plan")]


def score_state(s: FinancialState, as_of: date, prefix: str = "health") -> HealthResponse:
    inds = indicators(s, prefix)
    pillars: list[Pillar] = []
    for pid, label in PILLARS:
        members = [i for i in inds if i.pillar == pid]
        ps = int(round_half_up(sum(i.score for i in members) / len(members)))
        pillars.append(Pillar(
            id=pid, label=label, indicator_ids=[i.id for i in members],
            score=metric(f"{prefix}.pillar.{pid}", label, ps, "score", str(ps),
                         "Average of its two indicators, rounded half up",
                         [(i.label, i.score, "score") for i in members]),
        ))
    total = int(round_half_up(sum(int(p.score.value) for p in pillars) / 4))
    band = band_of(total)
    return HealthResponse(
        as_of=as_of, band=band, pillars=pillars, indicators=inds,
        score=metric(f"{prefix}.score", "Financial Health Score", total, "score", str(total),
                     "Average of the four pillars (Spend, Save, Borrow, Plan), rounded half up",
                     [(p.label, p.score.value, "score") for p in pillars],
                     ["Aligned with the Financial Health Network's Spend, Save, Borrow, Plan framework.",
                      "Computed from account data instead of survey questions.",
                      "Bands: 0-39 vulnerable, 40-79 coping, 80-100 healthy."]),
    )


def health_for(data: CustomerData, today: date) -> HealthResponse:
    h = score_state(state_from_data(data, today), today)
    if data.assumptions or data.indicator_notes:  # a connected bank: list where the data came from and every default
        h.score.math.assumptions += data.assumptions
        for ind in h.indicators:
            ind.value.math.assumptions += data.indicator_notes.get(ind.id, [])
    return h


__all__ = ["FinancialState", "health_for", "linear_score", "score_state", "state_from_data", "usd"]
