"""Pure RSVP rules for shared calendar events (no database access)."""
from __future__ import annotations

from collections.abc import Iterable


def going_count(responses: Iterable[str]) -> int:
    """How many invitees have said yes. 'maybe', 'no' and not-yet-answered don't count."""
    return sum(1 for r in responses if r == "yes")


def is_confirmed(required: int, responses: Iterable[str]) -> bool:
    """An event is confirmed (shown green) once enough invitees have said yes."""
    return going_count(responses) >= required
