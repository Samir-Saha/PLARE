import random
from datetime import datetime, timedelta, timezone

import pytest

from app.engine.group_study import Hour, credited_hours, hour_status, hours_started, ping_offset

UTC = timezone.utc
START = datetime(2026, 11, 10, 19, 0, tzinfo=UTC)
M = timedelta(minutes=1)


def hour(index=0, ping_min=20, window=10, confirmed=()):
    start = START + timedelta(hours=index)
    ping = start + ping_min * M
    return Hour(index, start, ping, ping + window * M, set(confirmed))


def test_ping_always_lands_inside_the_hour_with_room_for_the_window():
    rng = random.Random(1)
    offsets = [ping_offset(10, rng) for _ in range(2000)]
    assert min(offsets) >= 5 * M
    assert max(offsets) + 10 * M <= 55 * M
    # Actually random: many distinct times, not one fixed minute.
    assert len(set(offsets)) > 500


def test_window_too_long_is_rejected():
    with pytest.raises(ValueError):
        ping_offset(55, random.Random(0))


def test_hours_started():
    assert hours_started(START, START - M) == 0
    assert hours_started(START, START) == 1
    assert hours_started(START, START + 59 * M) == 1
    assert hours_started(START, START + 60 * M) == 2


def test_status_moves_through_the_hour():
    seven = [f"p{i}" for i in range(7)]
    h = hour(confirmed=seven)
    assert hour_status(h, 7, START + 10 * M, None) == "waiting"
    assert hour_status(h, 7, START + 25 * M, None) == "open"
    assert hour_status(h, 7, START + 40 * M, None) == "on_track"
    assert hour_status(h, 7, START + 61 * M, None) == "counted"


def test_six_confirmations_is_short_and_nobody_gets_credit():
    h = hour(confirmed=[f"p{i}" for i in range(6)])
    assert hour_status(h, 7, START + 61 * M, None) == "short"
    assert credited_hours([h], 7, START + 61 * M, None) == {}


def test_only_confirmers_get_credit_for_counted_hours():
    h0 = hour(0, confirmed=[f"p{i}" for i in range(8)])
    h1 = hour(1, confirmed=[f"p{i}" for i in range(7)])  # p7 missed this ping
    credit = credited_hours([h0, h1], 7, START + 125 * M, None)
    assert credit["p0"] == 2 and credit["p7"] == 1 and "p8" not in credit


def test_ending_early_means_the_hour_does_not_count():
    h = hour(confirmed=[f"p{i}" for i in range(9)])
    ended = START + 45 * M  # after the ping closed, before the hour finished
    assert hour_status(h, 7, START + 50 * M, ended) == "incomplete"
    assert credited_hours([h], 7, START + 2 * 60 * M, ended) == {}
    # Ended before the ping even opened.
    assert hour_status(h, 7, START + 50 * M, START + 10 * M) == "incomplete"
