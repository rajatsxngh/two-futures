"""API contract for Future You.

Every lane (engine, screens, voice) builds against these shapes. Change them
only on purpose, then re-run `npm run gen:types` so the front end follows.

Two rules shape this file:
1. Every number a user can see is a `Metric`, which carries its own `Math`
   ("show the math", F9) and a stable `id` the voice agent can point at
   (`highlight_metric`, F11).
2. All money is in today's US dollars. Dates are ISO `YYYY-MM-DD`; months are
   `YYYY-MM`.
"""

from __future__ import annotations

import datetime as dt
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------

Unit = Literal["usd", "usd_per_month", "pct", "months", "score", "count", "date", "years"]


class MathInput(BaseModel):
    label: str = Field(description="Plain-words name, e.g. 'Checking and savings'")
    value: float | str
    unit: Unit
    source: str | None = Field(default=None, description="Where it came from, e.g. 'Spend account balance'")


class Thresholds(BaseModel):
    best: float = Field(description="Value that scores 100")
    worst: float = Field(description="Value that scores 0")
    unit: Unit


class Math(BaseModel):
    """Everything 'show the math' needs to explain one number."""

    formula: str = Field(description="The formula in plain words")
    inputs: list[MathInput] = []
    assumptions: list[str] = []
    thresholds: Thresholds | None = None


class Metric(BaseModel):
    """One on-screen number."""

    id: str = Field(description="Stable id, e.g. 'today.cushion_months' or 'plan.2031.ira'")
    label: str = Field(description="Plain words, e.g. 'Savings cushion'")
    value: float | str | None
    unit: Unit
    display: str = Field(description="Pre-formatted text, e.g. '1.0 months' or '$4,210'")
    math: Math


# ---------------------------------------------------------------------------
# Customers, accounts, transactions, bills
# ---------------------------------------------------------------------------

class AccountType(str, Enum):
    checking = "checking"
    savings = "savings"
    cd = "cd"
    ira = "ira"
    auto_loan = "auto_loan"
    personal_loan = "personal_loan"
    credit_card = "credit_card"
    mortgage = "mortgage"


class AccountGroup(str, Enum):
    cash = "cash"
    savings_cds = "savings_cds"
    retirement = "retirement"
    debt = "debt"


ACCOUNT_GROUP_OF: dict[AccountType, AccountGroup] = {
    AccountType.checking: AccountGroup.cash,
    AccountType.savings: AccountGroup.savings_cds,
    AccountType.cd: AccountGroup.savings_cds,
    AccountType.ira: AccountGroup.retirement,
    AccountType.auto_loan: AccountGroup.debt,
    AccountType.personal_loan: AccountGroup.debt,
    AccountType.credit_card: AccountGroup.debt,
    AccountType.mortgage: AccountGroup.debt,
}


class InsuranceAnswers(BaseModel):
    health: bool
    auto: bool
    renters_or_home: bool
    disability: bool


class SetupAnswers(BaseModel):
    insurance: InsuranceAnswers
    planning_ahead: Literal["yes", "sometimes", "no"]


class Customer(BaseModel):
    id: str
    name: str
    age: int
    city: str
    state: str
    occupation: str
    pay_schedule: Literal["weekly", "biweekly", "semimonthly", "monthly"]
    take_home_per_paycheck: float
    next_payday: dt.date
    setup: SetupAnswers


class Account(BaseModel):
    id: str
    type: AccountType
    group: AccountGroup
    name: str = Field(description="PNC-style name, e.g. 'Spend' (Virtual Wallet checking)")
    institution: str
    balance: float = Field(description="Debts are positive amounts owed")
    rate: float | None = Field(default=None, description="APY for deposits, APR for debts, in percent")
    limit: float | None = Field(default=None, description="Credit limit (cards)")
    min_payment: float | None = None
    due_day: int | None = Field(default=None, ge=1, le=31)
    maturity_date: dt.date | None = None
    original_amount: float | None = None
    term_months: int | None = None
    monthly_contribution: float | None = Field(default=None, description="Automatic monthly deposit (IRA, savings)")


class Transaction(BaseModel):
    id: str
    date: dt.date
    amount: float = Field(description="Negative = money out, positive = money in")
    merchant: str
    category: str
    account_id: str
    recurring: bool


class DueRule(BaseModel):
    kind: Literal["monthly", "yearly", "once"]
    day: int | None = Field(default=None, description="Day of month (monthly)")
    date: dt.date | None = Field(default=None, description="Date (yearly uses its month/day; once uses it exactly)")


class Bill(BaseModel):
    id: str
    name: str
    amount: float
    category: str
    due_rule: DueRule
    account_id: str
    unused: bool = Field(default=False, description="Subscription with no recent use (plan rule 3 cancels it)")


class UpcomingBill(BaseModel):
    bill_id: str
    name: str
    amount: float
    date: dt.date
    account_id: str
    kind: Literal["bill", "income", "maturity"] = "bill"


# ---------------------------------------------------------------------------
# GET /api/profile
# ---------------------------------------------------------------------------

class AccountGroupSummary(BaseModel):
    group: AccountGroup
    label: str
    total: Metric
    account_ids: list[str]


class ProfileResponse(BaseModel):
    as_of: dt.date
    customer: Customer
    accounts: list[Account]
    groups: list[AccountGroupSummary]
    summary: list[str] = Field(description="Exactly two plain sentences for the top of Today")
    bills: list[Bill] = Field(description="Every recurring and one-time bill, with its due rule")
    bills_next_90: list[UpcomingBill]
    totals: list[Metric] = Field(description="e.g. net worth, total cash, total debt")
    account_metrics: list[Metric] = Field(default=[], description="Each account balance as a Metric, id 'account.<id>.balance'")


# ---------------------------------------------------------------------------
# GET /api/health
# ---------------------------------------------------------------------------

PillarId = Literal["spend", "save", "borrow", "plan"]
Band = Literal["vulnerable", "coping", "healthy"]
Status = Literal["red", "amber", "green"]


class Indicator(BaseModel):
    id: str = Field(description="e.g. 'credit_health'")
    number: int = Field(ge=1, le=8)
    pillar: PillarId
    label: str
    value: Metric = Field(description="The measured value, e.g. 78% card use")
    score: int = Field(ge=0, le=100)
    status: Status
    reason: str = Field(description="One plain sentence on why")


class Pillar(BaseModel):
    id: PillarId
    label: str
    score: Metric
    indicator_ids: list[str]


class HealthResponse(BaseModel):
    as_of: dt.date
    score: Metric
    band: Band
    pillars: list[Pillar]
    indicators: list[Indicator]


# ---------------------------------------------------------------------------
# GET /api/forecast
# ---------------------------------------------------------------------------

class ForecastPoint(BaseModel):
    date: dt.date
    p10: float = Field(description="Bad case")
    p50: float = Field(description="Typical")
    p90: float = Field(description="Good case")


class ForecastMarker(BaseModel):
    date: dt.date
    label: str
    kind: Literal["rent", "car", "card", "cd", "insurance", "payday", "subscription", "other"]
    amount: float | None = None


class AccountMonthPoint(BaseModel):
    month: str = Field(description="YYYY-MM")
    balance: float


class AccountForecast(BaseModel):
    account_id: str
    name: str
    type: AccountType
    points: list[AccountMonthPoint]
    end: Metric | None = Field(default=None, description="Typical balance in 12 months, id 'forecast.account.<id>.end'")


class ForecastResponse(BaseModel):
    as_of: dt.date
    runs: int
    seed: int
    cash_series: list[ForecastPoint] = Field(description="Daily checking balance band for 12 months")
    accounts: list[AccountForecast]
    markers: list[ForecastMarker]
    bills_next_90: list[UpcomingBill]
    overdraft_risk_90d: Metric = Field(description="Chance checking drops below $0 in the next 90 days")
    risk_days: list[dt.date] = Field(description="Days where the bad case goes below $0")
    assumptions: list[str]
    label: str = "Forecast, not a promise"
    headline: list[Metric] = Field(default=[], description="Typical balance in a year and its range")


# ---------------------------------------------------------------------------
# GET /api/futures
# ---------------------------------------------------------------------------

PathId = Literal["same_path", "plan"]


class LifeEvent(BaseModel):
    date: dt.date
    title: str
    description: str
    amount: float | None = None
    shared: bool = Field(description="True when the same event hits both paths (e.g. the 2028 car repair)")


class YearSnapshot(BaseModel):
    year: int
    age: int
    balances: dict[str, float] = Field(description="account_id -> balance at year end")
    cushion_months: float
    card_debt: float
    ira_balance: float
    net_worth: float
    score: int
    band: Band
    indicator_scores: dict[str, int]


class PathResult(BaseModel):
    path: PathId
    label: str
    key_numbers: list[Metric] = Field(description="2031: cushion, card debt, car paid off, IRA")
    snapshots: list[YearSnapshot]
    payoff_dates: dict[str, dt.date | None]
    events: list[LifeEvent]


class PlanAction(BaseModel):
    id: str
    rule: int = Field(ge=1, le=6)
    title: str
    description: str
    start_date: dt.date
    amount: float | None = None
    frequency: Literal["payday", "monthly", "once"] | None = None
    from_account_id: str | None = None
    to_account_id: str | None = None
    automatable: bool


class Plan(BaseModel):
    actions: list[PlanAction]


class NextStep(BaseModel):
    action_id: str
    title: str
    amount: float
    from_account_id: str
    to_account_id: str
    frequency: Literal["payday", "monthly"]
    first_date: dt.date
    effects: list[Metric] = Field(description="e.g. score change, cushion change by 2031")
    amount_metric: Metric | None = Field(default=None, description="The amount with why it's that amount, id 'next_step.amount'")


class FactSheet(BaseModel):
    path: PathId
    today_facts: list[str]
    future_facts: list[str]
    plan_summary: str
    next_step: str
    opening_line: str
    text: str = Field(description="The whole sheet as one block, sent to the agent as a dynamic variable")


class FuturesResponse(BaseModel):
    as_of: dt.date
    target_year: int
    paths: dict[PathId, PathResult]
    plan: Plan
    next_step: NextStep
    fact_sheets: dict[PathId, FactSheet]
    assumptions: list[str]


# ---------------------------------------------------------------------------
# POST /api/update_plan
# ---------------------------------------------------------------------------

WhatIfPreset = Literal["new_job", "move", "big_purchase", "save_more", "job_loss", "buy_home", "custom"]


class HomePurchase(BaseModel):
    price: float
    down_payment: float
    rate: float = Field(description="Mortgage APR in percent")
    term_years: int = 30


class WhatIfRequest(BaseModel):
    customer: str = "maya"
    description: str = Field(description="The change in the user's own words")
    preset: WhatIfPreset = "custom"
    income_change_yearly: float | None = Field(default=None, description="Gross yearly change, e.g. 8000")
    spending_change_monthly: float | None = None
    savings_change_monthly: float | None = None
    one_time_cost: float | None = None
    job_loss_months: int | None = None
    home: HomePurchase | None = None
    start_month: str | None = Field(default=None, description="YYYY-MM; defaults to next month")


class UpdatePlanResponse(BaseModel):
    path: Literal["plan"] = "plan"
    result: PathResult
    deltas: list[Metric] = Field(description="Change vs. before this what-if, e.g. '+$11k by 2031'")
    sentence: str = Field(description="One ready-made sentence the agent can say")
    applied: list[WhatIfRequest] = Field(description="All what-ifs active on the plan path, in order")
    fact_sheet: FactSheet


# ---------------------------------------------------------------------------
# POST /api/start_transfer, POST /api/reset
# ---------------------------------------------------------------------------

class TransferRequest(BaseModel):
    customer: str = "maya"
    amount: float = Field(gt=0)
    from_account_id: str
    to_account_id: str
    frequency: Literal["payday", "monthly", "once"]
    confirmed: bool = Field(description="Must be true: nothing moves without a clear yes")


class TransferResponse(BaseModel):
    id: str
    status: Literal["scheduled"]
    amount: float
    from_account_id: str
    to_account_id: str
    frequency: Literal["payday", "monthly", "once"]
    first_date: dt.date
    sentence: str
    simulated: bool = True


class ResetResponse(BaseModel):
    ok: bool
    customer: str
