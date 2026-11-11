from datetime import datetime, timezone

import pytest

from app.engine.quiet import in_quiet_hours

NY = "America/New_York"


def at(hour, minute=0):
    # November: New York is UTC-5.
    return datetime(2026, 11, 10, (hour + 5) % 24, minute, tzinfo=timezone.utc).replace(
        day=10 if hour + 5 < 24 else 11)


@pytest.mark.parametrize("hour,minute,quiet", [
    (21, 59, False), (22, 0, True), (23, 30, True), (0, 0, True), (6, 59, True), (7, 0, False), (12, 0, False),
])
def test_wraps_past_midnight(hour, minute, quiet):
    assert in_quiet_hours(at(hour, minute), NY, 22 * 60, 7 * 60) is quiet


def test_same_day_range_and_off():
    assert in_quiet_hours(at(13), NY, 12 * 60, 14 * 60) is True
    assert in_quiet_hours(at(15), NY, 12 * 60, 14 * 60) is False
    assert in_quiet_hours(at(3), NY, None, None) is False
    assert in_quiet_hours(at(3), NY, 600, 600) is False


def test_rejects_naive_datetimes():
    with pytest.raises(ValueError):
        in_quiet_hours(datetime(2026, 11, 10, 3), NY, 0, 60)
