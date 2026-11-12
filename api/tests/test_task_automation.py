from datetime import datetime, timedelta

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import Assignment, Membership, Notification, Task, TaskStatus
from .conftest import as_user
from .test_api import make_task, mine

FIRST = datetime.fromisoformat("2030-01-10T18:00:00Z")


def templates_url(world):
    return f"/orgs/{world['org_a']}/task-templates"


def create_template(client, world, **extra):
    r = client.post(templates_url(world), headers=as_user("lead@t.demo"), json={
        "title": "Weekly report", "description": "Write a report", "evidence": "text",
        "category": "Reports", "priority": "high", "estimate_minutes": 60,
        "due_at": FIRST.isoformat(), "frequency": "weekly", "timezone": "America/New_York", **extra,
    })
    assert r.status_code == 201, r.text
    return r.json()


def run_recurring(at):
    from app.task_automation import generate_recurring_tasks
    with SessionLocal() as db:
        return generate_recurring_tasks(db, at)


def run_reminders(at):
    from app.task_automation import send_task_reminders
    with SessionLocal() as db:
        return send_task_reminders(db, at)


def reminder_notes():
    with SessionLocal() as db:
        return db.scalars(select(Notification).where(Notification.category == "task_reminder")).all()


def test_template_creates_ordinary_tasks_with_independent_review_history(client, world):
    template = create_template(client, world)
    first = mine(client, world)[0]
    assert (first["title"], first["priority"], first["estimate_minutes"], first["evidence"]) == (
        "Weekly report", "high", 60, "text")
    assert run_recurring(FIRST - timedelta(seconds=1)) == 0
    assert client.post(f"/assignments/{first['id']}/submissions", data={"text": "First report"},
                       headers=as_user("m1@t.demo")).status_code == 201
    queue = client.get(f"/orgs/{world['org_a']}/review", headers=as_user("lead@t.demo")).json()
    assert client.post(f"/submissions/{queue[0]['id']}/review", json={"decision": "approved"},
                       headers=as_user("lead@t.demo")).status_code == 200
    assert run_recurring(FIRST) == 1
    assert run_recurring(FIRST) == 0
    tasks = mine(client, world)
    assert len(tasks) == 2
    assert {t["status"] for t in tasks} == {"approved", "not_started"}
    assert {datetime.fromisoformat(t["due_at"]) for t in tasks} == {FIRST, FIRST + timedelta(days=7)}
    listing = client.get(templates_url(world), headers=as_user("lead@t.demo")).json()
    assert listing[0]["id"] == template["id"]


@pytest.mark.parametrize("who,status", [(None, 401), ("m1", 403), ("outsider", 404)])
def test_template_routes_enforce_group_and_lead_permissions(client, world, who, status):
    template = create_template(client, world)
    headers = as_user(f"{who}@t.demo") if who else {}
    url = templates_url(world)
    assert client.get(url, headers=headers).status_code == status
    assert client.post(url, json={"title": "x", "due_at": FIRST.isoformat(), "frequency": "daily",
                                  "timezone": "UTC"}, headers=headers).status_code == status
    assert client.patch(f"{url}/{template['id']}", json={"status": "paused"}, headers=headers).status_code == status


@pytest.mark.parametrize("extra", [
    {"due_at": None}, {"due_at": "2030-01-10T18:00:00"}, {"due_at": "2020-01-01T00:00:00Z"},
    {"frequency": "monthly"}, {"timezone": "Not/AZone"}, {"title": "   "},
    {"ends_at": "2030-01-10T17:59:59Z"}, {"ends_at": "2030-01-20T18:00:00"},
    {"assign": "users", "user_ids": []},
])
def test_template_input_is_validated_without_creating_tasks(client, world, extra):
    body = {"title": "x", "due_at": FIRST.isoformat(), "frequency": "daily", "timezone": "UTC", **extra}
    assert client.post(templates_url(world), json=body, headers=as_user("lead@t.demo")).status_code == 422
    assert mine(client, world) == []


def test_template_cannot_assign_people_from_another_group(client, world):
    r = client.post(templates_url(world), json={"title": "x", "due_at": FIRST.isoformat(),
        "frequency": "daily", "timezone": "UTC", "assign": "users", "user_ids": [world["outsider"]]},
        headers=as_user("lead@t.demo"))
    assert r.status_code == 422


def test_pause_resume_skips_missed_cycles_and_end_is_permanent(client, world):
    t = create_template(client, world, frequency="daily")
    url = f"{templates_url(world)}/{t['id']}"
    h = as_user("lead@t.demo")
    assert client.patch(url, json={"status": "paused"}, headers=h).status_code == 200
    assert run_recurring(FIRST + timedelta(days=10)) == 0
    assert client.patch(url, json={"status": "active"}, headers=h).status_code == 200
    assert run_recurring(FIRST + timedelta(days=10)) == 1
    assert {datetime.fromisoformat(t["due_at"]) for t in mine(client, world)} == {FIRST, FIRST + timedelta(days=11)}
    assert client.patch(url, json={"status": "ended"}, headers=h).status_code == 200
    assert run_recurring(FIRST + timedelta(days=30)) == 0
    assert client.patch(url, json={"status": "active"}, headers=h).status_code == 409
    # Template ids cannot be used through another group's URL.
    assert client.patch(f"/orgs/{world['org_b']}/task-templates/{t['id']}", json={"status": "paused"},
                        headers=as_user("outsider@t.demo")).status_code == 404


def test_final_deadline_is_inclusive(client, world):
    create_template(client, world, frequency="daily", ends_at="2030-01-11T18:00:00Z")
    assert run_recurring(FIRST) == 1
    assert run_recurring(FIRST + timedelta(days=1)) == 0
    assert len(mine(client, world)) == 2
    assert client.get(templates_url(world), headers=as_user("lead@t.demo")).json()[0]["status"] == "ended"


@pytest.mark.parametrize("mode", ["all_members", "users", "open"])
def test_assignment_modes_and_removed_members(client, world, mode):
    create_template(client, world, assign=mode, user_ids=[world["m1"], world["m2"]] if mode == "users" else [])
    with SessionLocal() as db:
        db.execute(delete(Membership).where(Membership.user_id == world["m2"]))
        db.commit()
    assert run_recurring(FIRST) == 1
    with SessionLocal() as db:
        latest = db.scalar(select(Task).where(Task.due_at == FIRST + timedelta(days=7)))
        people = set(db.scalars(select(Assignment.user_id).where(Assignment.task_id == latest.id)))
        assert people == ({world["m1"], world["m3"]} if mode == "all_members" else
                          {world["m1"]} if mode == "users" else set())
    if mode == "open":
        assert client.post(f"/tasks/{latest.id}/claim", headers=as_user("m1@t.demo")).status_code == 201


def test_reminders_are_once_per_window_and_survive_new_sessions(client, world):
    make_task(client, world, due_at=FIRST.isoformat())
    assert run_reminders(FIRST - timedelta(hours=25)) == 0
    assert run_reminders(FIRST - timedelta(hours=24)) == 3
    assert run_reminders(FIRST - timedelta(hours=2)) == 0
    assert run_reminders(FIRST - timedelta(hours=1)) == 3
    assert run_reminders(FIRST) == 3
    assert run_reminders(FIRST + timedelta(days=10)) == 0
    notes = reminder_notes()
    assert len(notes) == 9
    assert {n.user_id for n in notes} == {world["m1"], world["m2"], world["m3"]}
    assert all(n.link.startswith("/app/tasks") for n in notes)


@pytest.mark.parametrize("status", ["submitted", "approved"])
def test_submitted_and_approved_work_is_not_reminded(client, world, status):
    make_task(client, world, due_at=FIRST.isoformat())
    with SessionLocal() as db:
        for a in db.scalars(select(Assignment)):
            a.status = status
        db.commit()
    assert run_reminders(FIRST) == 0
    assert reminder_notes() == []


def test_late_scheduler_sends_only_overdue_and_skips_former_members(client, world):
    make_task(client, world, due_at=FIRST.isoformat())
    with SessionLocal() as db:
        db.execute(delete(Membership).where(Membership.user_id == world["m2"]))
        db.commit()
    assert run_reminders(FIRST + timedelta(hours=3)) == 2
    assert all("overdue" in n.title.lower() for n in reminder_notes())
    assert {n.user_id for n in reminder_notes()} == {world["m1"], world["m3"]}


def test_deleted_and_undated_tasks_are_excluded(client, world):
    make_task(client, world)
    tid = make_task(client, world, due_at=FIRST.isoformat())["id"]
    with SessionLocal() as db:
        db.get(Task, tid).deleted_at = FIRST
        db.commit()
    assert run_reminders(FIRST) == 0


def test_revision_still_needs_a_deadline_reminder(client, world):
    make_task(client, world, due_at=FIRST.isoformat())
    with SessionLocal() as db:
        for a in db.scalars(select(Assignment)):
            a.status = TaskStatus.needs_revision
        db.commit()
    assert run_reminders(FIRST) == 3


def test_cron_generates_next_occurrence_and_task_reminders(client, world, monkeypatch):
    from app import task_automation
    from app.config import get_settings
    create_template(client, world, frequency="daily")
    monkeypatch.setattr(task_automation, "now", lambda: FIRST)
    monkeypatch.setattr(get_settings(), "cron_secret", "test-secret")
    r = client.post("/cron/tick", headers={"X-Cron-Secret": "test-secret"})
    assert r.status_code == 200
    assert len(mine(client, world)) == 2
    assert len(reminder_notes()) == 6  # first overdue, next due in 24 hours
    assert client.post("/cron/tick", headers={"X-Cron-Secret": "test-secret"}).status_code == 200
    assert len(reminder_notes()) == 6


def test_occurrence_claim_rolls_back_an_attempt_to_create_the_same_cycle(client, world):
    from app.models import TaskTemplate
    t = create_template(client, world)
    assert run_recurring(FIRST) == 1
    with SessionLocal() as db:
        db.get(TaskTemplate, t["id"]).next_run_at = FIRST
        db.commit()
    assert run_recurring(FIRST) == 0
    assert len(mine(client, world)) == 2
    with SessionLocal() as db:
        assert db.query(Task).count() == 2
        assert db.query(Notification).filter_by(category="task").count() == 6


def test_task_reminders_follow_existing_push_quiet_hours(client, world, monkeypatch):
    from app import push
    from app.db import now
    from app.models import NotificationPrefs, PushDelivery, PushSubscription
    at = now()
    make_task(client, world, due_at=(at + timedelta(hours=2)).isoformat())
    with SessionLocal() as db:
        # Whole local day except a minute far from now.
        from zoneinfo import ZoneInfo
        local = at.astimezone(ZoneInfo("America/New_York"))
        minute = local.hour * 60 + local.minute
        db.add(NotificationPrefs(user_id=world["m1"], quiet_start_minute=minute,
                                 quiet_end_minute=(minute + 60) % 1440))
        db.add(PushSubscription(user_id=world["m1"], endpoint="https://push.example.test/1", p256dh="k", auth="a"))
        db.commit()
    assert run_reminders(at) == 3
    monkeypatch.setattr(push, "configured", lambda: True)
    delivered = []
    monkeypatch.setattr(push, "send_one", lambda sub, payload: delivered.append(payload))
    with SessionLocal() as db:
        assert push.send_pending(db) == 0
        assert db.query(PushDelivery).filter_by(status="quiet").count() >= 1
    assert delivered == []
    assert len(client.get("/notifications", headers=as_user("m1@t.demo")).json()) == 2


def test_submitting_work_clears_its_unread_deadline_reminders(client, world):
    make_task(client, world, due_at=FIRST.isoformat())
    assert run_reminders(FIRST) == 3
    assignment = mine(client, world)[0]
    assert client.post(f"/assignments/{assignment['id']}/submissions", data={"text": "Done"},
                       headers=as_user("m1@t.demo")).status_code == 201
    notes = client.get("/notifications", headers=as_user("m1@t.demo")).json()
    assert all(n["read"] for n in notes if n["category"] == "task_reminder")
    # Other people's unread reminders are unaffected.
    others = client.get("/notifications", headers=as_user("m2@t.demo")).json()
    assert any(not n["read"] for n in others if n["category"] == "task_reminder")


def test_new_window_replaces_stale_unread_reminders(client, world):
    make_task(client, world, due_at=FIRST.isoformat())
    run_reminders(FIRST - timedelta(hours=24))
    run_reminders(FIRST - timedelta(hours=1))
    notes = client.get("/notifications", headers=as_user("m1@t.demo")).json()
    assert len([n for n in notes if n["category"] == "task_reminder" and not n["read"]]) == 1
