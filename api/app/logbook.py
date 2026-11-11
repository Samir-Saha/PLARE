"""Accountability log: the one place missed or late requirements are recorded.

Other features (BP posts, GM messages, study hours, points) record facts here with
`add_entry`. The log states what happened (late, missed, short) and nothing else:
no penalties, punishments, or consequences.

Typical use from another feature, inside a request that commits afterwards:

    from ..logbook import add_entry

    add_entry(db, org_id, pledge.id, "late_gm", "GM message sent at 9:12 AM (due 9:00 AM)",
              source_key=f"gm:{message.id}")
    db.commit()

Pass a `source_key` for anything detected automatically, so re-running a check never
creates a second entry for the same event. Leave `created_by` empty for automatic
entries; set it to the brother's user id for manual ones.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import notify
from .db import now
from .models import Assignment, LogEntry, Task, TaskStatus

# Display timezone for the pledge class.
LOCAL_TZ = ZoneInfo("America/New_York")

# Known kinds and their plain-language labels. Add new kinds here, never rename existing ones.
KINDS: dict[str, str] = {
    "late_bp": "Late BP post",
    "missed_bp": "Missed BP post",
    "missed_bp_checkin": "Missed BP check-in",
    "late_gm": "Late GM message",
    "wrong_code": "Wrong GM code",
    "missed_gm": "Missed GM message",
    "overdue_task": "Overdue task",
    "study_short": "Short on study hours",
    "points_short": "Short on points",
    "other": "Other",
}


def label(kind: str) -> str:
    return KINDS.get(kind, kind.replace("_", " ").capitalize())


def local_time(at: datetime) -> str:
    """e.g. 'Mon, Nov 9 at 4:43 PM' in Eastern time."""
    t = at.astimezone(LOCAL_TZ)
    return f"{t:%a}, {t:%b} {t.day} at {t.hour % 12 or 12}:{t:%M} {'AM' if t.hour < 12 else 'PM'}"


def add_entry(
    db: Session,
    org_id: str,
    user_id: str,
    kind: str,
    detail: str,
    created_by: str | None = None,
    source_key: str | None = None,
) -> LogEntry:
    """Record one log entry for a pledge and notify them in the app. Signature is stable.

    - `kind` must be one of `KINDS` (raises ValueError otherwise, to catch typos early).
    - `source_key`: if an entry with this key already exists in the org, nothing is
      written and the existing entry is returned. Use it for every automatic entry.
    - `created_by`: None means automatic; a user id means a brother added it by hand.
    - Does not commit. The caller commits with the rest of its request.
    """
    if kind not in KINDS:
        raise ValueError(f"unknown log kind {kind!r}; add it to logbook.KINDS")
    if source_key:
        existing = db.scalar(select(LogEntry).where(LogEntry.org_id == org_id, LogEntry.source_key == source_key))
        if existing:
            return existing
    entry = LogEntry(org_id=org_id, user_id=user_id, kind=kind, detail=detail.strip(),
                     automatic=created_by is None, source_key=source_key, created_by=created_by)
    try:
        # Savepoint so a concurrent duplicate only rolls back this insert, not the caller's work.
        with db.begin_nested():
            db.add(entry)
            db.flush()
    except IntegrityError:
        existing = db.scalar(select(LogEntry).where(LogEntry.org_id == org_id, LogEntry.source_key == source_key))
        if existing:
            return existing
        raise
    notify(db, user_id, org_id, "log", f"New log entry: {label(kind)}", body=entry.detail, link="/app/log")
    return entry


def sync_overdue(db: Session, org_id: str) -> int:
    """Log every past-due assignment that isn't submitted or approved. Safe to call repeatedly."""
    rows = db.scalars(
        select(Assignment).join(Task).where(
            Assignment.org_id == org_id,
            Task.deleted_at.is_(None),
            Task.due_at.is_not(None),
            Task.due_at < now(),
            Assignment.status.not_in([TaskStatus.submitted.value, TaskStatus.approved.value]),
        )
    ).all()
    keys = set(db.scalars(select(LogEntry.source_key).where(LogEntry.org_id == org_id, LogEntry.source_key.like("overdue:%"))))
    added = 0
    for a in rows:
        key = f"overdue:{a.id}"
        if key in keys:
            continue
        add_entry(db, org_id, a.user_id, "overdue_task", f"{a.task.title} was due {local_time(a.task.due_at)}", source_key=key)
        added += 1
    return added
