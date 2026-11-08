"""The three things that change demo state: apply a what-if, schedule a transfer, reset (F6, F7, F8)."""

from __future__ import annotations

from datetime import date, timedelta

from ..models import (
    AccountType,
    HealthResponse,
    Metric,
    SetupAnswers,
    ShockPath,
    StopTransferRequest,
    ShockRequest,
    ShockResponse,
    ShockYear,
    TransferRequest,
    TransferResponse,
    UpdatePlanResponse,
    WhatIfRequest,
)
from . import assumptions as A
from . import state
from .data import CustomerData, load
import numpy as np

from .fmt import metric, round_half_up, usd
from .futures import futures_for
from .health import health_for
from .whatif import (TAKE_HOME_SHARE, WhatIfError, car_options, car_payment, home_breakdown, monthly_net, sentence,
                     start_index)

CHANGE_FIELDS = ("income_change_yearly", "spending_change_monthly", "savings_change_monthly", "one_time_cost",
                 "job_loss_months", "home", "car")


def _signed(x: float, fmt) -> str:
    return ("+" if x >= 0 else "-") + fmt(abs(x))


def _k(x: float) -> str:
    return f"${x / 1000:,.1f}k" if x >= 1000 else usd(x)


def apply_whatif(customer_id: str, req: WhatIfRequest, today: date) -> UpdatePlanResponse:
    if not any(getattr(req, f) for f in CHANGE_FIELDS):
        raise WhatIfError("A what-if needs at least one change (income, spending, savings, one-time cost, job loss, "
                          "a home or a car).")
    with state.LOCK:
        st = state.get(customer_id)
        before = futures_for(customer_id, today, st.whatifs, st.setup)
        trial = futures_for(customer_id, today, st.whatifs + [(req, "")], st.setup)
        b, a = before.response.paths["plan"], trial.response.paths["plan"]
        line = sentence(req, b, a, trial.sims["plan"].months, trial.sims["plan"], trial.params, before.sims["plan"])
        st.whatifs.append((req, line))
        after = futures_for(customer_id, today, st.whatifs, st.setup)
        applied = [w for w, _ in st.whatifs]

    year = after.response.target_year
    s0, s1 = b.snapshots[-1], after.response.paths["plan"].snapshots[-1]
    deltas: list[Metric] = []
    if req.car:
        c = req.car
        pay = car_payment(c)
        deltas.append(metric(
            "whatif.car_payment", "Car payment", round(pay, 2), "usd_per_month", f"{usd(pay)}/mo",
            "Loan × r ÷ (1 − (1 + r)^−months), where r = APR ÷ 12 and the loan = price − down payment",
            [("Car price", c.price, "usd"), ("Down payment", c.down, "usd"), ("Loan", round(c.price - c.down, 2), "usd"),
             ("APR", c.apr, "pct"), ("Loan length", c.term_months, "months")],
            ["The down payment comes out of savings first, then the card.", *A.car_listed()]))
    if req.home:
        total, parts = home_breakdown(req.home)
        deltas.append(metric(
            "whatif.home_cost", "Home cost", total, "usd_per_month", f"{usd(total)}/mo",
            "Loan payment + property tax + insurance + PMI (each rounded to the dollar). It replaces rent.",
            [("Loan payment (principal and interest)", parts["loan"], "usd_per_month"),
             ("Property tax", parts["tax"], "usd_per_month", f"{A.HOME_PROPERTY_TAX:.1%} of the price a year"),
             ("Homeowners insurance", parts["insurance"], "usd_per_month", f"{A.HOME_INSURANCE:.0%} of the price a year"),
             ("PMI", parts["pmi"], "usd_per_month", "under 20% down only")],
            A.home_listed()))
    if req.income_change_yearly or req.spending_change_monthly:
        net = monthly_net(req)
        inputs = []
        if req.income_change_yearly:
            inputs += [("Yearly pay change", req.income_change_yearly, "usd"),
                       ("Take-home share", round(TAKE_HOME_SHARE * 100, 2), "pct")]
        if req.spending_change_monthly:
            inputs.append(("Monthly spending change", req.spending_change_monthly, "usd_per_month"))
        deltas.append(metric(
            "whatif.monthly_change", "Monthly change", round(net, 2), "usd_per_month",
            f"{_signed(net, lambda v: usd(round_half_up(v)))}/mo",
            "Yearly pay change × (1 − 22% federal − 7.65% payroll) ÷ 12, minus the spending change", inputs,
            ["No state income tax (Texas)."]))
    dc = s1.cushion_months - s0.cushion_months
    deltas.append(metric(
        "whatif.cushion_2031", f"Cushion in {year}", round(dc, 2), "months",
        f"{_signed(dc, lambda v: f'{v:.1f}')} months" if abs(dc) >= 0.05 else "No change",
        f"Plan-path cushion at the end of {year}, after minus before this what-if",
        [("Before", s0.cushion_months, "months"), ("After", s1.cushion_months, "months")]))
    dn = s1.net_worth - s0.net_worth
    deltas.append(metric(
        "whatif.net_worth_2031", f"Net worth in {year}", round(dn, 2), "usd", f"{_signed(dn, _k)} by {year}",
        f"Plan-path net worth at the end of {year}, after minus before this what-if",
        [("Before", s0.net_worth, "usd"), ("After", s1.net_worth, "usd")]))
    ds = s1.score - s0.score
    deltas.append(metric(
        "whatif.score_2031", f"Score in {year}", ds, "score",
        f"{_signed(ds, lambda v: f'{v:.0f}')} points" if ds else "No change",
        f"Plan-path Financial Health Score in {year}, after minus before",
        [("Before", s0.score, "score"), ("After", s1.score, "score")]))

    return UpdatePlanResponse(result=after.response.paths["plan"], deltas=deltas, sentence=line, applied=applied,
                              fact_sheet=after.response.fact_sheets["plan"],
                              car_options=car_options(req.car) if req.car else [])


def current_futures(customer_id: str, today: date):
    st = state.get(customer_id)
    return futures_for(customer_id, today, st.whatifs, st.setup)


def customer_data(customer_id: str) -> CustomerData:
    """The customer's data with any changed setup answers applied."""
    data = load(customer_id)
    setup = state.get(customer_id).setup
    if setup is None:
        return data
    return data.model_copy(update={"customer": data.customer.model_copy(update={"setup": setup})})


def set_setup(customer_id: str, setup: SetupAnswers, today: date) -> HealthResponse:
    """Answer the setup questions: insurance and planning ahead (indicators 7 and 8) and, per detected subscription,
    whether it's still used (plan rule 3 cancels only the ones answered "no"). Futures re-run for the new answers."""
    with state.LOCK:
        if "subscriptions" not in setup.model_fields_set:  # an older client: keep the subscription answers
            current = state.get(customer_id).setup or load(customer_id).customer.setup
            setup = setup.model_copy(update={"subscriptions": current.subscriptions})
        state.get(customer_id).setup = setup
    return health_for(customer_data(customer_id), today)


def job_loss_shock(req: ShockRequest, today: date) -> ShockResponse:
    """How long each future's cushion would last with no pay. Changes nothing.

    Months of no pay that checking + savings cover is exactly the cushion in months
    (liquid money / monthly spending), read from each path at the start month.
    """
    bundle = current_futures(req.customer, today)
    months = bundle.sims["plan"].months
    start = req.start_month or f"{today.year + 2}-{today.month:02d}"
    i = start_index(months, WhatIfRequest(description="job loss", start_month=start))
    k = req.job_loss_months
    when = months[i]
    paths = {}
    for path, sim in bundle.sims.items():
        runway = float(np.median(sim.cushion[:, i]))
        spend = float(np.median(sim.spend_typical[:, i]))
        covered = min(k, runway)
        short = max(0.0, k - runway) * spend
        card = bundle.params.card
        room = (max(0.0, card.limit - float(np.median(sim.balances[card.id][:, i])))
                if card and card.limit else (short if card else 0.0))
        on_card = min(short, room)
        unpaid = short - on_card
        plural = "s" if k != 1 else ""
        cover_txt = (f"would cover all {k} month{plural}" if runway >= k else
                     f"would cover about {runway:.1f} of the {k} month{plural}")
        about = lambda x: usd(round_half_up(x / 100) * 100)  # noqa: E731
        if unpaid >= 50 and on_card >= 50:
            card_txt = (f", about {about(on_card)} would go on the card until it hits its {usd(card.limit)} limit, "
                        f"and about {about(unpaid)} of bills would go unpaid")
        elif unpaid >= 50:
            card_txt = (f", the card is already at its {usd(card.limit)} limit, "
                        f"and about {about(unpaid)} of bills would go unpaid")
        else:
            card_txt = "" if on_card < 50 else f", and about {about(on_card)} would go on the card"
        paths[path] = ShockPath(
            path=path, covered_months=round(covered, 2),
            runway=metric(f"shock.{path}.runway", "Months your savings cover", round(runway, 2), "months",
                          f"{runway:.1f} months",
                          f"(Checking + savings) ÷ monthly spending at the start of {when:%B %Y}",
                          [("Monthly spending then", round(spend, 2), "usd_per_month"),
                           ("Months without pay", k, "count")],
                          ["Spending carries on as usual while out of work.", "Typical (middle) simulated run."]),
            card=metric(f"shock.{path}.card", "On the card", round(on_card, 2), "usd", usd(on_card),
                        "Months not covered × monthly spending, up to the card's remaining limit",
                        [("Months not covered", round(max(0.0, k - runway), 2), "months"),
                         ("Monthly spending", round(spend, 2), "usd_per_month"),
                         ("Room left on the card", round(room, 2), "usd")]),
            unpaid=(metric(f"shock.{path}.unpaid", "Bills unpaid", round(unpaid, 2), "usd", usd(unpaid),
                           "What's left once savings and the card's limit are used up",
                           [("Not covered", round(short, 2), "usd"), ("On the card", round(on_card, 2), "usd")])
                    if unpaid >= 50 else None),
            sentence=f"Losing your income for {k} month{plural} in {when:%B %Y}: savings {cover_txt}{card_txt}.",
        )
    years = []
    for y in range(today.year + 1, bundle.response.target_year + 1):
        j = next((n for n, d in enumerate(months) if d.year == y and d.month == 1), None)
        if j is None:
            continue
        years.append(ShockYear(year=y,
                               same_path=round(float(np.median(bundle.sims["same_path"].cushion[:, j])), 2),
                               plan=round(float(np.median(bundle.sims["plan"].cushion[:, j])), 2)))
    return ShockResponse(job_loss_months=k, start_month=f"{when:%Y-%m}", paths=paths, by_year=years)


class TransferError(ValueError):
    pass


SIMULATED_NOTE = "This is a simulation: no real money moves."


def schedule_transfer(req: TransferRequest, today: date) -> TransferResponse:
    if req.confirmed is not True:
        raise TransferError("Transfer needs a clear yes (confirmed=true). Nothing moved.")
    # The model already checks these; repeated here so the engine is safe on its own.
    if not 0 < req.amount <= A.TRANSFER_MAX or req.amount % A.TRANSFER_STEP:
        raise TransferError(f"The amount must be a ${A.TRANSFER_STEP:,.0f} step between ${A.TRANSFER_STEP:,.0f} "
                            f"and ${A.TRANSFER_MAX:,.0f}. Nothing moved.")
    data = load(req.customer)
    ids = {a.id: a for a in data.accounts}
    for acc in (req.from_account_id, req.to_account_id):
        if acc not in ids:
            raise TransferError(f"Unknown account '{acc}'. Nothing moved.")
    if req.from_account_id == req.to_account_id:
        raise TransferError("From and to accounts must differ. Nothing moved.")
    # Same accounts the plan's next step uses (see params.build_params): the first checking and savings accounts.
    checking = next(a for a in data.accounts if a.type == AccountType.checking)
    savings = next((a for a in data.accounts if a.type == AccountType.savings), None)
    if savings is None or (req.from_account_id, req.to_account_id) != (checking.id, savings.id):
        raise TransferError(f"Transfers can only go from {checking.name} to "
                            f"{savings.name if savings else 'savings'}. Nothing moved.")
    src, dst = checking, savings

    if req.frequency == "payday":
        first = data.customer.next_payday
        while first <= today:
            first += timedelta(days=14)
        how = "every payday"
    elif req.frequency == "monthly":
        first = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        how = "every month"
    else:
        first = today + timedelta(days=1)
        how = "once"

    with state.LOCK:
        st = state.get(req.customer)
        for t in st.transfers:  # a retried "yes" shouldn't schedule twice
            if t.status == "scheduled" and (t.amount, t.from_account_id, t.to_account_id, t.frequency) == (
                    req.amount, req.from_account_id, req.to_account_id, req.frequency):
                return t
        when = f"{first.strftime('%A, %B')} {first.day}"
        resp = TransferResponse(
            id=f"tr_{req.customer}_{len(st.transfers) + 1}", status="scheduled", amount=req.amount,
            from_account_id=src.id, to_account_id=dst.id, frequency=req.frequency, first_date=first,
            sentence=(f"Done. {usd(req.amount)} moves from {src.name} to {dst.name} {how}, starting {when}. "
                      f"{SIMULATED_NOTE}" if req.frequency != "once" else
                      f"Done. {usd(req.amount)} will move from {src.name} to {dst.name} on {when}. {SIMULATED_NOTE}"),
        )
        st.transfers.append(resp)
        return resp


def stop_transfer(req: StopTransferRequest) -> TransferResponse:
    """Stop a scheduled (simulated) transfer. Stopping one that's already stopped is fine."""
    data = load(req.customer)
    names = {a.id: a.name for a in data.accounts}
    with state.LOCK:
        st = state.get(req.customer)
        for i, t in enumerate(st.transfers):
            if t.id != req.transfer_id:
                continue
            if t.status == "stopped":
                return t
            stopped = t.model_copy(update={
                "status": "stopped",
                "sentence": (f"Stopped. No more {usd(t.amount)} transfers from {names.get(t.from_account_id)} "
                             f"to {names.get(t.to_account_id)}. {SIMULATED_NOTE}"),
            })
            st.transfers[i] = stopped
            return stopped
    raise LookupError(f"No transfer '{req.transfer_id}' to stop.")


def reset(customer_id: str) -> None:
    with state.LOCK:
        state.reset(customer_id)
