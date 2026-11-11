"""Good-morning (GM) message rules. Pure functions: no database access.

A GM message belongs to the group-local calendar day it was sent on. It is due at a
fixed local time each day (6:00 AM by default) and is flagged when it arrives after
that time or when its code word doesn't match the code the NME set for the day.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

DEFAULT_DUE_MINUTE = 6 * 60
DEFAULT_REMINDER_MINUTES = 10


def local_day(at: datetime, tz: str) -> date:
    """The calendar day `at` falls on in the group's timezone."""
    if at.tzinfo is None:
        raise ValueError("naive datetime rejected")
    return at.astimezone(ZoneInfo(tz)).date()


def due_at(day: date, due_minute: int, tz: str) -> datetime:
    """The UTC moment a day's GM is due (`due_minute` minutes after local midnight)."""
    local = datetime.combine(day, time(due_minute // 60, due_minute % 60), tzinfo=ZoneInfo(tz))
    return local.astimezone(timezone.utc)


def reminder_at(day: date, due_minute: int, reminder_minutes: int, tz: str) -> datetime:
    return due_at(day, due_minute, tz) - timedelta(minutes=reminder_minutes)


def should_remind(at: datetime, due: datetime, reminder_minutes: int) -> bool:
    """True from the reminder time up to (not including) the deadline."""
    return due - timedelta(minutes=reminder_minutes) <= at < due


def normalize_code(code: str) -> str:
    """Code words match regardless of case and extra spaces."""
    return " ".join(code.split()).casefold()


def code_status(given: str, expected: str | None) -> str:
    """'ok', 'wrong', or 'unset' when the NME hasn't set a code word for the day."""
    if not expected:
        return "unset"
    return "ok" if normalize_code(given) == normalize_code(expected) else "wrong"


def flags(submitted_at: datetime, due: datetime, given: str, expected: str | None) -> list[str]:
    """Problems an NME should look at: 'late' and/or 'wrong_code'."""
    out = []
    if submitted_at > due:
        out.append("late")
    if code_status(given, expected) == "wrong":
        out.append("wrong_code")
    return out
