"""Small helpers for numbers people read: rounding, money text, Metric building."""

from __future__ import annotations

import math
from collections.abc import Iterable

from ..models import Math, MathInput, Metric, Thresholds, Unit


def round_half_up(x: float, ndigits: int = 0) -> float:
    """School rounding (2.5 -> 3), unlike Python's banker's rounding."""
    f = 10**ndigits
    return math.floor(x * f + 0.5) / f


def usd(x: float, cents: bool = False) -> str:
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):,.2f}" if cents else f"{sign}${abs(round_half_up(x)):,.0f}"


def pct(x: float, ndigits: int = 0) -> str:
    return f"{round_half_up(x, ndigits):.{ndigits}f}%"


def months(x: float) -> str:
    return f"{round_half_up(x, 1):.1f} months"


def metric(
    id: str,
    label: str,
    value: float | str | None,
    unit: Unit,
    display: str,
    formula: str,
    inputs: Iterable[tuple] = (),
    assumptions: Iterable[str] = (),
    thresholds: tuple[float, float, Unit] | None = None,
) -> Metric:
    """Build a Metric. `inputs` are (label, value, unit) or (label, value, unit, source) tuples."""
    return Metric(
        id=id,
        label=label,
        value=value,
        unit=unit,
        display=display,
        math=Math(
            formula=formula,
            inputs=[MathInput(label=i[0], value=i[1], unit=i[2], source=i[3] if len(i) > 3 else None) for i in inputs],
            assumptions=list(assumptions),
            thresholds=Thresholds(best=thresholds[0], worst=thresholds[1], unit=thresholds[2]) if thresholds else None,
        ),
    )
