"""Demo state that changes while the app runs: stacked what-ifs and scheduled (simulated) transfers.

Kept in memory on purpose: one demo server, no real money, and POST /api/reset
puts everything back. Nothing here is ever sent to the voice agent except
through the fact sheets and tool results.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock

from ..models import SetupAnswers, TransferResponse, WhatIfRequest


@dataclass
class CustomerState:
    whatifs: list[tuple[WhatIfRequest, str]] = field(default_factory=list)  # (request, sentence)
    transfers: list[TransferResponse] = field(default_factory=list)
    setup: SetupAnswers | None = None  # answers to the two setup questions, if changed


_STATE: dict[str, CustomerState] = {}
LOCK = Lock()


def get(customer_id: str) -> CustomerState:
    return _STATE.setdefault(customer_id, CustomerState())


def reset(customer_id: str) -> None:
    _STATE.pop(customer_id, None)
