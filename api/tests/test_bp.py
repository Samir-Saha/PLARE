"""BP check-ins: settings, blocked times, calendar confirmation, scheduling, and answering."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.db import SessionLocal, now
from app.models import BusyBlock, User

from .conftest import as_user

NY = ZoneInfo("America/New_York")
ON = {"enabled": True, "weekdays": [0, 1, 2, 3, 4, 5, 6], "window_start_minute": 0, "window_end_minute": 1440,
      "checks_per_day": 1, "response_minutes": 15, "class_blocks": True, "timezone": "America/New_York"}


def lead():
    return as_user("lead@t.demo")


def turn_on(client, world, **extra):
    r = client.put(f"/orgs/{world['org_a']}/bp/settings", json={**ON, **extra}, headers=lead())
    assert r.status_code == 200, r.text
    return r.json()


def tomorrow():
    return (datetime.now(NY).date() + timedelta(days=1))


# --- Settings ---------------------------------------------------------------------------------

def test_settings_default_off_and_only_brothers_change_them(client, world):
    r = client.get(f"/orgs/{world['org_a']}/bp/settings", headers=as_user("m1@t.demo")).json()
    assert r["enabled"] is False and r["class_blocks"] is True
    assert client.put(f"/orgs/{world['org_a']}/bp/settings", json=ON, headers=as_user("m1@t.demo")).status_code == 403
    assert client.get(f"/orgs/{world['org_a']}/bp/settings", headers=as_user("outsider@t.demo")).status_code == 404
    assert turn_on(client, world, weekdays=[4, 0, 0])["weekdays"] == [0, 4]


def test_settings_validation(client, world):
    url, h = f"/orgs/{world['org_a']}/bp/settings", lead()
    assert client.put(url, json={**ON, "timezone": "Mars/Base"}, headers=h).status_code == 422
    assert client.put(url, json={**ON, "window_start_minute": 600, "window_end_minute": 610}, headers=h).status_code == 422
    assert client.put(url, json={**ON, "checks_per_day": 4}, headers=h).status_code == 422
    assert client.put(url, json={**ON, "weekdays": [7]}, headers=h).status_code == 422


# --- Blocked times ----------------------------------------------------------------------------

def test_pledges_manage_their_own_blocks(client, world):
    h = as_user("m1@t.demo")
    r = client.post("/me/bp/blocks", json={"blocks": [
        {"kind": "class", "weekday": 0, "start_minute": 600, "end_minute": 690, "note": "CS 101"},
        {"kind": "interview", "day": tomorrow().isoformat(), "start_minute": 840, "end_minute": 900},
    ]}, headers=h)
    assert r.status_code == 201
    mine = r.json()
    assert [b["kind"] for b in mine] == ["class", "interview"] and mine[0]["note"] == "CS 101"
    # Others can't delete it.
    assert client.delete(f"/me/bp/blocks/{mine[0]['id']}", headers=as_user("m2@t.demo")).status_code == 404
    assert client.delete(f"/me/bp/blocks/{mine[0]['id']}", headers=h).status_code == 204
    assert len(client.get("/me/bp/blocks", headers=h).json()) == 1


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
        assert client.post("/me/bp/blocks", json={"blocks": [b]}, headers=h).status_code == 422, b
    many = [{"kind": "work", "weekday": i % 7, "start_minute": i, "end_minute": i + 1} for i in range(60)]
    assert client.post("/me/bp/blocks", json={"blocks": many}, headers=h).status_code == 201
    one = {"kind": "work", "weekday": 0, "start_minute": 900, "end_minute": 960}
    assert client.post("/me/bp/blocks", json={"blocks": [one]}, headers=h).status_code == 422


def test_brothers_see_kinds_and_times_but_not_notes(client, world):
    client.post("/me/bp/blocks", json={"blocks": [
        {"kind": "religious", "weekday": 4, "start_minute": 780, "end_minute": 870, "note": "private"},
        {"kind": "class", "weekday": 0, "start_minute": 600, "end_minute": 690},
    ]}, headers=as_user("m1@t.demo"))
    assert client.get(f"/orgs/{world['org_a']}/bp/blocks", headers=as_user("m1@t.demo")).status_code == 403
    assert client.get(f"/orgs/{world['org_a']}/bp/blocks", headers=as_user("outsider@t.demo")).status_code == 404
    rows = {p["name"]: p for p in client.get(f"/orgs/{world['org_a']}/bp/blocks", headers=lead()).json()}
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
    client.post("/me/bp/blocks", json={"blocks": [
        {"kind": "interview", "day": day.isoformat(), "start_minute": 840, "end_minute": 900, "source": "calendar"}]}, headers=h)
    busy = client.get("/me/bp/calendar", headers=h).json()["busy"]
    assert [b["already_blocked"] for b in busy] == [True, False, False]
    assert client.get("/me/bp/calendar?days=30", headers=h).status_code == 422
