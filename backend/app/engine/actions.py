"""The three things that change demo state: apply a what-if, schedule a transfer, reset (F6, F7, F8)."""

from __future__ import annotations

from datetime import date, timedelta

from ..models import Metric, TransferRequest, TransferResponse, UpdatePlanResponse, WhatIfRequest
from . import state
from .data import load
from .fmt import metric, round_half_up, usd
from .futures import futures_for
from .whatif import TAKE_HOME_SHARE, WhatIfError, monthly_net, sentence

CHANGE_FIELDS = ("income_change_yearly", "spending_change_monthly", "savings_change_monthly", "one_time_cost",
                 "job_loss_months", "home")


def _signed(x: float, fmt) -> str:
    return ("+" if x >= 0 else "-") + fmt(abs(x))


def _k(x: float) -> str:
    return f"${x / 1000:,.1f}k" if x >= 1000 else usd(x)


def apply_whatif(customer_id: str, req: WhatIfRequest, today: date) -> UpdatePlanResponse:
    if not any(getattr(req, f) for f in CHANGE_FIELDS):
        raise WhatIfError("A what-if needs at least one change (income, spending, savings, one-time cost or job loss).")
    with state.LOCK:
        st = state.get(customer_id)
        before = futures_for(customer_id, today, st.whatifs)
        trial = futures_for(customer_id, today, st.whatifs + [(req, "")])
        b, a = before.response.paths["plan"], trial.response.paths["plan"]
        line = sentence(req, b, a, trial.sims["plan"].months, trial.sims["plan"])
        st.whatifs.append((req, line))
        after = futures_for(customer_id, today, st.whatifs)
        applied = [w for w, _ in st.whatifs]

    year = after.response.target_year
    s0, s1 = b.snapshots[-1], after.response.paths["plan"].snapshots[-1]
    deltas: list[Metric] = []
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
                              fact_sheet=after.response.fact_sheets["plan"])


def current_futures(customer_id: str, today: date):
    return futures_for(customer_id, today, state.get(customer_id).whatifs)


class TransferError(ValueError):
    pass


def schedule_transfer(req: TransferRequest, today: date) -> TransferResponse:
    if not req.confirmed:
        raise TransferError("Transfer needs a clear yes (confirmed=true). Nothing moved.")
    data = load(req.customer)
    ids = {a.id: a for a in data.accounts}
    for acc in (req.from_account_id, req.to_account_id):
        if acc not in ids:
            raise TransferError(f"Unknown account '{acc}'.")
    if req.from_account_id == req.to_account_id:
        raise TransferError("From and to accounts must differ.")
    src, dst = ids[req.from_account_id], ids[req.to_account_id]

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
            if (t.amount, t.from_account_id, t.to_account_id, t.frequency) == (
                    req.amount, req.from_account_id, req.to_account_id, req.frequency):
                return t
        verb = "moves" if req.frequency != "once" else "will move"
        resp = TransferResponse(
            id=f"tr_{req.customer}_{len(st.transfers) + 1}", status="scheduled", amount=req.amount,
            from_account_id=src.id, to_account_id=dst.id, frequency=req.frequency, first_date=first,
            sentence=(f"Done. {usd(req.amount)} {verb} from {src.name} to {dst.name} {how}, starting "
                      f"{first.strftime('%A, %B')} {first.day}." if req.frequency != "once" else
                      f"Done. {usd(req.amount)} will move from {src.name} to {dst.name} on "
                      f"{first.strftime('%A, %B')} {first.day}."),
        )
        st.transfers.append(resp)
        return resp


def reset(customer_id: str) -> None:
    with state.LOCK:
        state.reset(customer_id)
