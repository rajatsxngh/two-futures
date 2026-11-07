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
CUSHION_TARGET = 3.0  # months: rule 1 runs until the cushion reaches this
CUSHION_FULL = 6.0  # months: rule 5 fills savings to this before the IRA
CARD_UTIL_LIMIT = 30.0  # percent: rule 2 splits windfalls while the card is above this
FLEXIBLE_CATEGORIES = {"dining", "shopping", "entertainment", "misc"}
FLEXIBLE_TRIM = 0.20  # the plan spends 20% less on flexible categories (Maya: about $157/month)

TARGET_YEAR = 2031

# The same scheduled surprise hits both paths, so the comparison is fair.
SHARED_EVENTS: dict[str, list[dict]] = {
    "maya": [{"date": date(2028, 3, 14), "title": "Car repair", "amount": 2000.0,
              "description": "The transmission needs work: $2,000."}],
    "household": [{"date": date(2028, 6, 10), "title": "Roof repair", "amount": 3500.0,
                   "description": "Hail damage the insurance deductible doesn't cover: $3,500."}],
}


def listed(plan: bool = True) -> list[str]:
    """Plain-words list for 'show the math' and the agent."""
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
    return out
