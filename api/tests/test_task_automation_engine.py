from datetime import datetime

import pytest

from app.engine.task_automation import next_deadline, reminder_stage


def dt(value):
    return datetime.fromisoformat(value)


@pytest.mark.parametrize("at,expected", [
    ("2026-11-11T17:59:59Z", None),
    ("2026-11-11T18:00:00Z", "due_day"),
    ("2026-11-12T16:59:59Z", "due_day"),
    ("2026-11-12T17:00:00Z", "due_hour"),
    ("2026-11-12T18:00:00Z", "overdue"),
    ("2026-11-15T18:00:00Z", "overdue"),
])
def test_only_current_reminder_window_is_selected(at, expected):
    assert reminder_stage(dt("2026-11-12T18:00:00Z"), dt(at)) == expected


@pytest.mark.parametrize("first,after,frequency,expected", [
    ("2026-11-10T18:00:00Z", "2026-11-10T18:00:00Z", "daily", "2026-11-11T18:00:00Z"),
    ("2026-11-10T18:00:00Z", "2026-11-11T17:59:59Z", "daily", "2026-11-11T18:00:00Z"),
    ("2026-11-10T18:00:00Z", "2026-11-10T18:00:00Z", "weekly", "2026-11-17T18:00:00Z"),
    ("2026-11-10T18:00:00Z", "2028-11-10T18:00:00Z", "daily", "2028-11-11T18:00:00Z"),
    # 9 AM local remains 9 AM across both DST changes.
    ("2026-03-07T14:00:00Z", "2026-03-07T14:00:00Z", "daily", "2026-03-08T13:00:00Z"),
    ("2026-10-31T13:00:00Z", "2026-10-31T13:00:00Z", "weekly", "2026-11-07T14:00:00Z"),
    # 2:30 AM doesn't exist on March 8: use 3:30, then restore 2:30 next day.
    ("2026-03-07T07:30:00Z", "2026-03-07T07:30:00Z", "daily", "2026-03-08T07:30:00Z"),
    ("2026-03-07T07:30:00Z", "2026-03-08T07:30:00Z", "daily", "2026-03-09T06:30:00Z"),
    # Repeated 1:30 AM uses the first occurrence, never two tasks on the same day.
    ("2026-10-31T05:30:00Z", "2026-10-31T05:30:00Z", "daily", "2026-11-01T05:30:00Z"),
    ("2026-10-31T05:30:00Z", "2026-11-01T06:00:00Z", "daily", "2026-11-02T06:30:00Z"),
])
def test_recurring_deadlines_follow_local_calendar(first, after, frequency, expected):
    assert next_deadline(dt(first), dt(after), frequency, "America/New_York") == dt(expected)


def test_calendar_supports_non_hour_timezone_offsets():
    assert next_deadline(dt("2026-11-10T03:15:00Z"), dt("2026-11-10T03:15:00Z"),
                         "daily", "Asia/Kathmandu") == dt("2026-11-11T03:15:00Z")


def test_engine_rejects_naive_times_and_unknown_frequencies():
    with pytest.raises(ValueError):
        reminder_stage(dt("2026-11-10T18:00:00"), dt("2026-11-10T18:00:00Z"))
    with pytest.raises(ValueError):
        next_deadline(dt("2026-11-10T18:00:00Z"), dt("2026-11-10T18:00:00"), "daily", "UTC")
    with pytest.raises(ValueError):
        next_deadline(dt("2026-11-10T18:00:00Z"), dt("2026-11-10T18:00:00Z"), "monthly", "UTC")
