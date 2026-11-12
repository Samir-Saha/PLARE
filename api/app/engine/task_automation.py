"""Task reminder windows and local-calendar recurrence. No database access."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def _aware(value: datetime) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Include a timezone offset")


def reminder_stage(due_at: datetime, at: datetime) -> str | None:
    """Only the current window applies, so a late scheduler never sends a burst."""
    _aware(due_at)
    _aware(at)
    remaining = due_at - at
    if remaining <= timedelta(0):
        return "overdue"
    if remaining <= timedelta(hours=1):
        return "due_hour"
    if remaining <= timedelta(hours=24):
        return "due_day"
    return None


def next_deadline(first_due_at: datetime, after: datetime, frequency: str, timezone_name: str) -> datetime:
    """First scheduled deadline strictly after `after`, anchored to the original local time.

    A DST gap moves forward through the gap, and a fold uses the first occurrence.
    Computing from the anchor avoids both drift and loops through years of missed dates.
    """
    _aware(first_due_at)
    _aware(after)
    if frequency not in ("daily", "weekly"):
        raise ValueError("Choose daily or weekly")
    zone = ZoneInfo(timezone_name)
    anchor = first_due_at.astimezone(zone).replace(tzinfo=None)
    days = 1 if frequency == "daily" else 7
    periods = max(0, (after.astimezone(zone).date() - anchor.date()).days // days)
    while True:
        local = (anchor + timedelta(days=periods * days)).replace(tzinfo=zone, fold=0)
        candidate = local.astimezone(timezone.utc)
        if candidate > after:
            return candidate
        periods += 1
