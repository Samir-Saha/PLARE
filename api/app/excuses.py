"""Excused absences: the one place other features ask "was this person excused?".

A pledge requests an excuse for a kind of requirement on one or more days, and a
brother approves or denies it. Only approved excuses count.

Typical use from another feature, before flagging or logging someone:

    from ..excuses import is_excused

    if not is_excused(db, org_id, pledge.id, "gm", day):
        add_entry(db, org_id, pledge.id, "missed_gm", ...)

`day` is the local day the requirement was due, as a date or a YYYY-MM-DD string.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Excuse

# Known kinds and reasons with plain labels. Add new ones here, never rename existing ones.
KINDS: dict[str, str] = {
    "bp": "BP check-in",
    "gm": "GM message",
    "study": "Study session",
    "event": "Event",
    "all": "Everything that day",
}
REASONS: dict[str, str] = {
    "exam": "Exam",
    "class": "Class",
    "sick": "Sick",
    "work": "Work",
    "family": "Family",
    "other": "Other",
}


def is_excused(db: Session, org_id: str, user_id: str, kind: str, day: date | str) -> bool:
    """True if the person has an approved excuse covering `kind` on `day`. Signature is stable.

    An excuse for "all" covers every kind. Raises ValueError on an unknown kind, to catch typos early.
    """
    if kind not in KINDS:
        raise ValueError(f"unknown excuse kind {kind!r}; add it to excuses.KINDS")
    d = day.isoformat() if isinstance(day, date) else date.fromisoformat(day).isoformat()
    return db.scalar(
        select(Excuse.id).where(
            Excuse.org_id == org_id, Excuse.user_id == user_id, Excuse.status == "approved",
            Excuse.kind.in_([kind, "all"]), Excuse.start_day <= d, Excuse.end_day >= d,
        ).limit(1)
    ) is not None
