from datetime import datetime, timedelta, timezone

from app.db import now
from app.engine.planner import WorkItem, plan_work, suggest_owners

from .conftest import as_user

UTC = timezone.utc


def t(day, hour, minute=0):
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


# ---------- engine ----------

def test_earliest_deadline_goes_first_even_if_listed_later():
    free = [(t(2, 9), t(2, 11, 30))]
    plan = plan_work(free, [WorkItem("late", t(5, 0), 60), WorkItem("soon", t(2, 10), 60)], t(2, 8))
    assert [(s.task_id, s.start) for s in plan.sessions] == [("soon", t(2, 9)), ("late", t(2, 10, 10))]
    assert plan.at_risk == {}


def test_sessions_never_pass_their_deadline_and_shortfall_is_reported():
    free = [(t(2, 9), t(2, 10)), (t(3, 9), t(3, 12))]
    plan = plan_work(free, [WorkItem("a", t(2, 23), 120)], t(2, 8))
    assert [(s.start, s.end) for s in plan.sessions] == [(t(2, 9), t(2, 10))]
    assert plan.at_risk == {"a": 60}


def test_long_tasks_split_into_blocks_with_breaks():
    plan = plan_work([(t(2, 9), t(2, 18))], [WorkItem("big", t(3, 0), 300)], t(2, 8), max_block=120, break_minutes=10)
    assert [s.minutes for s in plan.sessions] == [120, 120, 60]
    for a, b in zip(plan.sessions, plan.sessions[1:]):
        assert b.start >= a.end + timedelta(minutes=10)


def test_short_task_can_use_a_short_gap_but_long_task_cannot():
    free = [(t(2, 9), t(2, 9, 20))]
    assert plan_work(free, [WorkItem("tiny", t(3, 0), 15)], t(2, 8)).at_risk == {}
    assert plan_work(free, [WorkItem("big", t(3, 0), 90)], t(2, 8)).at_risk == {"big": 90}


def test_overdue_and_past_free_time_are_ignored():
    free = [(t(2, 6), t(2, 12))]
    plan = plan_work(free, [WorkItem("old", t(2, 7), 30), WorkItem("ok", t(3, 0), 30)], t(2, 10))
    assert plan.at_risk == {"old": 30}
    assert plan.sessions[0].start == t(2, 10)


def test_suggest_owners_prefers_spare_time_and_never_trusts_missing_data():
    ranked = suggest_owners(
        {
            "busy": ([(t(2, 9), t(2, 17))], 400),   # 480 free, 400 committed -> 80 spare
            "free": ([(t(2, 9), t(2, 12))], 0),     # 180 spare
            "ghost": (None, 0),                     # no availability given
        },
        t(2, 0), t(3, 0), 120,
    )
    assert [(o.user, fits) for o, fits in ranked] == [("free", True), ("busy", False), ("ghost", False)]


# ---------- API ----------

def test_my_plan_and_suggest_and_assign(client, world):
    org, lead, m1 = world["org_a"], as_user("lead@t.demo"), as_user("m1@t.demo")
    every_day = [{"weekday": d, "start_minute": 9 * 60, "end_minute": 21 * 60} for d in range(7)]
    for who in ("m1", "m2"):
        assert client.put("/availability/me", json={"rules": every_day}, headers=as_user(f"{who}@t.demo")).status_code == 200

    due = (now() + timedelta(days=3)).isoformat()
    client.post(f"/orgs/{org}/tasks", json={"title": "Write-up", "due_at": due, "estimate_minutes": 90, "assign": "users", "user_ids": [world["m1"]]}, headers=lead)
    plan = client.get(f"/orgs/{org}/plan/mine", headers=m1).json()
    assert plan["has_availability"] and plan["at_risk"] == []
    assert sum(s["minutes"] for s in plan["sessions"]) == 90
    assert all(s["end"] <= due for s in plan["sessions"])

    # No availability at all: the plan says so instead of inventing time.
    assert client.get(f"/orgs/{org}/plan/mine", headers=as_user("m3@t.demo")).json()["has_availability"] is False

    open_id = client.post(f"/orgs/{org}/tasks", json={"title": "Book room", "due_at": due, "estimate_minutes": 60, "assign": "open"}, headers=lead).json()["id"]
    assert client.get(f"/tasks/{open_id}/suggest-owners", headers=m1).status_code == 403
    assert client.get(f"/tasks/{open_id}/suggest-owners", headers=as_user("outsider@t.demo")).status_code == 404
    options = client.get(f"/tasks/{open_id}/suggest-owners", headers=lead).json()["options"]
    # m2 has the same free time as m1 but no other open work, so m2 ranks first; m3 gave no availability.
    assert options[0]["name"] == "m2" and options[0]["fits"] is True
    assert next(o for o in options if o["name"] == "m3")["fits"] is False

    assert client.post(f"/tasks/{open_id}/assign", json={"user_id": world["outsider"]}, headers=lead).status_code == 422
    assert client.post(f"/tasks/{open_id}/assign", json={"user_id": world["m2"]}, headers=m1).status_code == 403
    assert client.post(f"/tasks/{open_id}/assign", json={"user_id": world["m2"]}, headers=lead).status_code == 201
    assert client.post(f"/tasks/{open_id}/assign", json={"user_id": world["m2"]}, headers=lead).status_code == 409
    # Once owned, it's no longer open for claiming.
    assert client.get(f"/orgs/{org}/tasks/open", headers=m1).json() == []
