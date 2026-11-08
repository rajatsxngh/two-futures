"""The Today screen's data: accounts in groups, totals, bills, and a two-sentence summary (F1)."""

from __future__ import annotations

from datetime import date

from ..models import AccountGroup, AccountGroupSummary, AccountType, HealthResponse, ProfileResponse
from .calendar import upcoming
from .data import CustomerData
from .fmt import metric, round_half_up, usd
from .params import build_params
from .subscriptions import to_model

GROUP_LABELS = {
    AccountGroup.cash: "Cash",
    AccountGroup.savings_cds: "Savings and CDs",
    AccountGroup.retirement: "Retirement",
    AccountGroup.debt: "Debt",
}

# Second summary sentence: what's dragging the score down most.
DRAG = {
    "credit_health": "Your credit card is at {display} of its limit, and that's the biggest drag on your score.",
    "debt_load": "Debt payments take {display} of your pay, and that's the biggest drag on your score.",
    "long_term_saving": "Only {display} of your pay goes to retirement, and that's the biggest drag on your score.",
    "bills_on_time": "Late payments are the biggest drag on your score.",
    "insurance": "A gap in your insurance is the biggest drag on your score.",
    "planning_ahead": "Making some of your saving automatic would lift your score the most.",
}


def summary(health: HealthResponse) -> list[str]:
    by_id = {i.id: i for i in health.indicators}
    ratio = float(by_id["spending_vs_income"].value.value)
    cushion = float(by_id["savings_cushion"].value.value)

    if ratio >= 100:
        first = "You're spending more than you bring home each month."
    elif cushion < 1.25:
        first = "You're steady month to month, but you have about one month of backup."
    elif cushion < 3:
        first = f"You're steady month to month, with about {round_half_up(cushion, 1):.1f} months of backup."
    else:
        first = f"You're steady month to month, with a solid {round_half_up(cushion, 1):.1f}-month cushion."

    # the first sentence already covers spending and the cushion
    rest = [i for i in health.indicators if i.id in DRAG]
    weakest = min(rest, key=lambda i: (i.score, i.number))
    second = ("Everything else looks healthy." if weakest.score >= 80
              else DRAG[weakest.id].format(display=weakest.value.display))
    return [first, second]


def profile_for(data: CustomerData, health: HealthResponse, today: date) -> ProfileResponse:
    groups: list[AccountGroupSummary] = []
    for g, label in GROUP_LABELS.items():
        accs = [a for a in data.accounts if a.group == g]
        if not accs:
            continue
        total = sum(a.balance for a in accs)
        groups.append(AccountGroupSummary(
            group=g, label=label, account_ids=[a.id for a in accs],
            total=metric(f"today.group.{g.value}", label, round(total, 2), "usd", usd(total),
                         f"Sum of balances in {label.lower()}",
                         [(a.name, a.balance, "usd", a.institution) for a in accs]),
        ))

    assets = sum(a.balance for a in data.accounts if a.group != AccountGroup.debt)
    debts = sum(a.balance for a in data.accounts if a.group == AccountGroup.debt)
    checking = next((a.id for a in data.accounts if a.type == AccountType.checking), "spend")

    labels = {"checking": "Checking", "savings": "Savings", "cd": "CD", "ira": "Retirement",
              "auto_loan": "Auto loan", "personal_loan": "Personal loan", "credit_card": "Credit card",
              "mortgage": "Mortgage"}
    account_metrics = []
    for a in data.accounts:
        inputs = [("Institution", a.institution, "count")]
        if a.rate is not None:
            inputs.append(("APR" if a.group == AccountGroup.debt else "APY", a.rate, "pct"))
        if a.limit:
            inputs.append(("Credit limit", a.limit, "usd"))
        if a.min_payment:
            inputs.append(("Minimum payment", a.min_payment, "usd_per_month"))
        if a.due_day:
            inputs.append(("Due day", a.due_day, "count"))
        if a.maturity_date:
            inputs.append(("Matures", a.maturity_date.isoformat(), "date"))
        if a.monthly_contribution:
            inputs.append(("Automatic deposit", a.monthly_contribution, "usd_per_month"))
        owed = " owed" if a.group == AccountGroup.debt else ""
        account_metrics.append(metric(
            f"account.{a.id}.balance", a.name, a.balance, "usd", usd(a.balance),
            f"{labels[a.type.value]} balance{owed} as of {today:%B} {today.day}, {today.year}",
            inputs, data.account_notes.get(a.id, []) if data.source else
            ["Made-up demo data: no real accounts are connected."]))

    answers = data.customer.setup.subscriptions
    subscriptions = [to_model(sub, bill, answers) for sub, bill in build_params(data, today).subscriptions]

    return ProfileResponse(
        account_metrics=account_metrics,
        subscriptions=subscriptions,
        as_of=today,
        customer=data.customer,
        accounts=data.accounts,
        groups=groups,
        summary=summary(health),
        bills=data.bills,
        bills_next_90=upcoming(data.customer, data.bills, today, 90, deposit_account=checking),
        totals=[
            metric("today.net_worth", "Net worth", round(assets - debts, 2), "usd", usd(assets - debts),
                   "Everything you have minus everything you owe",
                   [("Assets", round(assets, 2), "usd"), ("Debts", round(debts, 2), "usd")]),
            metric("today.total_cash", "Cash and savings",
                   round(sum(a.balance for a in data.accounts if a.type in (AccountType.checking, AccountType.savings)), 2),
                   "usd", usd(sum(a.balance for a in data.accounts
                                  if a.type in (AccountType.checking, AccountType.savings))),
                   "Checking plus savings"),
            metric("today.total_debt", "Total debt", round(debts, 2), "usd", usd(debts), "Sum of all debt balances",
                   [(a.name, a.balance, "usd") for a in data.accounts if a.group == AccountGroup.debt]),
        ],
    )
