from datetime import timedelta

from sqlalchemy import select, update

from app.db import SessionLocal, now
from app.models import GroupStudyParticipant, GroupStudySession, StudyPing

from .conftest import as_user

LEAD, M1, M2, M3 = (as_user(f"{n}@t.demo") for n in ("lead", "m1", "m2", "m3"))
OUT = as_user("outsider@t.demo")
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def room(client, world, who=M1):
    r = client.get(f"/orgs/{world['org_a']}/group-study/room", headers=who)
    assert r.status_code == 200, r.text
    return r.json()["session"]


def start(client, world, who=M1):
    r = client.post(f"/orgs/{world['org_a']}/group-study/room", json={"title": "Library"}, headers=who)
    assert r.status_code == 201, r.text
    return r.json()


def set_quorum(client, world, quorum):
    r = client.put(f"/orgs/{world['org_a']}/group-study/settings", json={"quorum": quorum, "window_minutes": 10}, headers=LEAD)
    assert r.status_code == 200, r.text


def open_ping(session_id, hour=0):
    """Move a ping so it is open right now. Returns its id."""
    with SessionLocal() as db:
        ping = db.scalar(select(StudyPing).where(StudyPing.session_id == session_id, StudyPing.hour_index == hour))
        ping.ping_at, ping.closes_at = now() - timedelta(minutes=1), now() + timedelta(minutes=9)
        db.commit()
        return ping.id


def finish_first_hour(session_id):
    """Pretend the session started 61 minutes ago, with hour 0's ping already closed."""
    t = now()
    with SessionLocal() as db:
        s = db.get(GroupStudySession, session_id)
        s.started_at = t - timedelta(minutes=61)
        ping = db.scalar(select(StudyPing).where(StudyPing.session_id == session_id, StudyPing.hour_index == 0))
        ping.ping_at, ping.closes_at = s.started_at + timedelta(minutes=20), s.started_at + timedelta(minutes=30)
        db.commit()


def checkin(client, ping_id, who, data=JPEG):
    return client.post(f"/group-study/pings/{ping_id}/checkin", files={"photo": ("x.jpg", data, "image/jpeg")}, headers=who)


def test_settings_default_to_group_size_and_only_leads_change_them(client, world):
    url = f"/orgs/{world['org_a']}/group-study/settings"
    # Three pledges in this group, so the default of 7 is lowered to 3.
    assert client.get(url, headers=M1).json()["quorum"] == 3
    assert client.put(url, json={"quorum": 2, "window_minutes": 10}, headers=M1).status_code == 403
    assert client.put(url, json={"quorum": 4, "window_minutes": 10}, headers=LEAD).status_code == 422
    assert client.put(url, json={"quorum": 2, "window_minutes": 10}, headers=OUT).status_code == 404
    set_quorum(client, world, 2)
    assert client.get(url, headers=M1).json()["quorum"] == 2


def test_one_room_at_a_time_and_other_groups_get_404(client, world):
    s = start(client, world)
    assert s["me"]["studying"] is True
    r = client.post(f"/orgs/{world['org_a']}/group-study/room", headers=M2)
    assert r.status_code == 409
    assert client.get(f"/orgs/{world['org_a']}/group-study/room", headers=OUT).status_code == 404
    assert client.post(f"/group-study/{s['id']}/join", headers=OUT).status_code == 404
    assert client.post(f"/group-study/{s['id']}/messages", json={"body": "hi"}, headers=OUT).status_code == 404


def test_leads_drop_in_and_chat_but_cannot_join_or_check_in(client, world):
    s = start(client, world)
    assert client.post(f"/group-study/{s['id']}/join", headers=LEAD).status_code == 403
    assert client.post(f"/group-study/{s['id']}/messages", json={"body": "Proud of you all"}, headers=LEAD).status_code == 201
    view = room(client, world, LEAD)
    assert view["messages"][-1]["body"] == "Proud of you all"
    lead_row = next(p for p in view["people"] if p["user_id"] == world["lead"])
    assert lead_row["here_now"] and not lead_row["studying"]
    room(client, world)  # creates hour 0's ping
    assert checkin(client, open_ping(s["id"]), LEAD).status_code == 403


def test_ping_time_stays_hidden_until_it_opens(client, world):
    s = start(client, world)
    with SessionLocal() as db:
        ping = db.scalar(select(StudyPing).where(StudyPing.session_id == s["id"]))
        ping.ping_at, ping.closes_at = now() + timedelta(minutes=20), now() + timedelta(minutes=30)
        db.commit()
        ping_id = ping.id
    view = room(client, world)
    assert view["hours"][0]["status"] == "waiting"
    assert view["hours"][0]["ping_at"] is None and view["open_ping"] is None
    # Guessing the id early doesn't work either.
    assert checkin(client, ping_id, M1).status_code == 404


def test_hour_counts_only_for_pledges_who_confirmed_when_quorum_is_met(client, world):
    set_quorum(client, world, 2)
    s = start(client, world)
    for who in (M2, M3):
        assert client.post(f"/group-study/{s['id']}/join", headers=who).status_code == 200
    ping_id = open_ping(s["id"])
    assert room(client, world)["open_ping"]["id"] == ping_id
    assert checkin(client, ping_id, M1).status_code == 201
    assert checkin(client, ping_id, M1).status_code == 409  # one photo per hour
    view = checkin(client, ping_id, M2).json()
    assert view["hours"][0]["count"] == 2 and view["hours"][0]["status"] == "open"

    finish_first_hour(s["id"])
    view = room(client, world)
    assert view["hours"][0]["status"] == "counted"
    assert view["hours"][1]["status"] in ("waiting", "open")  # next hour's ping was created

    h = client.get(f"/orgs/{world['org_a']}/group-study/history", headers=LEAD).json()
    hours = {r["name"]: r["hours"] for r in h["members"]}
    assert hours == {"m1": 1, "m2": 1, "m3": 0}
    assert client.get(f"/orgs/{world['org_a']}/group-study/history", headers=M3).json()["members"] is None


def test_hour_below_quorum_counts_for_nobody(client, world):
    s = start(client, world)  # default quorum 3 in this group
    client.post(f"/group-study/{s['id']}/join", headers=M2)
    ping_id = open_ping(s["id"])
    checkin(client, ping_id, M1)
    checkin(client, ping_id, M2)
    finish_first_hour(s["id"])
    assert room(client, world)["hours"][0]["status"] == "short"
    h = client.get(f"/orgs/{world['org_a']}/group-study/history", headers=M1).json()
    assert h["my_hours"] == 0


def test_check_in_rules(client, world):
    s = start(client, world)
    ping_id = open_ping(s["id"])
    assert checkin(client, ping_id, M2).status_code == 409  # hasn't joined
    assert checkin(client, ping_id, M1, data=b"%PDF-1.4 not a photo").status_code == 415
    with SessionLocal() as db:
        db.execute(update(StudyPing).where(StudyPing.id == ping_id).values(closes_at=now() - timedelta(seconds=1)))
        db.commit()
    r = checkin(client, ping_id, M1)
    assert r.status_code == 409 and "closed" in r.json()["detail"]


def test_photos_are_private_to_leads_and_people_studying_in_that_session(client, world):
    s = start(client, world)
    client.post(f"/group-study/{s['id']}/join", headers=M2)
    view = checkin(client, open_ping(s["id"]), M1).json()
    cid = view["hours"][0]["confirmed"][0]["checkin_id"]
    url = f"/study-checkins/{cid}/photo"
    assert client.get(url, headers=M1).content == JPEG
    assert client.get(url, headers=M2).status_code == 200
    assert client.get(url, headers=LEAD).status_code == 200
    assert client.get(url, headers=M3).status_code == 404  # never joined this session
    assert client.get(url, headers=OUT).status_code == 404
    # m3 viewing the room sees who confirmed but gets no photo ids.
    assert room(client, world, M3)["hours"][0]["confirmed"][0]["checkin_id"] is None


def test_only_starter_or_lead_can_end_and_ending_early_voids_the_hour(client, world):
    set_quorum(client, world, 1)
    s = start(client, world)
    client.post(f"/group-study/{s['id']}/join", headers=M2)
    checkin(client, open_ping(s["id"]), M1)
    assert client.post(f"/group-study/{s['id']}/end", headers=M2).status_code == 403
    r = client.post(f"/group-study/{s['id']}/end", headers=LEAD)
    assert r.status_code == 200
    assert r.json()["hours"][0]["status"] == "incomplete"
    assert room(client, world) is None
    assert client.post(f"/group-study/{s['id']}/messages", json={"body": "hi"}, headers=M1).status_code == 409


def test_abandoned_room_ends_on_its_own(client, world):
    s = start(client, world)
    with SessionLocal() as db:
        db.execute(update(GroupStudyParticipant).values(last_seen_at=now() - timedelta(minutes=20)))
        db.commit()
    assert room(client, world) is None
    with SessionLocal() as db:
        assert db.get(GroupStudySession, s["id"]).ended_at is not None


def test_peeking_from_the_study_page_does_not_show_you_in_the_room(client, world):
    start(client, world)
    r = client.get(f"/orgs/{world['org_a']}/group-study/room?watch=false", headers=LEAD)
    assert r.status_code == 200 and r.json()["session"] is not None
    assert world["lead"] not in {p["user_id"] for p in room(client, world)["people"]}
