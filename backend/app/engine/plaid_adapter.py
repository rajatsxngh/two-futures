"""Plaid data -> our `Customer` format (`CustomerData`), so the engine runs on any bank.

Input is what the Plaid API returns, gathered by `app/plaid_client.py` (or a
saved sandbox sample in the tests):

    {"institution": {"id", "name"}, "accounts": [...] (/accounts/get),
     "transactions": [...] (/transactions/sync), "liabilities": {...} or None (/liabilities/get)}

What comes from Plaid: account types, names and balances, card limits, every
transaction (date, amount, merchant, Plaid's category), and, where the bank
provides liabilities, APRs, minimum payments and due days.

What the adapter works out with code (rules below, all listed in "show the math"):
- pay: deposits Plaid calls wages/salary or that are named like payroll; the
  schedule from the gaps between them, take-home from their 12-month average;
- bills: essentials (rent, utilities, insurance, childcare) paid from checking
  that repeat monthly at about the same amount (same rule as subscriptions);
- subscriptions: found later by `subscriptions.detect`, as for every customer.

What it can't know, so it fills a default and says so (`DEFAULTS` below):
card APRs and limits, minimum payments, loan rates and due days when the bank
doesn't send them, the customer's age, and the setup answers (insurance and
planning ahead) until the customer answers them.

Plaid's sign is the reverse of ours: Plaid amounts are positive for money out.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from statistics import median

from ..models import (
    ACCOUNT_GROUP_OF,
    Account,
    AccountType,
    Bill,
    Customer,
    DueRule,
    InsuranceAnswers,
    SetupAnswers,
    Transaction,
)
from .data import CustomerData
from .fmt import usd
from .subscriptions import AMOUNT_TOLERANCE, CADENCES, MIN_CHARGES, RECENT_GRACE_DAYS, normalize_merchant

CUSTOMER_ID = "sandbox"
CUSTOMER_NAME = "Sandbox user"

# Every guess the adapter can make, in one place.
DEFAULTS = {
    "age": 35,
    "card_apr": 24.0,  # percent, about the US average card APR
    "card_min_floor": 25.0,  # card minimum payment: the larger of $25 and 1% of the balance plus a month's interest
    "card_min_pct": 0.01,
    "card_limit_multiple": 2.0,  # with no limit and no available credit: twice the balance, at least $1,000
    "card_limit_floor": 1000.0,
    "card_due_day": 22,
    "loan_due_day": 1,
    "loan_apr": {AccountType.auto_loan: 7.5, AccountType.mortgage: 6.5, AccountType.personal_loan: 9.0},
    "loan_term_months": {AccountType.auto_loan: 60, AccountType.mortgage: 360, AccountType.personal_loan: 120},
    "planning_ahead": "sometimes",
}

# Plaid account (type, subtype) -> ours. Unlisted subtypes fall back by type.
DEPOSITORY = {"checking": AccountType.checking, "paypal": AccountType.checking, "prepaid": AccountType.checking,
              "savings": AccountType.savings, "money market": AccountType.savings,
              "cash management": AccountType.savings, "cd": AccountType.cd, "hsa": AccountType.ira}
LOAN = {"auto": AccountType.auto_loan, "mortgage": AccountType.mortgage}
RETIREMENT_SUBTYPES = {"401a", "401k", "403b", "457b", "529", "ira", "keogh", "pension", "profit sharing plan",
                       "retirement", "roth", "roth 401k", "sep ira", "simple ira", "sarsep", "thrift savings plan",
                       "tfsa", "rrsp", "hsa", "lira", "lrif", "lrsp", "prif", "rdsp", "resp", "rlif", "rrif"}

PAYROLL = re.compile(r"payroll|salary|direct dep|gusto|\badp\b|paychex|pay ?check", re.I)
INTEREST = re.compile(r"\bintrst\b|\binterest\b", re.I)
ESSENTIALS = {"housing", "utilities", "insurance", "childcare"}
PAYS_PER_YEAR = {"weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12}


def _days_in_month(d: date) -> int:
    return ((d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day


def _add_month(d: date, day: int) -> date:
    nxt = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return nxt.replace(day=min(day, _days_in_month(nxt)))


def _num(x) -> float | None:
    try:
        return float(x) if x is not None else None
    except (TypeError, ValueError):
        return None


def _date(x) -> date | None:
    try:
        return date.fromisoformat(str(x)[:10]) if x else None
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

def category_of(t: dict, account_type: AccountType) -> str:
    """Plaid's personal finance category (and a few name rules) -> our category."""
    pfc = t.get("personal_finance_category") or {}
    primary = str(pfc.get("primary") or "").upper()
    detailed = str(pfc.get("detailed") or "").upper()
    name = f"{t.get('name') or ''} {t.get('merchant_name') or ''}"

    if primary == "INCOME" and detailed in ("INCOME_WAGES", "INCOME_SALARY") or PAYROLL.search(name):
        return "paycheck"
    if detailed == "INCOME_INTEREST_EARNED" or (INTEREST.search(name) and primary in ("INCOME", "TRANSFER_IN")):
        return "interest"
    if primary == "INCOME":
        return "other_income"
    if detailed == "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" or (
            primary in ("LOAN_PAYMENTS", "TRANSFER_IN") and account_type == AccountType.credit_card):
        return "card_payment"
    if primary == "LOAN_PAYMENTS":
        if "CAR" in detailed:
            return "auto_loan"
        if "MORTGAGE" in detailed:
            return "mortgage"
        return "personal_loan"
    if primary in ("TRANSFER_IN", "TRANSFER_OUT"):
        if "SAVINGS" in detailed:
            return "savings_transfer"
        if "RETIREMENT" in detailed:
            return "retirement_contribution"
        return "transfer"
    if primary == "BANK_FEES":
        if "LATE" in detailed or re.search(r"late fee|late charge", name, re.I):
            return "late_fee"
        if "INTEREST" in detailed:
            return "interest"
        return "fees"
    if primary == "FOOD_AND_DRINK":
        return "groceries" if "GROCER" in detailed else "dining"
    if primary == "TRANSPORTATION":
        return "gas" if "GAS" in detailed else "transportation"
    if primary == "RENT_AND_UTILITIES":
        return "housing" if detailed == "RENT_AND_UTILITIES_RENT" else "utilities"
    if primary == "GENERAL_SERVICES":
        if "INSURANCE" in detailed:
            return "insurance"
        if "CHILDCARE" in detailed:
            return "childcare"
        return "services"
    return {"GENERAL_MERCHANDISE": "shopping", "ENTERTAINMENT": "entertainment", "TRAVEL": "travel",
            "PERSONAL_CARE": "personal_care", "MEDICAL": "health", "HOME_IMPROVEMENT": "home",
            "GOVERNMENT_AND_NON_PROFIT": "giving"}.get(primary, "misc")


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

def account_type_of(a: dict) -> AccountType | None:
    kind, sub = str(a.get("type") or "").lower(), str(a.get("subtype") or "").lower()
    if kind == "depository":
        return DEPOSITORY.get(sub, AccountType.savings)
    if kind == "credit":
        return AccountType.credit_card
    if kind == "loan":
        return LOAN.get(sub, AccountType.personal_loan)
    if kind in ("investment", "brokerage"):
        return AccountType.ira
    return None


def _liability_index(liabilities: dict | None) -> dict[str, tuple[str, dict]]:
    """account_id -> (kind, liability record) across every liability list Plaid sent."""
    out: dict[str, tuple[str, dict]] = {}
    for kind, items in (liabilities or {}).items():
        for item in items or []:
            if isinstance(item, dict) and item.get("account_id"):
                out[item["account_id"]] = (kind, item)
    return out


def _apr(rec: dict) -> float | None:
    rate = rec.get("interest_rate")
    if isinstance(rate, dict) and _num(rate.get("percentage")) is not None:
        return _num(rate.get("percentage"))
    if _num(rec.get("interest_rate_percentage")) is not None:
        return _num(rec.get("interest_rate_percentage"))
    aprs = rec.get("aprs") or []
    purchase = next((x for x in aprs if x.get("apr_type") == "purchase_apr"), None)
    pick = purchase or next((x for x in aprs if _num(x.get("apr_percentage"))), None)
    return _num(pick.get("apr_percentage")) if pick else None


def amortized_payment(balance: float, apr: float, months: int) -> float:
    r = apr / 100 / 12
    if months <= 0:
        return balance
    return balance / months if r == 0 else balance * r / (1 - (1 + r) ** -months)


def _term_months(rec: dict) -> int | None:
    if rec.get("loan_term_months"):
        return int(rec["loan_term_months"])
    m = re.match(r"(\d+)\s*year", str(rec.get("loan_term") or ""), re.I)
    return int(m.group(1)) * 12 if m else None


def _order_key(acct_type: AccountType, a: dict, n_txns: int, has_liab: bool) -> tuple:
    """Within a type, the 'main' account first: the engine treats the first checking, savings and card as the
    customer's main ones (where pay lands, where transfers go, the card the plan pays down)."""
    sub = str(a.get("subtype") or "").lower()
    bal = _num((a.get("balances") or {}).get("current")) or 0.0
    business = "business" in str(a.get("name") or "").lower()
    if acct_type == AccountType.checking:
        return (sub != "checking", -n_txns, -bal)
    if acct_type == AccountType.savings:
        return (sub != "savings", -bal)
    if acct_type == AccountType.credit_card:
        return (business, not has_liab, -n_txns, -bal)
    return (-bal,)


# ---------------------------------------------------------------------------
# Pay and bills
# ---------------------------------------------------------------------------

def _schedule(dates: list[date]) -> str:
    if len(dates) < 2:
        return "monthly"
    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    g = median(gaps)
    if g <= 9:
        return "weekly"
    if g <= 16:
        days = {d.day for d in dates}
        semi = all(d.day in (1, 2, 3, 14, 15, 16, 17) or d.day >= 28 for d in dates) and len(days) > 1
        return "semimonthly" if semi and not 13 <= g <= 14 else "biweekly"
    return "monthly"


def _next_payday(last: date, schedule: str, today: date) -> date:
    d = last
    while d <= today:
        if schedule == "weekly":
            d += timedelta(days=7)
        elif schedule == "biweekly":
            d += timedelta(days=14)
        elif schedule == "semimonthly":
            d = d.replace(day=15) if d.day < 15 else _add_month(d, 1)
        else:
            d = _add_month(d, last.day)
    return d


def find_bills(txns: list[Transaction], checking_id: str, today: date) -> list[Bill]:
    """Essentials paid from checking that repeat monthly at about the same amount (the subscription rule's
    cadence and amount tests). Debt payments are modeled from the accounts, so they're never bills here."""
    groups: dict[str, list[Transaction]] = defaultdict(list)
    for t in txns:
        if t.amount < 0 and t.account_id == checking_id and t.category in ESSENTIALS and t.date <= today:
            key = normalize_merchant(t.merchant)
            if key:
                groups[key].append(t)
    lo, hi, _ = CADENCES["monthly"]
    bills: list[Bill] = []
    for key, g in sorted(groups.items()):
        g.sort(key=lambda t: t.date)
        recent = g[-13:]  # the last year of charges
        if len(recent) < MIN_CHARGES or (today - recent[-1].date).days > hi + RECENT_GRACE_DAYS:
            continue
        if not all(lo <= (b.date - a.date).days <= hi for a, b in zip(recent, recent[1:])):
            continue
        amounts = [-t.amount for t in recent]
        typical = median(amounts)
        if any(abs(a - typical) > AMOUNT_TOLERANCE * typical for a in amounts):
            continue
        day = int(median(t.date.day for t in recent))
        bills.append(Bill(id=f"bill_{key.replace(' ', '_')}", name=recent[-1].merchant, amount=round(amounts[-1], 2),
                          category=recent[-1].category, due_rule=DueRule(kind="monthly", day=min(day, 31)),
                          account_id=checking_id))
    return bills


# ---------------------------------------------------------------------------
# The adapter
# ---------------------------------------------------------------------------

class AdapterError(ValueError):
    """The bank's data can't be used (e.g. no deposit account at all). The message is plain words."""


def to_customer(raw: dict, today: date, pulled_on: date | None = None,
                customer_id: str = CUSTOMER_ID) -> CustomerData:
    """Build a `CustomerData` from Plaid responses. `pulled_on` is the real date of the pull: when it differs from
    the demo's `today`, every date is shifted by the difference so the history ends on `today` (and that's listed)."""
    inst = (raw.get("institution") or {}).get("name") or "a Plaid sandbox bank"
    pulled_on = pulled_on or today
    shift = timedelta(days=(today - pulled_on).days)
    general: list[str] = [f"Plaid sandbox test data from {inst}, pulled {pulled_on:%b} {pulled_on.day}, "
                          f"{pulled_on.year}: test accounts, not a real person's."]
    if shift.days:
        general.append(f"Dates moved {abs(shift.days)} days {'later' if shift.days > 0 else 'earlier'} so the history "
                       f"ends on the demo's today ({today:%b} {today.day}, {today.year}).")
    account_notes: dict[str, list[str]] = {}
    indicator_notes: dict[str, list[str]] = defaultdict(list)
    defaults_used: list[str] = []
    liab = _liability_index(raw.get("liabilities"))

    plaid_txns = [t for t in raw.get("transactions") or [] if isinstance(t, dict)]
    n_by_acct: dict[str, int] = defaultdict(int)
    for t in plaid_txns:
        n_by_acct[t.get("account_id")] += 1

    # ---- accounts
    typed: list[tuple[AccountType, dict]] = []
    skipped: list[str] = []
    for a in raw.get("accounts") or []:
        if not isinstance(a, dict) or not a.get("account_id"):
            continue
        cur = (a.get("balances") or {}).get("iso_currency_code")
        t = account_type_of(a)
        if t is None or (cur and cur != "USD"):
            skipped.append(str(a.get("name") or a.get("subtype") or "an account"))
            continue
        typed.append((t, a))
    typed.sort(key=lambda x: (list(AccountType).index(x[0]),
                              _order_key(x[0], x[1], n_by_acct[x[1]["account_id"]], x[1]["account_id"] in liab)))

    accounts: list[Account] = []
    id_map: dict[str, str] = {}  # Plaid account_id -> our id
    used: set[str] = set()
    for acct_type, a in typed:
        base = acct_type.value
        our_id, n = base, 2
        while our_id in used:
            our_id, n = f"{base}{n}", n + 1
        used.add(our_id)
        id_map[a["account_id"]] = our_id
        name = str(a.get("name") or a.get("official_name") or base.replace("_", " ").title())[:60]
        bal = a.get("balances") or {}
        current = _num(bal.get("current"))
        notes = [general[0]]
        if current is None:
            current = _num(bal.get("available")) or 0.0
            notes.append("Plaid sent no current balance; used the available balance (or $0).")
        if current < 0:
            notes.append(f"Plaid's balance was {usd(current)}; counted as $0.")
            current = 0.0
        sub = str(a.get("subtype") or a.get("type") or "")
        if acct_type == AccountType.ira and sub.lower() not in RETIREMENT_SUBTYPES:
            notes.append(f"A Plaid '{sub}' account: counted with retirement and long-term money, not as savings you "
                         "can spend right away.")
        elif sub.lower() == "hsa":
            notes.append("A health savings account: counted with long-term money, not in the savings cushion.")
        elif acct_type == AccountType.savings and sub.lower() != "savings":
            notes.append(f"A Plaid '{sub}' account: counted as savings (money you can reach quickly).")
        kw: dict = {}
        kind, rec = liab.get(a["account_id"], ("", {}))
        if acct_type == AccountType.credit_card:
            apr = _apr(rec) if rec else None
            if apr is None:
                apr = DEFAULTS["card_apr"]
                notes.append(f"APR {apr:g}% is a default: the bank didn't send one.")
                defaults_used.append(f"{name} APR")
            limit = _num(bal.get("limit"))
            if not limit and _num(bal.get("available")) is not None:
                limit = current + (_num(bal.get("available")) or 0.0)
                notes.append(f"Credit limit {usd(limit)} = balance + available credit (the bank sent no limit).")
            if not limit:
                limit = max(DEFAULTS["card_limit_multiple"] * current, DEFAULTS["card_limit_floor"])
                notes.append(f"Credit limit {usd(limit)} is a default (twice the balance, at least "
                             f"{usd(DEFAULTS['card_limit_floor'])}): the bank didn't send one.")
                defaults_used.append(f"{name} limit")
            min_pay = _num(rec.get("minimum_payment_amount")) if rec else None
            if not min_pay:
                min_pay = round(max(DEFAULTS["card_min_floor"],
                                    current * DEFAULTS["card_min_pct"] + current * apr / 100 / 12), 2) if current else 0.0
                notes.append(f"Minimum payment {usd(min_pay, cents=True)} is a default (the larger of $25 and 1% of "
                             "the balance plus a month's interest): the bank didn't send one.")
                defaults_used.append(f"{name} minimum payment")
            due = _date(rec.get("next_payment_due_date")) if rec else None
            if due is None:
                notes.append(f"Due day {DEFAULTS['card_due_day']} is a default: the bank didn't send one.")
                defaults_used.append(f"{name} due day")
            kw = dict(rate=apr, limit=round(limit, 2), min_payment=min_pay or None,
                      due_day=due.day if due else DEFAULTS["card_due_day"])
        elif ACCOUNT_GROUP_OF[acct_type].value == "debt":
            apr = _apr(rec) if rec else None
            if apr is None:
                apr = DEFAULTS["loan_apr"][acct_type]
                notes.append(f"Interest rate {apr:g}% is a default for this kind of loan: the bank didn't send one.")
                defaults_used.append(f"{name} rate")
            term = _term_months(rec) if rec else None
            payment = None
            for k in ("next_payment_amount", "minimum_payment_amount", "next_monthly_payment", "last_payment_amount"):
                if rec and _num(rec.get(k)):
                    payment = _num(rec.get(k))
                    break
            interest = current * apr / 100 / 12
            payoff = _date((rec or {}).get("expected_payoff_date") or (rec or {}).get("maturity_date"))
            left = None
            if payoff and payoff > today:
                left = max(1, (payoff.year - today.year) * 12 + payoff.month - today.month)
            if payment is None:
                months = left or DEFAULTS["loan_term_months"][acct_type]
                payment = round(amortized_payment(current, apr, months), 2)
                notes.append(f"Monthly payment {usd(payment, cents=True)} is worked out (pays it off in {months} months "
                             f"at {apr:g}%): the bank didn't send one.")
                defaults_used.append(f"{name} payment")
            elif current > 0 and payment <= interest:
                months = left or DEFAULTS["loan_term_months"][acct_type]
                fixed = round(amortized_payment(current, apr, months), 2)
                notes.append(f"The bank lists a {usd(payment, cents=True)} payment, less than the "
                             f"{usd(interest, cents=True)} monthly interest, so the loan would never shrink. Used "
                             f"{usd(fixed, cents=True)} instead: the payment that pays it off in {months} months.")
                indicator_notes["debt_load"].append(f"{name}: payment raised from {usd(payment, cents=True)} to "
                                                    f"{usd(fixed, cents=True)} so it covers the interest.")
                defaults_used.append(f"{name} payment")
                payment = fixed
            due = _date(rec.get("next_payment_due_date")) if rec else None
            if due is None:
                notes.append(f"Due day {DEFAULTS['loan_due_day']} is a default: the bank didn't send one.")
                defaults_used.append(f"{name} due day")
            kw = dict(rate=apr, min_payment=payment if current > 0 else None,
                      due_day=due.day if due else DEFAULTS["loan_due_day"],
                      original_amount=_num(rec.get("origination_principal_amount")) if rec else None,
                      term_months=term)
        elif acct_type == AccountType.cd:
            notes.append("Plaid doesn't send a CD's rate or maturity date: it's kept at its balance, with no maturity "
                         "event.")
        account_notes[our_id] = notes
        accounts.append(Account(id=our_id, type=acct_type, group=ACCOUNT_GROUP_OF[acct_type], name=name,
                                institution=inst, balance=round(current, 2), **kw))

    if not any(a.type == AccountType.checking for a in accounts):
        cash = next((a for a in accounts if a.type == AccountType.savings), None)
        if cash is None:
            raise AdapterError("This bank connection has no checking or savings account, so there's no cash to "
                               "forecast. Try another test bank.")
        # promote the main savings account to checking: the engine needs one account where pay lands
        idx = accounts.index(cash)
        accounts[idx] = cash.model_copy(update={"type": AccountType.checking, "group": ACCOUNT_GROUP_OF[AccountType.checking]})
        account_notes[cash.id].append("No checking account came from the bank, so this account is treated as checking "
                                      "(where pay lands and bills are paid).")
        accounts.sort(key=lambda a: list(AccountType).index(a.type))
    checking = next(a for a in accounts if a.type == AccountType.checking)
    kinds = {a.id: a.type for a in accounts}

    # ---- transactions
    txns: list[Transaction] = []
    flipped: list[str] = []
    dropped_pending = 0
    for t in plaid_txns:
        our_acct = id_map.get(t.get("account_id"))
        d = _date(t.get("date"))
        amt = _num(t.get("amount"))
        if our_acct is None or d is None or amt is None:
            continue
        if t.get("pending"):
            dropped_pending += 1
            continue
        d = d + shift
        if d > today:
            continue
        cat = category_of(t, kinds[our_acct])
        amount = -amt  # Plaid: positive = money out. Ours: negative = money out.
        if cat == "paycheck" and amount < 0:
            # Named like payroll but recorded as money out: the sandbox does this; a paycheck is a deposit.
            flipped.append(str(t.get("name")))
            amount = -amount
        merchant = str((t.get("name") if cat == "paycheck" else t.get("merchant_name")) or t.get("name") or "Unknown")
        txns.append(Transaction(id=str(t.get("transaction_id") or f"t{len(txns)}"), date=d, amount=round(amount, 2),
                                merchant=merchant[:80], category=cat, account_id=our_acct, recurring=False))
    txns.sort(key=lambda t: (t.date, t.id))

    # ---- pay
    pay = [t for t in txns if t.category == "paycheck"]
    window_start = today - timedelta(days=364)
    first = txns[0].date if txns else today
    span_days = (today - max(first, window_start)).days + 1
    months = min(12.0, span_days * 12 / 365)
    if pay:
        by_source: dict[str, list[Transaction]] = defaultdict(list)
        for t in pay:
            by_source[normalize_merchant(t.merchant) or t.merchant].append(t)
        main = max(by_source.values(), key=lambda g: sum(t.amount for t in g if t.date >= window_start))
        dates = sorted(t.date for t in main)
        schedule = _schedule(dates[-13:])
        if len(by_source) == 1:  # one employer: a paycheck is the typical (median) recent deposit
            per_check = round(median(t.amount for t in sorted(main, key=lambda t: t.date)[-6:]), 2)
        else:  # several sources: their 12-month average, spread over the main schedule's paydays
            per_check = round(sum(t.amount for t in pay if t.date >= window_start) / months * 12
                              / PAYS_PER_YEAR[schedule], 2)
        monthly = per_check * PAYS_PER_YEAR[schedule] / 12
        next_payday = _next_payday(dates[-1], schedule, today)
        general.append(f"Pay: {len(pay)} deposits that Plaid calls wages or salary, or that are named like payroll "
                       f"(e.g. '{main[-1].merchant}'). Paid {schedule}: {usd(per_check, cents=True)} a paycheck "
                       + ("(the typical recent deposit)" if len(by_source) == 1 else
                          f"(all {len(by_source)} sources' average over the last {months:.0f} months)")
                       + f", about {usd(monthly)} a month.")
        if flipped:
            general.append(f"{len(flipped)} payroll deposits ('{flipped[0]}') are recorded by the sandbox as money "
                           "out. They're counted as pay coming in.")
        for t in pay:
            t.recurring = True
    else:
        schedule, per_check, next_payday = "monthly", 0.0, _add_month(today, today.day)
        general.append("No paychecks found (no deposits Plaid calls wages or salary, or named like payroll), so "
                       "take-home pay is $0 and every bill comes out of what's already saved.")

    # ---- bills
    bills = find_bills(txns, checking.id, today)
    for b in bills:
        for t in txns:
            if t.account_id == checking.id and normalize_merchant(t.merchant) == b.id[5:].replace("_", " "):
                t.recurring = True
    if bills:
        general.append("Bills found: " + "; ".join(f"{b.name} {usd(b.amount, cents=True)} on day {b.due_rule.day}"
                                                    for b in bills)
                       + ". Rule: an essential (rent, utilities, insurance, childcare) paid from checking at least "
                         f"{MIN_CHARGES} times, about monthly, each within {AMOUNT_TOLERANCE:.0%} of the typical amount.")
    else:
        general.append("No repeating essential bills (rent, utilities, insurance, childcare) found in checking; "
                       "spending is learned category by category from the transactions.")

    # ---- data checks: does money run through checking the way the forecast assumes? (The sandbox often doesn't.)
    checks: list[str] = []
    names = {a.id: a.name for a in accounts}
    pay_elsewhere = sorted({t.account_id for t in pay} - {checking.id})
    if pay and pay_elsewhere:
        checks.append(f"Data check: pay lands in {', '.join(names[x] for x in pay_elsewhere)} at the bank, not in "
                      f"{checking.name}. The forecast adds it to {checking.name}, where bills are paid.")
    active = {t.account_id for t in txns}
    loan_out = [-t.amount for t in txns if t.category in ("auto_loan", "mortgage", "personal_loan") and t.amount < 0]
    unseen = [a for a in accounts
              if a.group.value == "debt" and a.type != AccountType.credit_card and a.min_payment and a.id not in active
              and not any(abs(x - a.min_payment) <= AMOUNT_TOLERANCE * a.min_payment for x in loan_out)]
    if unseen:
        checks.append("Data check: no payments for " + ", ".join(
            f"{a.name} ({usd(a.min_payment or 0, cents=True)} a month)" for a in unseen)
            + f" show up in the transactions. The forecast still takes each one from {checking.name} on its due day.")
    general += checks

    # ---- history
    if txns:
        days = (today - txns[0].date).days + 1
        general.append(f"History: {len(txns)} transactions over {days} days ({txns[0].date:%b %Y} to "
                       f"{txns[-1].date:%b %Y}).")
        if days < 365:
            general.append(f"Less than a year of history: monthly averages use the {days * 12 / 365:.1f} months "
                           "there are.")
    else:
        general.append("The bank sent no transactions, so spending and pay are $0.")
    if dropped_pending:
        general.append(f"{dropped_pending} pending transactions left out until they post.")
    if skipped:
        general.append(f"Left out (not a type the app models, or not in US dollars): {', '.join(skipped)}.")

    # ---- the customer: what Plaid doesn't know
    has = {a.type for a in accounts}
    insurance = InsuranceAnswers(health=False, auto=AccountType.auto_loan in has,
                                 renters_or_home=AccountType.mortgage in has, disability=False)
    indicator_notes["insurance"].append(
        "Not answered yet. Default: auto insurance "
        + ("yes (there's an auto loan, and lenders require it)" if insurance.auto else "no")
        + ", home insurance " + ("yes (there's a mortgage, and lenders require it)" if insurance.renters_or_home
                                 else "no")
        + ", health and disability no. Answer the setup questions to change these.")
    indicator_notes["planning_ahead"].append(
        f"Not answered yet: '{DEFAULTS['planning_ahead']}' is a default. Answer the setup questions to change it.")
    if defaults_used:
        general.append(f"Defaults filled in because the bank didn't send them: {', '.join(defaults_used)}. "
                       "Tap an account to see each one.")
    general.append(f"Age {DEFAULTS['age']} is a default (Plaid doesn't send it); it only labels the years ahead.")
    for a in accounts:
        if a.type == AccountType.credit_card:
            indicator_notes["credit_health"] += [n for n in account_notes[a.id][1:] if "limit" in n.lower()]

    customer = Customer(
        id=customer_id, name=CUSTOMER_NAME, age=DEFAULTS["age"], city="Plaid sandbox", state="US",
        occupation="Sandbox test user", pay_schedule=schedule, take_home_per_paycheck=per_check,
        next_payday=next_payday,
        setup=SetupAnswers(insurance=insurance, planning_ahead=DEFAULTS["planning_ahead"], subscriptions={}),
    )
    return CustomerData(customer=customer, accounts=accounts, bills=bills, transactions=txns,
                        source=f"plaid_sandbox:{inst}", assumptions=general, account_notes=account_notes,
                        indicator_notes=dict(indicator_notes), data_checks=checks)
