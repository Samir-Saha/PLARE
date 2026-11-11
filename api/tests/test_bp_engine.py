import random
from datetime import date, datetime, timedelta, timezone

import pytest

from app.engine import bp_checkin as bp

NY = "America/New_York"
TUE = date(2026, 11, 10)  # a Tuesday; New York is UTC-5
MIN = timedelta(minutes=1)


def ny(hour, minute=0, day=TUE):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc) + timedelta(hours=5)


def test_blocks_for_the_day_weekly_and_dated():
    rules = [
        bp.BlockRule("class", 10 * 60, 11 * 60, weekday=1),           # Tuesdays
        bp.BlockRule("class", 10 * 60, 11 * 60, weekday=2),           # Wednesdays: not today
        bp.BlockRule("interview", 13 * 60, 14 * 60, day=TUE),
        bp.BlockRule("religious", 13 * 60 + 30, 15 * 60, day=TUE),    # overlaps, merges
    ]
    spans = bp.blocks_on(TUE, NY, rules)
    assert spans == [bp.Span(ny(10), ny(11)), bp.Span(ny(13), ny(15))]
    # Brothers can allow check-ins during class.
    assert bp.blocks_on(TUE, NY, rules, class_blocks=False) == [bp.Span(ny(13), ny(15))]


def test_allowed_starts_avoid_blocks_with_a_buffer_and_close_before_the_next():
    win = bp.window(TUE, NY, 9 * 60, 17 * 60)
    blocked = [bp.Span(ny(10), ny(11)), bp.Span(ny(13), ny(15))]
    ranges = bp.allowed_starts(win, blocked, timedelta(minutes=15))
    assert ranges == [
        bp.Span(ny(9), ny(9, 35)),        # closes by 9:50, 10 min before class
        bp.Span(ny(11, 10), ny(12, 35)),  # opens 10 min after class, closes by 12:50
        bp.Span(ny(15, 10), ny(16, 45)),  # closes by 5:00, the end of the window
    ]


def test_gaps_too_short_are_skipped_and_earliest_is_respected():
    win = bp.window(TUE, NY, 9 * 60, 12 * 60)
    blocked = [bp.Span(ny(9, 20), ny(11, 40))]
    # 9:00-9:10 and 11:50-12:00 (after the 10-minute buffers) are each too short for 15 minutes.
    assert bp.allowed_starts(win, blocked, timedelta(minutes=15)) == []
    ranges = bp.allowed_starts(bp.window(TUE, NY, 9 * 60, 17 * 60), [], timedelta(minutes=15), earliest=ny(16))
    assert ranges == [bp.Span(ny(16), ny(16, 45))]


def test_whole_day_blocked_means_no_check_in():
    rules = [bp.BlockRule("other", 0, 24 * 60, day=TUE)]
    times = bp.plan(TUE, NY, 9 * 60, 17 * 60, rules, True, 2, timedelta(minutes=15), random.Random(1), at=ny(0))
    assert times == []


@pytest.mark.parametrize("seed", range(25))
def test_planned_times_respect_every_rule(seed):
    rules = [bp.BlockRule("class", 10 * 60, 11 * 60 + 15, weekday=1), bp.BlockRule("interview", 14 * 60, 15 * 60, day=TUE)]
    open_for = timedelta(minutes=15)
    times = bp.plan(TUE, NY, 9 * 60, 17 * 60, rules, True, 3, open_for, random.Random(seed), at=ny(8))
    assert len(times) == 3 and times == sorted(times)
    for a, b in zip(times, times[1:]):
        assert b - a >= bp.MIN_GAP
    for t in times:
        assert ny(9) <= t and t + open_for <= ny(17)
        for s, e in ((ny(10), ny(11, 15)), (ny(14), ny(15))):
            # Neither the check-in nor its open window touches a block or its buffer.
            assert t + open_for <= s - bp.BUFFER or t >= e + bp.BUFFER


def test_random_times_cover_the_allowed_range():
    win = bp.window(TUE, NY, 9 * 60, 17 * 60)
    ranges = bp.allowed_starts(win, [], timedelta(minutes=15))
    rng = random.Random(7)
    hours = {bp.pick_times(ranges, 1, rng)[0].astimezone(timezone.utc).hour for _ in range(400)}
    assert hours == {h + 5 for h in range(9, 17)}  # every hour of 9 AM to 5 PM gets picked


def test_plan_never_lands_in_the_past():
    at = ny(12)
    times = bp.plan(TUE, NY, 9 * 60, 17 * 60, [], True, 3, timedelta(minutes=15), random.Random(3), at=at)
    assert times and all(t >= at + bp.LEAD_TIME for t in times)
    with pytest.raises(ValueError):
        bp.plan(TUE, NY, 9 * 60, 17 * 60, [], True, 1, timedelta(minutes=15), random.Random(3), at=datetime(2026, 11, 10, 12))


def test_window_handles_midnight_end_and_dst():
    assert bp.window(TUE, NY, 0, 24 * 60) == bp.Span(ny(0), ny(0, day=date(2026, 11, 11)))
    # March 8, 2026: New York springs forward, so 9 AM is 13:00 UTC.
    assert bp.window(date(2026, 3, 9), NY, 9 * 60, 10 * 60).start.hour == 13


def test_blocked_minutes_per_week():
    rules = [bp.BlockRule("class", 600, 690, weekday=0), bp.BlockRule("class", 600, 690, weekday=2),
             bp.BlockRule("religious", 600, 720, weekday=4), bp.BlockRule("interview", 600, 660, day=TUE)]
    assert bp.blocked_minutes_per_week(rules) == {"class": 180, "religious": 120}
