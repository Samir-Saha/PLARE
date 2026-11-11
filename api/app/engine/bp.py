"""BP check-in rules. Pure functions: no database access.

A BP photo belongs to the group-local day it was taken on. The server stamps the time, so a
photo is late when the server received it after the day's deadline, and a member with no photo
is missing once the deadline has passed.
"""
from __future__ import annotations

from datetime import date, datetime

from .gm import due_at, local_day

DEFAULT_DUE_MINUTE = 9 * 60 + 30  # 9:30 AM local

__all__ = ["DEFAULT_DUE_MINUTE", "due_at", "local_day", "status", "counts"]


def status(submitted_at: datetime | None, due: datetime, at: datetime) -> str:
    """'on_time', 'late', 'missing' (no photo after the deadline), or 'pending' (none yet, still time)."""
    if submitted_at is None:
        return "missing" if at > due else "pending"
    return "late" if submitted_at > due else "on_time"


def counts(statuses: list[str]) -> dict[str, int]:
    out = {"on_time": 0, "late": 0, "missing": 0, "pending": 0}
    for s in statuses:
        out[s] += 1
    out["members"] = len(statuses)
    out["flagged"] = out["late"] + out["missing"]
    return out


def is_valid_day(day: date, today: date, back_days: int = 30) -> bool:
    """Leads can look back a month; nobody can look at days that haven't started."""
    return (today - day).days <= back_days and day <= today
