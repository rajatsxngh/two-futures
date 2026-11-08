"""Build the M1 fixture JSON that the stub endpoints serve.

Fixtures are *placeholder* data with the right shape, so the screens and the
voice agent can be built before the real engine exists (M2-M5). Numbers that
the PRD pins down (Maya's accounts, her 8 indicators and score of 55, the
$150 next step, the Austin what-if) match the PRD. Future-path numbers are
plausible stand-ins until M4 computes them.

Run:  uv run python scripts/make_fixtures.py
Every fixture is validated against app.models before it is written.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models as M  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "app" / "fixtures"
AS_OF = date(2026, 11, 8)
NEXT_PAYDAY = date(2026, 11, 13)
STUB_NOTE = "Placeholder data from fixtures (M1). The real engine replaces this in M2-M5."


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def usd(x: float, cents: bool = False) -> str:
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):,.2f}" if cents else f"{sign}${abs(x):,.0f}"


def metric(id, label, value, unit, display, formula, inputs=(), assumptions=(), thresholds=None):
    return M.Metric(
        id=id, label=label, value=value, unit=unit, display=display,
        math=M.Math(
            formula=formula,
            inputs=[M.MathInput(**i) for i in inputs],
            assumptions=list(assumptions),
            thresholds=M.Thresholds(**thresholds) if thresholds else None,
        ),
    )


def acct(**kw):
    t = M.AccountType(kw["type"])
    return M.Account(group=M.ACCOUNT_GROUP_OF[t], **kw)


def bill(id, name, amount, category, account_id, day=None, kind="monthly", on=None):
    return M.Bill(id=id, name=name, amount=amount, category=category, account_id=account_id,
                  due_rule=M.DueRule(kind=kind, day=day, date=on))


def upcoming(bills: list[M.Bill], paycheck: float, start: date, days: int = 90) -> list[M.UpcomingBill]:
    end = start + timedelta(days=days)
    out: list[M.UpcomingBill] = []
    d = start
    while d <= end:
        for b in bills:
            r = b.due_rule
            hit = (r.kind == "monthly" and r.day == d.day) or \
                  (r.kind == "yearly" and r.date and (r.date.month, r.date.day) == (d.month, d.day)) or \
                  (r.kind == "once" and r.date == d)
            if hit:
                out.append(M.UpcomingBill(bill_id=b.id, name=b.name, amount=b.amount, date=d,
                                          account_id=b.account_id,
                                          kind="maturity" if b.category == "cd_maturity" else "bill"))
        if (d - NEXT_PAYDAY).days % 14 == 0 and d >= NEXT_PAYDAY:
            out.append(M.UpcomingBill(bill_id="paycheck", name="Paycheck", amount=paycheck, date=d,
                                      account_id="spend", kind="income"))
        d += timedelta(days=1)
    return out


def dump(name: str, model: M.BaseModel) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json"
    # round-trip through the model class to prove the JSON validates
    data = json.loads(model.model_dump_json())
    type(model).model_validate(data)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(OUT.parents[1])}")


# ---------------------------------------------------------------------------
# Maya
# ---------------------------------------------------------------------------

TAKE_HOME_MONTH = 4200.0
PAYCHECK = round(TAKE_HOME_MONTH * 12 / 26, 2)  # 1938.46
MONTHLY_SPEND = 3906.0                            # 93% of take-home

maya = M.Customer(
    id="maya", name="Maya", age=27, city="Dallas", state="TX", occupation="Nurse",
    pay_schedule="biweekly", take_home_per_paycheck=PAYCHECK, next_payday=NEXT_PAYDAY,
    setup=M.SetupAnswers(
        insurance=M.InsuranceAnswers(health=True, auto=True, renters_or_home=True, disability=False),
        planning_ahead="sometimes",
    ),
)

maya_accounts = [
    acct(id="spend", type="checking", name="Spend", institution="PNC", balance=1556.0, rate=0.01),
    acct(id="reserve", type="savings", name="Reserve", institution="PNC", balance=2350.0, rate=0.03,
         monthly_contribution=200.0),
    acct(id="cd", type="cd", name="12-month CD", institution="PNC", balance=2000.0, rate=4.0,
         maturity_date=date(2027, 4, 15), term_months=12, original_amount=2000.0),
    acct(id="ira", type="ira", name="Roth IRA", institution="Bluebonnet Investments", balance=6800.0,
         monthly_contribution=100.0),
    acct(id="auto", type="auto_loan", name="Auto loan", institution="Lone Star Credit Union",
         balance=14000.0, rate=6.9, min_payment=387.0, due_day=5, original_amount=22000.0, term_months=60),
    acct(id="card", type="credit_card", name="Cash Rewards Visa", institution="PNC", balance=3900.0,
         rate=24.99, limit=5000.0, min_payment=117.0, due_day=22),
]

maya_bills = [
    bill("rent", "Rent", 1450.0, "housing", "spend", day=1),
    bill("gym", "Gym membership", 40.0, "subscription", "spend", day=3),
    bill("car", "Car payment", 387.0, "auto_loan", "spend", day=5),
    bill("stream1", "Streaming (video)", 15.99, "subscription", "spend", day=9),
    bill("insurance", "Car insurance", 142.0, "insurance", "spend", day=15),
    bill("phone", "Phone", 65.0, "utilities", "spend", day=18),
    bill("card_pay", "Credit card payment", 117.0, "credit_card", "spend", day=22),
    bill("stream2", "Streaming (music)", 11.99, "subscription", "spend", day=27),
    bill("renters", "Renters insurance", 168.0, "insurance", "spend", kind="yearly", on=date(2027, 1, 12)),
    bill("cd_maturity", "CD matures", 2080.0, "cd_maturity", "cd", kind="once", on=date(2027, 4, 15)),
]


def maya_profile() -> M.ProfileResponse:
    by_group: dict[M.AccountGroup, list[M.Account]] = {}
    for a in maya_accounts:
        by_group.setdefault(a.group, []).append(a)
    labels = {"cash": "Cash", "savings_cds": "Savings and CDs", "retirement": "Retirement", "debt": "Debt"}
    groups = [
        M.AccountGroupSummary(
            group=g, label=labels[g.value], account_ids=[a.id for a in accs],
            total=metric(f"today.group.{g.value}", labels[g.value], sum(a.balance for a in accs), "usd",
                         usd(sum(a.balance for a in accs)), f"Sum of balances in {labels[g.value].lower()}",
                         [{"label": a.name, "value": a.balance, "unit": "usd", "source": a.institution} for a in accs]),
        )
        for g, accs in by_group.items()
    ]
    assets = sum(a.balance for a in maya_accounts if a.group != M.AccountGroup.debt)
    debts = sum(a.balance for a in maya_accounts if a.group == M.AccountGroup.debt)
    return M.ProfileResponse(
        as_of=AS_OF, customer=maya, accounts=maya_accounts, groups=groups,
        summary=[
            "You're steady month to month, but you have about one month of backup.",
            "Your credit card is at 78% of its limit, and that's the biggest drag on your score.",
        ],
        bills=maya_bills,
        bills_next_90=upcoming(maya_bills, PAYCHECK, AS_OF),
        totals=[
            metric("today.net_worth", "Net worth", assets - debts, "usd", usd(assets - debts),
                   "Everything you have minus everything you owe",
                   [{"label": "Assets", "value": assets, "unit": "usd"},
                    {"label": "Debts", "value": debts, "unit": "usd"}]),
            metric("today.total_debt", "Total debt", debts, "usd", usd(debts), "Sum of all debt balances"),
        ],
    )


def indicator(n, id, pillar, label, value, unit, display, score, reason, formula, inputs, best, worst, t_unit):
    status = "green" if score >= 80 else "amber" if score >= 40 else "red"
    return M.Indicator(
        id=id, number=n, pillar=pillar, label=label, score=score, status=status, reason=reason,
        value=metric(f"health.{id}", label, value, unit, display, formula, inputs,
                     ["Scores move in a straight line between the two thresholds."],
                     {"best": best, "worst": worst, "unit": t_unit}),
    )


def maya_health() -> M.HealthResponse:
    inds = [
        indicator(1, "spending_vs_income", "spend", "Spending vs. income", 93.0, "pct", "93%", 47,
                  "You spend 93 cents of every dollar you bring home.",
                  "12-month spending ÷ take-home pay",
                  [{"label": "Monthly spending (12-month average)", "value": MONTHLY_SPEND, "unit": "usd_per_month"},
                   {"label": "Monthly take-home pay", "value": TAKE_HOME_MONTH, "unit": "usd_per_month"}],
                  85, 100, "pct"),
        indicator(2, "bills_on_time", "spend", "Bills paid on time", 0, "count", "0 late", 100,
                  "No late or missed payments in the last 12 months.",
                  "Late or missed payments in the last 12 months",
                  [{"label": "Late or missed payments", "value": 0, "unit": "count"}], 0, 2, "count"),
        indicator(3, "savings_cushion", "save", "Savings cushion", 1.0, "months", "1.0 months", 20,
                  "Your checking and savings would cover about one month of spending.",
                  "(Checking + savings) ÷ monthly spending",
                  [{"label": "Spend (checking)", "value": 1556.0, "unit": "usd"},
                   {"label": "Reserve (savings)", "value": 2350.0, "unit": "usd"},
                   {"label": "Monthly spending", "value": MONTHLY_SPEND, "unit": "usd_per_month"}],
                  3, 0.5, "months"),
        indicator(4, "long_term_saving", "save", "Long-term saving", 2.4, "pct", "2.4%", 24,
                  "About 2% of your pay goes to retirement. 10% is the healthy mark.",
                  "Monthly retirement contributions ÷ take-home pay",
                  [{"label": "IRA contribution", "value": 100.0, "unit": "usd_per_month"},
                   {"label": "Monthly take-home pay", "value": TAKE_HOME_MONTH, "unit": "usd_per_month"}],
                  10, 0, "pct"),
        indicator(5, "debt_load", "borrow", "Debt load", 12.0, "pct", "12%", 90,
                  "Your debt payments take 12% of your pay, which is manageable.",
                  "Monthly debt payments ÷ take-home pay",
                  [{"label": "Car payment", "value": 387.0, "unit": "usd_per_month"},
                   {"label": "Card minimum", "value": 117.0, "unit": "usd_per_month"},
                   {"label": "Monthly take-home pay", "value": TAKE_HOME_MONTH, "unit": "usd_per_month"}],
                  10, 30, "pct"),
        indicator(6, "credit_health", "borrow", "Credit health", 78.0, "pct", "78%", 20,
                  "Your card is at 78% of its limit. Under 30% is healthy.",
                  "Card balances ÷ card limits",
                  [{"label": "Card balance", "value": 3900.0, "unit": "usd"},
                   {"label": "Card limit", "value": 5000.0, "unit": "usd"}],
                  30, 90, "pct"),
        indicator(7, "insurance", "plan", "Insurance", 3, "count", "3 of 4", 75,
                  "You have health, auto and renters insurance, but no disability cover.",
                  "Number of the 4 key insurance types you have (setup answers)",
                  [{"label": "Health", "value": "yes", "unit": "count"},
                   {"label": "Auto", "value": "yes", "unit": "count"},
                   {"label": "Renters or home", "value": "yes", "unit": "count"},
                   {"label": "Disability", "value": "no", "unit": "count"}],
                  4, 0, "count"),
        indicator(8, "planning_ahead", "plan", "Planning ahead", "sometimes", "score", "Sometimes", 60,
                  "You plan ahead sometimes, and your IRA deposit is automatic.",
                  "Setup answer about planning ahead, plus credit for any automatic saving",
                  [{"label": "Setup answer", "value": "sometimes", "unit": "score"},
                   {"label": "Automatic saving", "value": "IRA $100/month", "unit": "usd_per_month"}],
                  100, 0, "score"),
    ]
    pillar_defs = [("spend", "Spend", 74), ("save", "Save", 22), ("borrow", "Borrow", 55), ("plan", "Plan", 68)]
    pillars = []
    for pid, label, s in pillar_defs:
        members = [i for i in inds if i.pillar == pid]
        pillars.append(M.Pillar(
            id=pid, label=label, indicator_ids=[i.id for i in members],
            score=metric(f"health.pillar.{pid}", label, s, "score", str(s),
                         "Average of its two indicators, rounded half up",
                         [{"label": i.label, "value": i.score, "unit": "score"} for i in members]),
        ))
    return M.HealthResponse(
        as_of=AS_OF, band="coping", pillars=pillars, indicators=inds,
        score=metric("health.score", "Financial Health Score", 55, "score", "55",
                     "Average of the four pillars (Spend, Save, Borrow, Plan), rounded half up",
                     [{"label": p.label, "value": p.score.value, "unit": "score"} for p in pillars],
                     ["Aligned with the Financial Health Network's Spend, Save, Borrow, Plan framework.",
                      "Bands: 0-39 vulnerable, 40-79 coping, 80-100 healthy."]),
    )


def maya_forecast() -> M.ForecastResponse:
    series = []
    for i in range(366):
        d = AS_OF + timedelta(days=i)
        days_since_pay = (d - NEXT_PAYDAY).days % 14
        typical = 1556 + 120 * (i / 365) + 900 * (1 - days_since_pay / 14) - 450
        spread = 150 + 900 * math.sqrt(i / 365)
        series.append(M.ForecastPoint(date=d, p10=round(typical - spread, 2), p50=round(typical, 2),
                                      p90=round(typical + spread * 0.8, 2)))
    months = [(AS_OF.replace(day=1) + timedelta(days=32 * k)).strftime("%Y-%m") for k in range(13)]
    trend = {"spend": (1556, 10), "reserve": (2350, 200), "cd": (2000, 0), "ira": (6800, 128),
             "auto": (14000, -307), "card": (3900, -40)}
    accounts = [
        M.AccountForecast(account_id=a.id, name=a.name, type=a.type,
                          points=[M.AccountMonthPoint(month=m, balance=round(trend[a.id][0] + trend[a.id][1] * k, 2))
                                  for k, m in enumerate(months)])
        for a in maya_accounts
    ]
    bills90 = upcoming(maya_bills, PAYCHECK, AS_OF)
    kind_of = {"rent": "rent", "car": "car", "card_pay": "card", "insurance": "insurance", "cd_maturity": "cd",
               "paycheck": "payday"}
    markers = [M.ForecastMarker(date=b.date, label=b.name, kind=kind_of.get(b.bill_id, "subscription"), amount=b.amount)
               for b in upcoming(maya_bills, PAYCHECK, AS_OF, 365) if b.bill_id in kind_of and b.bill_id != "paycheck"]
    return M.ForecastResponse(
        as_of=AS_OF, runs=1000, seed=42, cash_series=series, accounts=accounts, markers=markers,
        bills_next_90=bills90, risk_days=[p.date for p in series[:90] if p.p10 < 0],
        overdraft_risk_90d=metric("forecast.overdraft_risk_90d", "Chance of dipping below $0 (90 days)", 8.0, "pct",
                                  "8%", "Share of 1,000 simulated runs where Spend drops below $0 in the next 90 days",
                                  [{"label": "Simulated runs", "value": 1000, "unit": "count"},
                                   {"label": "Runs below $0", "value": 80, "unit": "count"}]),
        assumptions=[STUB_NOTE,
                     "Each month has a 10% chance of a surprise bill between $300 and $2,000.",
                     "Everyday spending varies around its 12-month average by as much as it has in the past.",
                     "The line is the typical (middle) result; the band runs from the 10th to the 90th percentile."],
    )


def path_snapshots(path: str) -> list[M.YearSnapshot]:
    rows = {
        "same_path": [  # year, cushion, card, ira, auto, score
            (2026, 1.0, 3900, 6800, 14000, 55), (2027, 1.1, 3600, 8100, 10200, 56), (2028, 0.6, 4900, 9500, 6200, 50),
            (2029, 0.7, 4700, 11000, 2100, 52), (2030, 0.8, 4600, 12400, 0, 54), (2031, 0.6, 4800, 13900, 0, 52)],
        "plan": [
            (2026, 1.0, 3900, 6800, 14000, 55), (2027, 2.4, 0, 8100, 9100, 70), (2028, 2.9, 0, 9500, 0, 76),
            (2029, 4.3, 0, 12300, 0, 80), (2030, 5.6, 0, 16800, 0, 82), (2031, 6.0, 0, 22400, 0, 84)],
    }[path]
    out = []
    for year, cushion, card, ira, auto, score in rows:
        cash = round(cushion * MONTHLY_SPEND)
        out.append(M.YearSnapshot(
            year=year, age=27 + (year - 2026), cushion_months=cushion, card_debt=card, ira_balance=ira,
            balances={"spend": round(cash * 0.4), "reserve": round(cash * 0.6), "ira": ira, "auto": auto, "card": card},
            net_worth=round(cash + ira - auto - card), score=score,
            band="healthy" if score >= 80 else "coping" if score >= 40 else "vulnerable",
            indicator_scores={},
        ))
    return out


def key_numbers(path: str, cushion: float, card: float, car_off: str, ira: float) -> list[M.Metric]:
    p = f"{path}.2031"
    note = [STUB_NOTE, "All numbers in today's dollars."]
    return [
        metric(f"{p}.cushion_months", "Savings cushion", cushion, "months", f"{cushion:.1f} months",
               "(Checking + savings) ÷ monthly spending, in 2031", assumptions=note),
        metric(f"{p}.card_debt", "Card debt", card, "usd", usd(card), "Credit card balance at the end of 2031",
               assumptions=note),
        metric(f"{p}.car_paid_off", "Car paid off", car_off, "date",
               date.fromisoformat(car_off).strftime("%b %Y"), "Month the auto loan balance reaches $0",
               assumptions=note),
        metric(f"{p}.ira", "IRA", ira, "usd", usd(ira), "IRA balance at the end of 2031",
               assumptions=note + ["IRA growth 5% a year (typical case)."]),
    ]


REPAIR = M.LifeEvent(date=date(2028, 3, 14), title="Car repair", amount=2000,
                     description="The transmission needs work: $2,000.", shared=True)


def maya_futures() -> M.FuturesResponse:
    same = M.PathResult(
        path="same_path", label="Same path", snapshots=path_snapshots("same_path"),
        key_numbers=key_numbers("same_path", 0.6, 4800, "2030-06-05", 13900),
        payoff_dates={"auto": date(2030, 6, 5), "card": None},
        events=[REPAIR,
                M.LifeEvent(date=date(2028, 3, 14), title="Repair goes on the card", amount=2000, shared=False,
                            description="With about one month of backup, the repair lands on the credit card."),
                M.LifeEvent(date=date(2030, 6, 5), title="Car paid off", shared=False,
                            description="The last car payment, on schedule.")],
    )
    plan = M.PathResult(
        path="plan", label="With a plan", snapshots=path_snapshots("plan"),
        key_numbers=key_numbers("plan", 6.0, 0, "2028-09-05", 22400),
        payoff_dates={"auto": date(2028, 9, 5), "card": date(2027, 10, 22)},
        events=[REPAIR,
                M.LifeEvent(date=date(2027, 4, 15), title="CD matures", amount=2080, shared=False,
                            description="Half goes to the card, half to savings."),
                M.LifeEvent(date=date(2027, 10, 22), title="Card paid off", shared=False,
                            description="The card balance hits $0."),
                M.LifeEvent(date=date(2028, 3, 14), title="Repair paid from savings", amount=2000, shared=False,
                            description="The cushion covers it, and the card stays at $0."),
                M.LifeEvent(date=date(2028, 9, 5), title="Car paid off early", shared=False,
                            description="Paid off 21 months early. That payment becomes savings.")],
    )
    actions = [
        M.PlanAction(id="auto_transfer", rule=1, title="Move $150 from Spend to Reserve every payday",
                     description="Builds the cushion toward 3 months. $150 is the largest $25 step that keeps "
                                 "bad-case checking above $200.",
                     start_date=NEXT_PAYDAY, amount=150, frequency="payday", from_account_id="spend",
                     to_account_id="reserve", automatable=True),
        M.PlanAction(id="windfall_split", rule=2, title="Split the CD between the card and savings",
                     description="When the CD matures in April 2027, half goes to the card and half to Reserve.",
                     start_date=date(2027, 4, 15), amount=2080, frequency="once", from_account_id="cd",
                     automatable=False),
        M.PlanAction(id="cancel_gym", rule=3, title="Cancel the unused gym membership",
                     description="No gym visits in 4 months. Saves $40 a month.", start_date=date(2026, 12, 1),
                     amount=40, frequency="monthly", automatable=False),
        M.PlanAction(id="snowball_car", rule=4, title="Card paid off: put its payment plus $200 toward the car",
                     description="Once the card is at $0, $317 a month extra goes to the auto loan.",
                     start_date=date(2027, 11, 1), amount=317, frequency="monthly", from_account_id="spend",
                     to_account_id="auto", automatable=False),
        M.PlanAction(id="fill_cushion_then_ira", rule=5, title="Debts gone: fill savings to 6 months, then the IRA",
                     description="Freed-up money builds a 6-month cushion, then goes to the IRA.",
                     start_date=date(2028, 10, 1), frequency="monthly", automatable=False),
    ]
    next_step = M.NextStep(
        action_id="auto_transfer", title="Move $150 from Spend to savings every payday", amount=150,
        from_account_id="spend", to_account_id="reserve", frequency="payday", first_date=NEXT_PAYDAY,
        effects=[
            metric("next_step.score_2031", "Score in 2031", 84, "score", "84 vs 52",
                   "Plan-path 2031 score compared with the same-path 2031 score",
                   [{"label": "Plan path 2031", "value": 84, "unit": "score"},
                    {"label": "Same path 2031", "value": 52, "unit": "score"}], [STUB_NOTE]),
            metric("next_step.cushion_1y", "Cushion in a year", 2.4, "months", "2.4 months",
                   "Projected savings cushion in November 2027 with the transfer", assumptions=[STUB_NOTE]),
        ],
    )
    today_facts = [
        "Today is November 2026. You are Maya, 27, a nurse in Dallas.",
        "Take-home pay: $4,200 a month. Rent: $1,450. Car loan: $14,000 left. Credit card: $3,900 of $5,000 (78%).",
        "Savings cushion: about 1 month. Financial Health Score: 55 (coping).",
    ]
    same_facts = [
        "It's 2031. You're 32. You kept doing what you did in 2026.",
        "In March 2028 the car needed a $2,000 repair. It went on the card.",
        "Card debt in 2031: about $4,800. Cushion: about 0.6 months. Car paid off June 2030. IRA: about $13,900.",
        "Score in 2031: 52.",
    ]
    plan_facts = [
        "It's 2031. You're 32. In 2026 you started moving $150 to savings every payday.",
        "Card paid off October 2027. The same $2,000 repair in March 2028 came out of savings.",
        "Car paid off September 2028, 21 months early, and that payment became savings.",
        "Cushion in 2031: about 6 months. Card debt: $0. IRA: about $22,400. Score in 2031: 84.",
    ]

    def sheet(path, facts, opening):
        plan_summary = ("Move $150 from Spend to savings every payday; split the CD between card and savings; "
                        "cancel the unused gym; then snowball the card payment into the car loan.")
        nxt = "Move $150 from Spend to savings every payday, starting November 13, 2026."
        text = "\n".join(["TODAY (2026):", *today_facts, "", f"YOUR LIFE IN 2031 ({path}):", *facts, "",
                          f"PLAN: {plan_summary}", f"NEXT STEP: {nxt}"])
        return M.FactSheet(path=path, today_facts=today_facts, future_facts=facts, plan_summary=plan_summary,
                           next_step=nxt, opening_line=opening, text=text)

    return M.FuturesResponse(
        as_of=AS_OF, target_year=2031, paths={"same_path": same, "plan": plan},
        plan=M.Plan(actions=actions), next_step=next_step,
        fact_sheets={
            "same_path": sheet("same_path", same_facts,
                               "Hey... it's me. Well, it's you, five years from now. Honestly? Things are okay, "
                               "but that card never really went away."),
            "plan": sheet("plan", plan_facts,
                          "Hey... it's me. Well, it's you, five years from now. That little $150 habit? "
                          "It changed more than I expected."),
        },
        assumptions=[STUB_NOTE, "Both paths get the same random surprises, including the March 2028 car repair.",
                     "IRA growth: 5% typical, 2% bad, 8% good.", "All numbers in today's dollars."],
    )


def maya_update_plan(futures: M.FuturesResponse) -> M.UpdatePlanResponse:
    req = M.WhatIfRequest(description="What if I take the Austin job? $8,000 more a year, but rent is $300 higher.",
                          preset="new_job", income_change_yearly=8000, spending_change_monthly=300,
                          start_month="2027-01")
    plan = futures.paths["plan"].model_copy(deep=True)
    plan.key_numbers = key_numbers("plan", 7.8, 0, "2028-06-05", 23900)
    net = round(8000 * (1 - 0.22 - 0.0765) / 12 - 300)
    sentence = f"Taking the Austin job leaves about ${170} more a month after taxes and the higher rent."
    sheet = futures.fact_sheets["plan"].model_copy(deep=True)
    sheet.future_facts = sheet.future_facts + [f"What-if applied: {req.description} Result: {sentence}"]
    sheet.text = sheet.text + f"\nWHAT-IF APPLIED: {sentence}"
    return M.UpdatePlanResponse(
        result=plan, applied=[req], sentence=sentence, fact_sheet=sheet,
        deltas=[
            metric("whatif.monthly_change", "Monthly change", net, "usd_per_month", f"+{usd(net)}/mo",
                   "Yearly raise × (1 − 22% federal − 7.65% payroll) ÷ 12, minus the extra rent",
                   [{"label": "Yearly raise", "value": 8000, "unit": "usd"},
                    {"label": "Take-home share", "value": 70.35, "unit": "pct"},
                    {"label": "Extra rent", "value": 300, "unit": "usd_per_month"}],
                   ["No state income tax (Texas)."]),
            metric("whatif.cushion_2031", "Cushion in 2031", 1.8, "months", "+1.8 months",
                   "Change in the plan path's 2031 cushion", assumptions=[STUB_NOTE]),
            metric("whatif.net_worth_2031", "Net worth in 2031", 8400, "usd", "+$8.4k by 2031",
                   "Change in the plan path's 2031 net worth", assumptions=[STUB_NOTE]),
        ],
    )


def maya_transfer() -> M.TransferResponse:
    return M.TransferResponse(
        id="tr_demo_1", status="scheduled", amount=150, from_account_id="spend", to_account_id="reserve",
        frequency="payday", first_date=NEXT_PAYDAY,
        sentence=("Done. $150 moves from Spend to Reserve every payday, starting Friday, November 13. "
                  "This is a simulation: no real money moves."),
    )


# ---------------------------------------------------------------------------
# Jordan & Priya (household): only the profile in M1, to prove all 8 types fit
# ---------------------------------------------------------------------------

def household_profile() -> M.ProfileResponse:
    cust = M.Customer(
        id="household", name="Jordan and Priya", age=34, city="Plano", state="TX", occupation="Teacher and engineer",
        pay_schedule="semimonthly", take_home_per_paycheck=4100.0, next_payday=date(2026, 11, 15),
        setup=M.SetupAnswers(insurance=M.InsuranceAnswers(health=True, auto=True, renters_or_home=True,
                                                          disability=True), planning_ahead="yes"),
    )
    accts = [
        acct(id="spend", type="checking", name="Spend", institution="PNC", balance=5200.0, rate=0.01),
        acct(id="reserve", type="savings", name="Reserve", institution="PNC", balance=14800.0, rate=0.03),
        acct(id="cd", type="cd", name="18-month CD", institution="PNC", balance=10000.0, rate=4.1,
             maturity_date=date(2027, 9, 1), term_months=18),
        acct(id="ira", type="ira", name="Traditional IRA", institution="Bluebonnet Investments", balance=48200.0,
             monthly_contribution=500.0),
        acct(id="auto1", type="auto_loan", name="Auto loan (SUV)", institution="Lone Star Credit Union",
             balance=21500.0, rate=5.9, min_payment=520.0, due_day=10),
        acct(id="auto2", type="auto_loan", name="Auto loan (sedan)", institution="PNC", balance=6300.0, rate=4.9,
             min_payment=280.0, due_day=20),
        acct(id="personal", type="personal_loan", name="Personal loan", institution="PNC", balance=7800.0,
             rate=11.5, min_payment=260.0, due_day=12),
        acct(id="card", type="credit_card", name="Cash Rewards Visa", institution="PNC", balance=1900.0, rate=22.99,
             limit=12000.0, min_payment=57.0, due_day=25),
        acct(id="mortgage", type="mortgage", name="Mortgage", institution="PNC", balance=286000.0, rate=6.25,
             min_payment=2150.0, due_day=1, original_amount=300000.0, term_months=360),
    ]
    bills = [
        bill("mortgage", "Mortgage", 2150.0, "housing", "spend", day=1),
        bill("auto1", "SUV payment", 520.0, "auto_loan", "spend", day=10),
        bill("personal", "Personal loan", 260.0, "personal_loan", "spend", day=12),
        bill("auto2", "Sedan payment", 280.0, "auto_loan", "spend", day=20),
        bill("card_pay", "Credit card payment", 57.0, "credit_card", "spend", day=25),
    ]
    labels = {"cash": "Cash", "savings_cds": "Savings and CDs", "retirement": "Retirement", "debt": "Debt"}
    by_group: dict[M.AccountGroup, list[M.Account]] = {}
    for a in accts:
        by_group.setdefault(a.group, []).append(a)
    groups = [M.AccountGroupSummary(group=g, label=labels[g.value], account_ids=[a.id for a in v],
                                    total=metric(f"today.group.{g.value}", labels[g.value], sum(a.balance for a in v),
                                                 "usd", usd(sum(a.balance for a in v)),
                                                 f"Sum of balances in {labels[g.value].lower()}"))
              for g, v in by_group.items()]
    return M.ProfileResponse(
        as_of=AS_OF, customer=cust, accounts=accts, groups=groups,
        summary=["You have a solid four-month cushion and every bill is on time.",
                 "With the baby coming, the personal loan is the first thing worth clearing."],
        bills=bills, bills_next_90=upcoming(bills, 4100.0, AS_OF), totals=[],
    )


if __name__ == "__main__":
    futures = maya_futures()
    dump("maya_profile", maya_profile())
    dump("maya_health", maya_health())
    dump("maya_forecast", maya_forecast())
    dump("maya_futures", futures)
    dump("maya_update_plan", maya_update_plan(futures))
    dump("maya_start_transfer", maya_transfer())
    dump("household_profile", household_profile())
