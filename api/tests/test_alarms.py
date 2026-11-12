from datetime import datetime, timedelta

from sqlalchemy import select

from app.alarms import REPEAT_EVERY, tick
from app.db import SessionLocal
from app.models import DeadlineAlarm, Notification
from .conftest import as_user
from .test_api import make_task, mine

DUE = datetime.fromisoformat("2030-03-01T18:00:00Z")


def _arm(client, world):
    make_task(client, world, title="Lab report", due_at=DUE.isoformat(), assign="users", user_ids=[world["m1"]])
    assignment = mine(client, world, "m1")[0]
    r = client.post(f"/assignments/{assignment['id']}/alarm", headers=as_user("m1@t.demo"))
    assert r.status_code == 201, r.text
    return assignment, r.json()


def test_alarm_requires_opt_in_and_a_deadline(client, world):
    make_task(client, world, title="No due date", assign="users", user_ids=[world["m1"]])
    assignment = mine(client, world, "m1")[0]
    r = client.post(f"/assignments/{assignment['id']}/alarm", headers=as_user("m1@t.demo"))
    assert r.status_code == 422
    # Without opt-in, a tick at the deadline creates nothing.
    make_task(client, world, title="Has due", due_at=DUE.isoformat(), assign="users", user_ids=[world["m2"]])
    with SessionLocal() as db:
        assert tick(db, DUE) == 0


def test_alarm_rings_at_deadline_and_math_is_checked_on_the_server(client, world):
    assignment, _ = _arm(client, world)
    with SessionLocal() as db:
        assert tick(db, DUE - timedelta(minutes=1)) == 0
        assert tick(db, DUE) == 1
    mine_alarms = client.get("/alarms/mine", headers=as_user("m1@t.demo")).json()
    assert len(mine_alarms) == 1
    alarm = mine_alarms[0]
    assert alarm["status"] == "ringing"
    assert alarm["operand_a"] is not None and alarm["operand_b"] is not None
    # Another person cannot solve it.
    assert client.post(f"/alarms/{alarm['id']}/solve", headers=as_user("m2@t.demo"),
                       json={"answer": alarm["operand_a"] + alarm["operand_b"]}).status_code == 404
    wrong = client.post(f"/alarms/{alarm['id']}/solve", headers=as_user("m1@t.demo"), json={"answer": -1})
    assert wrong.status_code == 422
    right = client.post(f"/alarms/{alarm['id']}/solve", headers=as_user("m1@t.demo"),
                        json={"answer": alarm["operand_a"] + alarm["operand_b"]})
    assert right.status_code == 200, right.text
    assert right.json()["status"] == "stopped"
    with SessionLocal() as db:
        notes = db.scalars(select(Notification).where(Notification.category == "alarm")).all()
        assert len(notes) == 1


def test_alarm_is_always_dismissible_and_repeats_after_fifteen_minutes(client, world):
    _arm(client, world)
    with SessionLocal() as db:
        assert tick(db, DUE) == 1
        assert tick(db, DUE + timedelta(minutes=5)) == 0
        assert tick(db, DUE + REPEAT_EVERY) == 1
    alarm = client.get("/alarms/mine", headers=as_user("m1@t.demo")).json()[0]
    r = client.post(f"/alarms/{alarm['id']}/dismiss", headers=as_user("m1@t.demo"))
    assert r.status_code == 200
    assert r.json()["status"] == "dismissed"
    with SessionLocal() as db:
        assert tick(db, DUE + REPEAT_EVERY * 2) == 0
        notes = db.scalars(select(Notification).where(Notification.category == "alarm")).all()
        assert len(notes) == 2
