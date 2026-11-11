from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.engine import gm as rules
from app.models import GmReminder, Notification
from app.routers import gm

from .conftest import as_user

NY = "America/New_York"
UTC = timezone.utc
# Tue Nov 10 2026: New York is UTC-5, so 6:00 AM local is 11:00 UTC.
DUE = datetime(2026, 11, 10, 11, 0, tzinfo=UTC)


# ---- engine ----------------------------------------------------------------------------

def test_due_at_is_local_time_and_handles_dst():
    assert rules.due_at(date(2026, 11, 10), 360, NY) == DUE
    # Summer (UTC-4): 6:00 AM is 10:00 UTC.
    assert rules.due_at(date(2026, 7, 1), 360, NY) == datetime(2026, 7, 1, 10, 0, tzinfo=UTC)


def test_local_day_uses_group_timezone():
    late_night = datetime(2026, 11, 11, 3, 0, tzinfo=UTC)  # 10 PM on Nov 10 in New York
    assert rules.local_day(late_night, NY) == date(2026, 11, 10)
    with pytest.raises(ValueError):
        rules.local_day(datetime(2026, 11, 10), NY)


def test_reminder_window_is_ten_minutes_before_due():
    assert rules.reminder_at(date(2026, 11, 10), 360, 10, NY) == DUE - timedelta(minutes=10)
    assert not rules.should_remind(DUE - timedelta(minutes=11), DUE, 10)
    assert rules.should_remind(DUE - timedelta(minutes=10), DUE, 10)
    assert rules.should_remind(DUE - timedelta(seconds=1), DUE, 10)
    assert not rules.should_remind(DUE, DUE, 10)


def test_code_matching_and_flags():
    assert rules.code_status("  Lantern ", "lantern") == "ok"
    assert rules.code_status("lan tern", "lantern") == "wrong"
    assert rules.code_status("anything", None) == "unset"
    assert rules.flags(DUE, DUE, "lantern", "lantern") == []  # exactly on the deadline is on time
    assert rules.flags(DUE + timedelta(seconds=1), DUE, "x", "lantern") == ["late", "wrong_code"]
    assert rules.flags(DUE + timedelta(minutes=5), DUE, "x", None) == ["late"]


# ---- API -------------------------------------------------------------------------------

@pytest.fixture
def clock(monkeypatch):
    """Freeze the GM router's clock. Call clock(dt) to move it."""
    state = {"at": DUE - timedelta(hours=1)}
    monkeypatch.setattr(gm, "now", lambda: state["at"])

    def set_(at: datetime):
        state["at"] = at
    return set_


def url(world, path=""):
    return f"/orgs/{world['org_a']}/gm{path}"


def send(client, world, who="m1", code="lantern", goal="Finish the problem set."):
    return client.post(url(world), json={"goal": goal, "code": code}, headers=as_user(f"{who}@t.demo"))


def set_code(client, world, day="2026-11-10", code="lantern", who="lead"):
    return client.put(url(world, f"/codes/{day}"), json={"code": code}, headers=as_user(f"{who}@t.demo"))


def test_default_settings_are_six_am_with_ten_minute_reminder(client, world, clock):
    r = client.get(url(world, "/settings"), headers=as_user("m1@t.demo")).json()
    assert (r["due_minute"], r["reminder_minutes"], r["timezone"]) == (360, 10, NY)
    assert r["day"] == "2026-11-10"
    assert r["due_at"].startswith("2026-11-10T11:00:00")
    assert r["reminder_at"].startswith("2026-11-10T10:50:00")


def test_only_leads_change_settings_codes_and_read_inbox(client, world, clock):
    m = as_user("m1@t.demo")
    assert client.patch(url(world, "/settings"), json={"due_minute": 420}, headers=m).status_code == 403
    assert set_code(client, world, who="m1").status_code == 403
    assert client.get(url(world, "/inbox"), headers=m).status_code == 403
    assert client.get(url(world, "/codes"), headers=m).status_code == 403
    r = client.patch(url(world, "/settings"), json={"due_minute": 420, "reminder_minutes": 15}, headers=as_user("lead@t.demo"))
    assert r.status_code == 200 and r.json()["reminder_at"].startswith("2026-11-10T11:45:00")


def test_settings_validation(client, world, clock):
    h = as_user("admin@t.demo")
    assert client.patch(url(world, "/settings"), json={"due_minute": 5}, headers=h).status_code == 422
    assert client.patch(url(world, "/settings"), json={"timezone": "Mars/Base"}, headers=h).status_code == 422


def test_other_groups_get_404(client, world, clock):
    h = as_user("outsider@t.demo")
    for path in ("/settings", "/me", "/inbox", "/codes"):
        assert client.get(url(world, path), headers=h).status_code == 404, path
    assert send(client, world, who="outsider").status_code == 404
    assert set_code(client, world, who="outsider").status_code == 404


def test_leads_cannot_send_and_members_send_once_per_day(client, world, clock):
    assert send(client, world, who="lead").status_code == 403
    assert send(client, world).status_code == 201
    r = send(client, world)
    assert r.status_code == 409 and "tomorrow" in r.json()["detail"]
    clock(DUE + timedelta(days=1) - timedelta(hours=1))
    assert send(client, world).status_code == 201


def test_members_see_todays_code_but_not_future_ones(client, world, clock):
    h = as_user("m1@t.demo")
    assert client.get(url(world, "/me"), headers=h).json()["code"] is None
    set_code(client, world, day="2026-11-11", code="tomorrow-word")
    set_code(client, world, code="lantern")
    me = client.get(url(world, "/me"), headers=h).json()
    assert me["code"] == "lantern" and "tomorrow-word" not in str(me)
    clock(DUE + timedelta(days=1) - timedelta(hours=1))
    assert client.get(url(world, "/me"), headers=h).json()["code"] == "tomorrow-word"


def test_posting_todays_code_notifies_members_who_havent_sent(client, world, clock):
    send(client, world, who="m1")
    set_code(client, world, day="2026-11-12")  # a future day: no one is told yet
    assert not client.get("/notifications", headers=as_user("m2@t.demo")).json()
    set_code(client, world)
    titles = [n["title"] for n in client.get("/notifications", headers=as_user("m2@t.demo")).json()]
    assert titles == ["Today's GM code word is up"]
    assert not [n for n in client.get("/notifications", headers=as_user("m1@t.demo")).json() if not n["read"]]


def test_inbox_flags_late_wrong_and_missing(client, world, clock):
    set_code(client, world)
    clock(DUE - timedelta(minutes=30))
    send(client, world, who="m1", code="Lantern")      # on time, case-insensitive
    send(client, world, who="m2", code="lamp")         # wrong code
    lead = as_user("lead@t.demo")

    before = client.get(url(world, "/inbox"), headers=lead).json()
    assert before["past_due"] is False
    assert before["counts"]["missing"] == 0           # m3 still has time
    assert [p["name"] for p in before["not_sent"]] == ["m3"]

    clock(DUE + timedelta(minutes=3))
    send(client, world, who="m3")                       # late
    after = client.get(url(world, "/inbox"), headers=lead).json()
    flags = {m["user_name"]: m["flags"] for m in after["messages"]}
    assert flags == {"m1": [], "m2": ["wrong_code"], "m3": ["late"]}
    assert after["code"] == "lantern"
    assert after["counts"] == {"members": 3, "sent": 3, "on_time": 1, "flagged": 2, "missing": 0}
    assert {m["user_name"]: m["code_given"] for m in after["messages"]}["m2"] == "lamp"


def test_missing_after_deadline_and_code_changes_reflag(client, world, clock):
    clock(DUE - timedelta(minutes=5))
    send(client, world, who="m1", code="harbor")
    clock(DUE + timedelta(minutes=1))
    lead = as_user("lead@t.demo")
    r = client.get(url(world, "/inbox"), headers=lead).json()
    assert r["code"] is None and r["messages"][0]["code_status"] == "unset"
    assert r["counts"]["missing"] == 2
    set_code(client, world, code="harbor")
    r = client.get(url(world, "/inbox"), headers=lead).json()
    assert r["messages"][0]["flags"] == [] and r["messages"][0]["code_status"] == "ok"


def test_past_day_inbox_and_code_range(client, world, clock):
    lead = as_user("lead@t.demo")
    assert client.get(url(world, "/inbox?day=2026-11-09"), headers=lead).json()["day"] == "2026-11-09"
    assert client.get(url(world, "/inbox?day=nope"), headers=lead).status_code == 422
    assert set_code(client, world, day="2026-11-11").status_code == 200
    assert set_code(client, world, day="2027-06-01").status_code == 422
    assert [c["day"] for c in client.get(url(world, "/codes"), headers=lead).json()] == ["2026-11-11"]


def test_changing_due_time_does_not_rewrite_past_lateness(client, world, clock):
    clock(DUE + timedelta(minutes=20))
    send(client, world)
    client.patch(url(world, "/settings"), json={"due_minute": 7 * 60}, headers=as_user("admin@t.demo"))
    me = client.get(url(world, "/me"), headers=as_user("m1@t.demo")).json()
    assert me["today"]["late"] is True


def test_reminders_go_to_members_who_havent_sent_once(client, world, clock):
    client.get(url(world, "/settings"), headers=as_user("lead@t.demo"))  # creates default settings
    send(client, world, who="m1")
    with SessionLocal() as db:
        assert gm.send_gm_reminders(db, DUE - timedelta(minutes=11)) == 0   # too early
        assert gm.send_gm_reminders(db, DUE - timedelta(minutes=10)) == 2   # m2, m3
        assert gm.send_gm_reminders(db, DUE - timedelta(minutes=5)) == 0    # no duplicates
        assert gm.send_gm_reminders(db, DUE + timedelta(minutes=1)) == 0    # past due
        notes = db.scalars(select(Notification).where(Notification.category == "gm")).all()
        assert sorted(n.user_id for n in notes) == sorted([world["m2"], world["m3"]])
        assert all(n.link == "/app/gm" for n in notes)
        assert all("due at 6:00 AM" in n.body for n in notes)
        assert db.scalar(select(GmReminder).where(GmReminder.user_id == world["lead"])) is None


def test_reminders_respect_disabled_groups(client, world, clock):
    client.patch(url(world, "/settings"), json={"enabled": False}, headers=as_user("admin@t.demo"))
    with SessionLocal() as db:
        assert gm.send_gm_reminders(db, DUE - timedelta(minutes=5)) == 0
    assert send(client, world).status_code == 409


def test_dismissing_one_notification_leaves_others_unread(client, world, clock):
    client.get(url(world, "/settings"), headers=as_user("lead@t.demo"))
    with SessionLocal() as db:
        gm.send_gm_reminders(db, DUE - timedelta(minutes=5))
    h = as_user("m2@t.demo")
    with SessionLocal() as db:
        from app.auth import notify
        notify(db, world["m2"], world["org_a"], "task", "Other")
        db.commit()
    notes = client.get("/notifications", headers=h).json()
    gm_id = next(n["id"] for n in notes if n["category"] == "gm")
    assert client.post("/notifications/read", json={"ids": [gm_id]}, headers=h).status_code == 204
    read = {n["category"]: n["read"] for n in client.get("/notifications", headers=h).json()}
    assert read == {"gm": True, "task": False}
    # Someone else's id does nothing.
    other = client.get("/notifications", headers=as_user("m3@t.demo")).json()[0]["id"]
    client.post("/notifications/read", json={"ids": [other]}, headers=h)
    assert client.get("/notifications", headers=as_user("m3@t.demo")).json()[0]["read"] is False


def test_sending_clears_the_reminder(client, world, clock):
    client.get(url(world, "/settings"), headers=as_user("lead@t.demo"))
    with SessionLocal() as db:
        gm.send_gm_reminders(db, DUE - timedelta(minutes=5))
    h = as_user("m1@t.demo")
    assert client.get("/notifications", headers=h).json()[0]["read"] is False
    send(client, world)
    assert client.get("/notifications", headers=h).json()[0]["read"] is True
