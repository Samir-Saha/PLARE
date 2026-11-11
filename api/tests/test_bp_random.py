"""BP check-ins: settings, blocked times, calendar confirmation, scheduling, and answering."""
import random
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import bp_scheduler
from app.db import SessionLocal, now
from app.models import BpDayPlan, BpPing, BusyBlock, Excuse, LogEntry, Notification, User

from .conftest import as_user

NY = ZoneInfo("America/New_York")
ON = {"enabled": True, "weekdays": [0, 1, 2, 3, 4, 5, 6], "window_start_minute": 0, "window_end_minute": 1440,
      "checks_per_day": 1, "response_minutes": 15, "class_blocks": True, "timezone": "America/New_York"}


def lead():
    return as_user("lead@t.demo")


def turn_on(client, world, **extra):
    r = client.put(f"/orgs/{world['org_a']}/bp/random/settings", json={**ON, **extra}, headers=lead())
    assert r.status_code == 200, r.text
    return r.json()


def tomorrow():
    return (datetime.now(NY).date() + timedelta(days=1))


# --- Settings ---------------------------------------------------------------------------------

def test_settings_default_off_and_only_brothers_change_them(client, world):
    r = client.get(f"/orgs/{world['org_a']}/bp/random/settings", headers=as_user("m1@t.demo")).json()
    assert r["enabled"] is False and r["class_blocks"] is True
    assert client.put(f"/orgs/{world['org_a']}/bp/random/settings", json=ON, headers=as_user("m1@t.demo")).status_code == 403
    assert client.get(f"/orgs/{world['org_a']}/bp/random/settings", headers=as_user("outsider@t.demo")).status_code == 404
    assert turn_on(client, world, weekdays=[4, 0, 0])["weekdays"] == [0, 4]


def test_settings_validation(client, world):
    url, h = f"/orgs/{world['org_a']}/bp/random/settings", lead()
    assert client.put(url, json={**ON, "timezone": "Mars/Base"}, headers=h).status_code == 422
    assert client.put(url, json={**ON, "window_start_minute": 600, "window_end_minute": 610}, headers=h).status_code == 422
    assert client.put(url, json={**ON, "checks_per_day": 4}, headers=h).status_code == 422
    assert client.put(url, json={**ON, "weekdays": [7]}, headers=h).status_code == 422


# --- Blocked times ----------------------------------------------------------------------------

def test_pledges_manage_their_own_blocks(client, world):
    h = as_user("m1@t.demo")
    r = client.post("/me/bp/random/blocks", json={"blocks": [
        {"kind": "class", "weekday": 0, "start_minute": 600, "end_minute": 690, "note": "CS 101"},
        {"kind": "interview", "day": tomorrow().isoformat(), "start_minute": 840, "end_minute": 900},
    ]}, headers=h)
    assert r.status_code == 201
    mine = r.json()
    assert [b["kind"] for b in mine] == ["class", "interview"] and mine[0]["note"] == "CS 101"
    # Others can't delete it.
    assert client.delete(f"/me/bp/blocks/{mine[0]['id']}", headers=as_user("m2@t.demo")).status_code == 404
    assert client.delete(f"/me/bp/blocks/{mine[0]['id']}", headers=h).status_code == 204
    assert len(client.get("/me/bp/random/blocks", headers=h).json()) == 1


def test_block_validation(client, world):
    h = as_user("m1@t.demo")
    bad = [
        {"kind": "class", "start_minute": 600, "end_minute": 690},                                   # neither
        {"kind": "class", "weekday": 0, "day": tomorrow().isoformat(), "start_minute": 600, "end_minute": 690},  # both
        {"kind": "class", "weekday": 0, "start_minute": 700, "end_minute": 690},                     # backwards
        {"kind": "class", "day": "2020-01-01", "start_minute": 600, "end_minute": 690},              # past
        {"kind": "party", "weekday": 0, "start_minute": 600, "end_minute": 690},                     # unknown kind
    ]
    for b in bad:
        assert client.post("/me/bp/random/blocks", json={"blocks": [b]}, headers=h).status_code == 422, b
    many = [{"kind": "work", "weekday": i % 7, "start_minute": i, "end_minute": i + 1} for i in range(60)]
    assert client.post("/me/bp/random/blocks", json={"blocks": many}, headers=h).status_code == 201
    one = {"kind": "work", "weekday": 0, "start_minute": 900, "end_minute": 960}
    assert client.post("/me/bp/random/blocks", json={"blocks": [one]}, headers=h).status_code == 422


def test_brothers_see_kinds_and_times_but_not_notes(client, world):
    client.post("/me/bp/random/blocks", json={"blocks": [
        {"kind": "religious", "weekday": 4, "start_minute": 780, "end_minute": 870, "note": "private"},
        {"kind": "class", "weekday": 0, "start_minute": 600, "end_minute": 690},
    ]}, headers=as_user("m1@t.demo"))
    assert client.get(f"/orgs/{world['org_a']}/bp/random/blocks", headers=as_user("m1@t.demo")).status_code == 403
    assert client.get(f"/orgs/{world['org_a']}/bp/random/blocks", headers=as_user("outsider@t.demo")).status_code == 404
    rows = {p["name"]: p for p in client.get(f"/orgs/{world['org_a']}/bp/random/blocks", headers=lead()).json()}
    assert set(rows) == {"m1", "m2", "m3"}
    m1 = rows["m1"]
    assert m1["weekly_minutes"] == {"religious": 90, "class": 90} and m1["recent"] == 2
    assert all("note" not in b for b in m1["blocks"])


def test_calendar_busy_times_for_confirmation(client, world):
    h = as_user("m1@t.demo")
    assert client.get("/me/bp/calendar", headers=h).json() == {"connected": False, "synced_at": None, "busy": []}
    day = tomorrow()
    start = datetime(day.year, day.month, day.day, 14, 0, tzinfo=NY)
    with SessionLocal() as db:
        u = db.get(User, world["m1"])
        u.calendar_synced_at = now()
        db.add(BusyBlock(user_id=u.id, start_at=start.astimezone(timezone.utc), end_at=(start + timedelta(hours=1)).astimezone(timezone.utc)))
        # Overnight shift, split across two days.
        late = start.replace(hour=22)
        db.add(BusyBlock(user_id=u.id, start_at=late.astimezone(timezone.utc), end_at=(late + timedelta(hours=4)).astimezone(timezone.utc)))
        db.commit()
    busy = client.get("/me/bp/calendar", headers=h).json()["busy"]
    assert [(b["day"], b["start_minute"], b["end_minute"]) for b in busy] == [
        (day.isoformat(), 840, 900), (day.isoformat(), 1320, 1440), ((day + timedelta(days=1)).isoformat(), 0, 120)]
    assert not any(b["already_blocked"] for b in busy)
    # Confirm the first one as an interview: it's then marked as already blocked.
    client.post("/me/bp/random/blocks", json={"blocks": [
        {"kind": "interview", "day": day.isoformat(), "start_minute": 840, "end_minute": 900, "source": "calendar"}]}, headers=h)
    busy = client.get("/me/bp/calendar", headers=h).json()["busy"]
    assert [b["already_blocked"] for b in busy] == [True, False, False]
    assert client.get("/me/bp/calendar?days=30", headers=h).status_code == 422


# --- Scheduler --------------------------------------------------------------------------------
THU = datetime(2026, 11, 12, 8, 0, tzinfo=NY)  # a fixed Thursday morning


def run(at, seed=1):
    with SessionLocal() as db:
        return bp_scheduler.run(db, at=at.astimezone(timezone.utc), rng=random.Random(seed))


def pings(user_id=None):
    with SessionLocal() as db:
        q = db.query(BpPing)
        if user_id:
            q = q.filter(BpPing.user_id == user_id)
        return q.order_by(BpPing.ping_at).all()


def test_plans_once_per_pledge_per_day_inside_the_window(client, world):
    turn_on(client, world, window_start_minute=9 * 60, window_end_minute=17 * 60, checks_per_day=2)
    assert run(THU)["planned"] == 6  # 3 pledges x 2; brothers never get check-ins
    assert run(THU)["planned"] == 0
    for p in pings():
        assert THU.replace(hour=9) <= p.ping_at and p.closes_at <= THU.replace(hour=17)
        assert p.closes_at - p.ping_at == timedelta(minutes=15)
    assert {p.user_id for p in pings()} == {world["m1"], world["m2"], world["m3"]}


def test_off_days_disabled_groups_blocked_days_and_excuses_get_nothing(client, world):
    assert run(THU)["planned"] == 0  # never turned on
    turn_on(client, world, weekdays=[0])  # Mondays only
    assert run(THU)["planned"] == 0
    turn_on(client, world)
    client.post("/me/bp/random/blocks", json={"blocks": [{"kind": "other", "weekday": 3, "start_minute": 0, "end_minute": 1440}]},
                headers=as_user("m1@t.demo"))
    with SessionLocal() as db:
        db.add(Excuse(org_id=world["org_a"], user_id=world["m2"], kind="bp", start_day="2026-11-12", end_day="2026-11-12",
                      reason="exam", status="approved"))
        db.commit()
    assert run(THU)["planned"] == 1  # only m3
    assert {p.user_id for p in pings()} == {world["m3"]}
    with SessionLocal() as db:
        assert {(r.user_id, r.planned) for r in db.query(BpDayPlan)} == {(world["m1"], 0), (world["m2"], 0), (world["m3"], 1)}


def test_planned_check_ins_avoid_blocks(client, world):
    turn_on(client, world, window_start_minute=9 * 60, window_end_minute=12 * 60, checks_per_day=1)
    client.post("/me/bp/random/blocks", json={"blocks": [{"kind": "interview", "day": "2026-11-12", "start_minute": 540, "end_minute": 690}]},
                headers=as_user("m1@t.demo"))
    for seed in range(5):
        with SessionLocal() as db:
            db.query(BpPing).delete()
            db.query(BpDayPlan).delete()
            db.commit()
        run(THU, seed)
        (p,) = pings(world["m1"])
        assert p.ping_at.astimezone(NY) >= THU.replace(hour=11, minute=40)  # 11:30 end + 10 min buffer


def test_open_notifies_then_missed_is_logged_once(client, world):
    turn_on(client, world, window_start_minute=9 * 60, window_end_minute=17 * 60)
    run(THU)
    p = pings(world["m1"])[0]
    assert run(p.ping_at - timedelta(seconds=1))["opened"] == 0
    assert run(p.ping_at)["opened"] >= 1
    with SessionLocal() as db:
        n = db.query(Notification).filter(Notification.user_id == world["m1"], Notification.category == "bp").one()
        assert n.link == "/app/bp" and "15 minutes" in n.body
    run(p.closes_at)
    run(p.closes_at + timedelta(minutes=5))
    with SessionLocal() as db:
        entries = db.query(LogEntry).filter(LogEntry.user_id == world["m1"], LogEntry.kind == "missed_bp_checkin").all()
        assert len(entries) == 1 and "No photo" in entries[0].detail


def test_check_ins_the_server_never_sent_are_not_logged(client, world):
    turn_on(client, world, window_start_minute=9 * 60, window_end_minute=17 * 60)
    run(THU)
    p = pings(world["m1"])[0]
    run(p.closes_at + timedelta(minutes=1))  # asleep through the whole check-in
    assert [x.response for x in pings(world["m1"])] == ["not_sent"]
    with SessionLocal() as db:
        assert db.query(LogEntry).count() == 0


def test_changing_blocks_replans_only_unopened_check_ins_today(client, world):
    turn_on(client, world)
    today = datetime.now(NY).date().isoformat()
    later = now() + timedelta(hours=1)
    with SessionLocal() as db:
        db.add(BpDayPlan(org_id=world["org_a"], user_id=world["m1"], day=today, planned=2))
        db.add(BpPing(org_id=world["org_a"], user_id=world["m1"], day=today, ping_at=later, closes_at=later + timedelta(minutes=15)))
        db.add(BpPing(org_id=world["org_a"], user_id=world["m1"], day=today, ping_at=now() - timedelta(hours=1),
                      closes_at=now() - timedelta(minutes=45), notified=True))
        db.add(BpPing(org_id=world["org_a"], user_id=world["m2"], day=today, ping_at=later, closes_at=later + timedelta(minutes=15)))
        db.commit()
    client.post("/me/bp/random/blocks", json={"blocks": [{"kind": "work", "weekday": 0, "start_minute": 60, "end_minute": 120}]},
                headers=as_user("m1@t.demo"))
    assert [p.notified for p in pings(world["m1"])] == [True]  # the sent one stays
    assert len(pings(world["m2"])) == 1  # other pledges untouched
    with SessionLocal() as db:
        assert db.query(BpDayPlan).count() == 0


# --- Answering --------------------------------------------------------------------------------

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def open_ping(world, user="m1", minutes_left=10):
    """A check-in for `user` that opened a few minutes ago."""
    with SessionLocal() as db:
        p = BpPing(org_id=world["org_a"], user_id=world[user], day=datetime.now(NY).date().isoformat(),
                   ping_at=now() - timedelta(minutes=5), closes_at=now() + timedelta(minutes=minutes_left), notified=True)
        db.add(p)
        db.commit()
        return p.id


def test_pledge_sees_open_check_in_but_never_future_times(client, world):
    turn_on(client, world)
    h = as_user("m1@t.demo")
    with SessionLocal() as db:
        later = now() + timedelta(hours=2)
        db.add(BpPing(org_id=world["org_a"], user_id=world["m1"], day=datetime.now(NY).date().isoformat(),
                      ping_at=later, closes_at=later + timedelta(minutes=15)))
        db.commit()
    future_id = pings(world["m1"])[0].id
    me = client.get(f"/orgs/{world['org_a']}/bp/random/me", headers=h).json()
    assert me["open"] is None and me["history"] == []
    assert me["today"]["still_to_come"] == 1
    # Answering a check-in before it opens looks like it doesn't exist.
    assert client.post(f"/bp/pings/{future_id}/decline", json={"reason": "class"}, headers=h).status_code == 404
    pid = open_ping(world)
    assert client.get(f"/orgs/{world['org_a']}/bp/random/me", headers=h).json()["open"]["id"] == pid
    # Brothers can't see future times either.
    today = client.get(f"/orgs/{world['org_a']}/bp/random/today", headers=lead()).json()
    m1 = next(m for m in today["members"] if m["name"] == "m1")
    assert m1["planned"] == 2 and m1["open_now"] is True
    assert all(r["id"] != future_id for r in today["recent"])


def test_photo_answer_and_private_access(client, world):
    pid = open_ping(world)
    h = as_user("m1@t.demo")
    assert client.post(f"/bp/pings/{pid}/photo", files={"photo": ("x.png", PNG, "image/png")}, headers=as_user("m2@t.demo")).status_code == 404
    assert client.post(f"/bp/pings/{pid}/photo", files={"photo": ("x.pdf", b"%PDF-1.4", "application/pdf")}, headers=h).status_code == 415
    r = client.post(f"/bp/pings/{pid}/photo", files={"photo": ("x.png", PNG, "image/png")}, headers=h)
    assert r.status_code == 200 and r.json()["response"] == "photo"
    assert client.post(f"/bp/pings/{pid}/photo", files={"photo": ("x.png", PNG, "image/png")}, headers=h).status_code == 409
    assert client.get(f"/bp/pings/{pid}/photo", headers=h).content == PNG
    assert client.get(f"/bp/pings/{pid}/photo", headers=lead()).status_code == 200
    assert client.get(f"/bp/pings/{pid}/photo", headers=as_user("m2@t.demo")).status_code == 404
    assert client.get(f"/bp/pings/{pid}/photo", headers=as_user("outsider@t.demo")).status_code == 404
    recent = client.get(f"/orgs/{world['org_a']}/bp/random/today", headers=lead()).json()["recent"]
    assert [(x["name"], x["response"], x["has_photo"]) for x in recent] == [("m1", "photo", True)]


def test_cant_right_now_is_always_available_and_not_logged(client, world):
    pid = open_ping(world)
    h = as_user("m1@t.demo")
    assert client.post(f"/bp/pings/{pid}/decline", json={"reason": "x"}, headers=h).status_code == 422
    r = client.post(f"/bp/pings/{pid}/decline", json={"reason": "In a job interview until 3"}, headers=h)
    assert r.json()["response"] == "declined"
    with SessionLocal() as db:
        bp_scheduler.run(db, at=now() + timedelta(hours=1))
        assert db.query(LogEntry).count() == 0
    recent = client.get(f"/orgs/{world['org_a']}/bp/random/today", headers=lead()).json()["recent"]
    assert recent[0]["decline_reason"] == "In a job interview until 3"


def test_closed_check_in_rejects_answers(client, world):
    with SessionLocal() as db:
        p = BpPing(org_id=world["org_a"], user_id=world["m1"], day=datetime.now(NY).date().isoformat(),
                   ping_at=now() - timedelta(minutes=30), closes_at=now() - timedelta(minutes=15), notified=True)
        db.add(p)
        db.commit()
        pid = p.id
    r = client.post(f"/bp/pings/{pid}/photo", files={"photo": ("x.png", PNG, "image/png")}, headers=as_user("m1@t.demo"))
    assert r.status_code == 409 and "closed" in r.json()["detail"]
    assert client.get(f"/orgs/{world['org_a']}/bp/random/today", headers=as_user("m1@t.demo")).status_code == 403
