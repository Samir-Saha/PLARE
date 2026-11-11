"""Quiet hours: a daily stretch of local time when nothing is pushed to someone's phone.

Pure functions, no database. Times are minutes after local midnight. A range whose end is
before its start wraps past midnight (for example 22:00 to 07:00).
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo


def in_quiet_hours(at: datetime, tz: str, start_minute: int | None, end_minute: int | None) -> bool:
    """Is `at` inside the quiet range, in the person's timezone? No range (or an empty one) means never."""
    if at.tzinfo is None:
        raise ValueError("naive datetime rejected")
    if start_minute is None or end_minute is None or start_minute == end_minute:
        return False
    local = at.astimezone(ZoneInfo(tz))
    minute = local.hour * 60 + local.minute
    if start_minute < end_minute:
        return start_minute <= minute < end_minute
    return minute >= start_minute or minute < end_minute
