from datetime import datetime, timedelta, timezone

import pytest

from app.engine.availability import merge, rank_group_slots, subtract
from app.engine.study import plan_study_blocks

UTC = timezone.utc


def t(day, hour, minute=0):
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def test_merge_and_subtract():
    assert merge([(t(1, 9), t(1, 10)), (t(1, 10), t(1, 11)), (t(1, 13), t(1, 14))]) == [
        (t(1, 9), t(1, 11)), (t(1, 13), t(1, 14))]
    assert subtract([(t(1, 9), t(1, 17))], [(t(1, 8), t(1, 10)), (t(1, 12), t(1, 13))]) == [
        (t(1, 10), t(1, 12)), (t(1, 13), t(1, 17))]


def test_full_attendance_ranks_first_and_alternatives_name_who_is_missing():
    free = {
        "a": [(t(2, 10), t(2, 12)), (t(3, 14), t(3, 16))],
        "b": [(t(2, 10), t(2, 12)), (t(3, 14), t(3, 16))],
        "c": [(t(3, 14), t(3, 16))],
    }
    r = rank_group_slots(free, t(2, 0), t(4, 0), 60, day_start_hour=0, day_end_hour=24)
    best, alt = r.options[0], r.options[1]
    assert (best.start, best.end, best.count) == (t(3, 14), t(3, 16), 3)
    assert best.unavailable == [] and best.flexibility_minutes == 60
    assert (alt.start, alt.count, alt.unavailable) == (t(2, 10), 2, ["c"])


def test_member_without_data_is_never_counted_available():
    free = {"a": [(t(2, 10), t(2, 12))], "b": None}
    r = rank_group_slots(free, t(2, 0), t(3, 0), 60, day_start_hour=0, day_end_hour=24)
    assert r.no_data == ["b"]
    assert all("b" in o.unavailable and o.count == 1 for o in r.options)


def test_partial_overlap_does_not_count():
    free = {"a": [(t(2, 10), t(2, 11))], "b": [(t(2, 10, 30), t(2, 11, 30))]}
    r = rank_group_slots(free, t(2, 0), t(3, 0), 60, day_start_hour=0, day_end_hour=24)
    assert max(o.count for o in r.options) == 1  # only 30 minutes in common


def test_slots_not_on_step_boundaries_round_inward():
    free = {"a": [(t(2, 10, 5), t(2, 11, 20))]}
    r = rank_group_slots(free, t(2, 0), t(3, 0), 60, day_start_hour=0, day_end_hour=24)
    assert [(o.start, o.end) for o in r.options] == [(t(2, 10, 15), t(2, 11, 15))]


def test_daily_hours_use_the_local_timezone():
    # Free all day UTC. New York is UTC-5 in November, so local 8:00-23:00 leaves
    # 04:00-13:00 UTC (11 PM to 8 AM local) off limits.
    free = {"a": [(t(2, 0), t(3, 0))]}
    r = rank_group_slots(free, t(2, 0), t(3, 0), 60, tz="America/New_York", day_start_hour=8, day_end_hour=23)
    assert sorted((o.start, o.end) for o in r.options) == [(t(2, 0), t(2, 4)), (t(2, 13), t(3, 0))]


def test_no_common_time_returns_nothing_and_bad_input_raises():
    free = {"a": [(t(2, 10), t(2, 11))], "b": [(t(2, 14), t(2, 15))]}
    r = rank_group_slots(free, t(2, 0), t(3, 0), 60, day_start_hour=0, day_end_hour=24, min_attendance=2)
    assert r.options == []
    with pytest.raises(ValueError):
        rank_group_slots(free, t(2, 0), t(3, 0), 50)


def test_fifteen_people_ranked_by_attendance():
    free = {f"p{i:02d}": [(t(2, 19), t(2, 21))] for i in range(15)}
    for i in range(14):
        free[f"p{i:02d}"].append((t(3, 18), t(3, 20)))
    r = rank_group_slots(free, t(2, 0), t(4, 0), 90, day_start_hour=0, day_end_hour=24)
    assert [(o.count, o.unavailable) for o in r.options[:2]] == [(15, []), (14, ["p14"])]


def test_study_plan_hits_target_and_spreads_across_days():
    free = [(t(d, 9), t(d, 17)) for d in (2, 3, 4)]
    plan = plan_study_blocks(free, t(2, 0), t(5, 0), 360, day_start_hour=0, day_end_hour=24)
    assert plan.planned_minutes == 360 and plan.shortfall_minutes == 0
    assert sorted({b[0].day for b in plan.blocks}) == [2, 3, 4]
    assert all(timedelta(minutes=45) <= e - s <= timedelta(minutes=120) for s, e in plan.blocks)


def test_study_plan_blocks_stay_inside_free_time_and_do_not_overlap():
    free = [(t(2, 9), t(2, 10)), (t(2, 13), t(2, 18)), (t(3, 20), t(3, 22))]
    plan = plan_study_blocks(free, t(2, 0), t(4, 0), 600, day_start_hour=0, day_end_hour=24)
    for s, e in plan.blocks:
        assert any(fs <= s and e <= fe for fs, fe in free)
    for (_, e1), (s2, _) in zip(plan.blocks, plan.blocks[1:]):
        assert s2 >= e1 + timedelta(minutes=15)


def test_study_plan_reports_shortfall_and_respects_daily_cap():
    free = [(t(2, 8), t(2, 22))]
    plan = plan_study_blocks(free, t(2, 0), t(3, 0), 600, day_start_hour=0, day_end_hour=24, max_per_day=240)
    assert plan.planned_minutes == 240 and plan.shortfall_minutes == 360


def test_study_plan_ignores_chunks_shorter_than_min_block():
    plan = plan_study_blocks([(t(2, 9), t(2, 9, 30))], t(2, 0), t(3, 0), 60, day_start_hour=0, day_end_hour=24)
    assert plan.blocks == [] and plan.shortfall_minutes == 60


def test_database_url_normalization():
    from app.db import normalize_url

    assert normalize_url("postgresql://u:p@h:5432/db") == "postgresql+psycopg://u:p@h:5432/db"
    assert normalize_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("postgresql+psycopg://u@h/db") == "postgresql+psycopg://u@h/db"
    assert normalize_url("sqlite:///./plare.db") == "sqlite:///./plare.db"
