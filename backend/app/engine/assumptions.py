"""Every forecasting assumption in one place, so 'show the math' can list them and judges can see them."""

from datetime import date

RUNS = 1000
SEED = 42

# Surprises: each month has this chance of an unexpected bill in [MIN, MAX].
SURPRISE_PROB = 0.10
SURPRISE_MIN = 300.0
SURPRISE_MAX = 2000.0

# IRA growth per year (today's dollars).
IRA_GROWTH = {"typical": 0.05, "bad": 0.02, "good": 0.08}

# Plan rules (fixed order, no AI).
CHECKING_FLOOR = 200.0  # rule 1: bad-case checking must stay above this
TRANSFER_STEP = 25.0  # rule 1: transfer is a multiple of this
TRANSFER_MAX = 1000.0
STARTER_CUSHION = 2.0  # months: rule 1 builds savings to this, then the transfer pays down debt
CUSHION_FULL = 6.0  # months: rule 5 fills savings to this before the IRA
CARD_UTIL_LIMIT = 30.0  # percent: rule 2 splits windfalls while the card is above this
FLEXIBLE_CATEGORIES = {"dining", "shopping", "entertainment", "misc"}
FLEXIBLE_TRIM = 0.20  # the plan spends 20% less on flexible categories (Maya: about $157/month)

TARGET_YEAR = 2031

# Buy-a-home what-if: the full monthly cost, not just the loan.
HOME_PROPERTY_TAX = 0.018  # Texas property tax, about 1.8% of the price a year
HOME_INSURANCE = 0.01  # homeowners insurance, about 1% of the price a year
HOME_PMI = 0.005  # PMI, 0.5% of the starting loan a year, while the down payment is under 20%...
PMI_UNTIL = 0.80  # ...and only until the loan falls to 80% of the price

# Buy-a-car what-if.
CAR_DEPRECIATION = 0.15  # the car counts as an asset that loses 15% of its value a year
CAR_OPTION_TERMS = (36, 48, 60, 72)  # loan lengths compared under a car what-if
CAR_OPTION_APR_STEP = 2.0  # the chosen term is also shown at APR -2 and +2 points

# The same scheduled surprise hits both paths, so the comparison is fair.
SHARED_EVENTS: dict[str, list[dict]] = {
    "maya": [{"date": date(2028, 3, 14), "title": "Car repair", "amount": 2000.0,
              "description": "The transmission needs work: $2,000."}],
    "household": [{"date": date(2028, 6, 10), "title": "Roof repair", "amount": 3500.0,
                   "description": "Hail damage the insurance deductible doesn't cover: $3,500."}],
}


def home_listed() -> list[str]:
    return [f"A home costs its loan payment plus Texas property tax ({HOME_PROPERTY_TAX:.1%} of the price a year) and "
            f"homeowners insurance ({HOME_INSURANCE:.0%} a year). With under 20% down, PMI ({HOME_PMI:.1%} of the loan "
            f"a year) is added until the loan falls to {PMI_UNTIL:.0%} of the price. Upkeep isn't included.",
            "The home counts at its purchase price; the mortgage counts as debt."]


def car_listed() -> list[str]:
    return [f"A car counts as an asset that loses {CAR_DEPRECIATION:.0%} of its value a year; the loan counts as debt.",
            "Insurance, gas and repairs for the car aren't included."]


def listed(plan: bool = True, home: bool = False, car: bool = False) -> list[str]:
    """Plain-words list for 'show the math' and the agent. `home`/`car`: add the what-if's own assumptions."""
    out = [
        f"We simulate the future {RUNS:,} times. The line is the typical (middle) result; "
        "the band runs from the 10th to the 90th percentile.",
        "Everyday spending in each category varies around its 12-month average by as much as it has in the past.",
        f"Each month has a {SURPRISE_PROB:.0%} chance of a surprise bill between ${SURPRISE_MIN:,.0f} and "
        f"${SURPRISE_MAX:,.0f}. Surprises come out of savings first, then go on the card.",
        "IRA growth: 5% a year typical, 2% bad, 8% good.",
        "All numbers are in today's dollars. Income stays flat unless a what-if changes it.",
    ]
    if plan:
        out += [
            f"The plan spends {FLEXIBLE_TRIM:.0%} less on flexible categories (dining, shopping, entertainment, "
            "other) and cancels unused subscriptions.",
            "Both paths get the same random surprises and the same scheduled repair, so only the decisions differ.",
            "On the same path, money freed when a loan is paid off stays in checking "
            "(it isn't spent and isn't put to work).",
        ]
    if home:
        out += home_listed()
    if car:
        out += car_listed()
    return out
