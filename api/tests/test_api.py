from datetime import date, datetime, timedelta, timezone

from app.db import SessionLocal, now
from app.models import StudySession
from app.routers import schedule

from .conftest import as_user

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def make_task(client, world, **extra):
    body = {"title": "BP post", "evidence": "any", **extra}
    r = client.post(f"/orgs/{world['org_a']}/tasks", json=body, headers=as_user("lead@t.demo"))
    assert r.status_code == 201, r.text
    return r.json()


def mine(client, world, who="m1"):
    return client.get(f"/orgs/{world['org_a']}/tasks/mine", headers=as_user(f"{who}@t.demo")).json()


def test_requires_sign_in_and_rejects_unknown_demo_user(client, world):
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers=as_user("nobody@t.demo")).status_code == 401


def test_other_orgs_are_invisible(client, world):
    h = as_user("outsider@t.demo")
    for path in ("members", "tasks/mine", "review", "progress", "best-times", "study", "meetings"):
        assert client.get(f"/orgs/{world['org_a']}/{path}", headers=h).status_code == 404, path


def test_members_cannot_create_tasks_or_review(client, world):
    r = client.post(f"/orgs/{world['org_a']}/tasks", json={"title": "x"}, headers=as_user("m1@t.demo"))
    assert r.status_code == 403
    assert client.get(f"/orgs/{world['org_a']}/review", headers=as_user("m1@t.demo")).status_code == 403


def test_submit_review_approve_flow(client, world):
    assert make_task(client, world)["assigned"] == 3
    a = mine(client, world)[0]
    assert a["status"] == "not_started"
    h = as_user("m1@t.demo")
    assert client.post(f"/assignments/{a['id']}/submissions", data={"text": ""}, headers=h).status_code == 422
    r = client.post(f"/assignments/{a['id']}/submissions", data={"text": "done"}, headers=h)
    assert r.status_code == 201
    assert client.post(f"/assignments/{a['id']}/submissions", data={"text": "again"}, headers=h).status_code == 409
    # Someone else's assignment is not reachable.
    assert client.post(f"/assignments/{a['id']}/submissions", data={"text": "x"}, headers=as_user("m2@t.demo")).status_code == 404

    queue = client.get(f"/orgs/{world['org_a']}/review", headers=as_user("lead@t.demo")).json()
    assert [s["user_name"] for s in queue] == ["m1"]
    sid = queue[0]["id"]
    assert client.post(f"/submissions/{sid}/review", json={"decision": "approved"}, headers=h).status_code == 403
    bad = client.post(f"/submissions/{sid}/review", json={"decision": "needs_revision"}, headers=as_user("lead@t.demo"))
    assert bad.status_code == 422
    ok = client.post(f"/submissions/{sid}/review", json={"decision": "approved"}, headers=as_user("lead@t.demo"))
    assert ok.status_code == 200
    assert client.post(f"/submissions/{sid}/review", json={"decision": "approved"}, headers=as_user("lead@t.demo")).status_code == 409
    assert mine(client, world)[0]["status"] == "approved"
    notes = client.get("/notifications", headers=h).json()
    assert any("approved" in n["title"] for n in notes)
    prog = client.get(f"/orgs/{world['org_a']}/progress", headers=as_user("lead@t.demo")).json()
    assert (prog["total"], prog["approved"]) == (3, 1)


def test_revision_then_resubmit(client, world):
    make_task(client, world)
    a = mine(client, world)[0]
    h, lead = as_user("m1@t.demo"), as_user("lead@t.demo")
    client.post(f"/assignments/{a['id']}/submissions", data={"text": "v1"}, headers=h)
    sid = client.get(f"/orgs/{world['org_a']}/review", headers=lead).json()[0]["id"]
    client.post(f"/submissions/{sid}/review", json={"decision": "needs_revision", "feedback": "more"}, headers=lead)
    a = mine(client, world)[0]
    assert (a["status"], a["feedback"]) == ("needs_revision", "more")
    assert client.post(f"/assignments/{a['id']}/submissions", data={"text": "v2"}, headers=h).status_code == 201


def test_overdue_is_derived_from_due_date(client, world):
    past = (now() - timedelta(hours=1)).isoformat()
    make_task(client, world, due_at=past)
    assert mine(client, world)[0]["overdue"] is True
    r = client.post(f"/orgs/{world['org_a']}/tasks", json={"title": "x", "due_at": "2026-11-12T10:00:00"}, headers=as_user("lead@t.demo"))
    assert r.status_code == 422  # naive datetime rejected


def test_upload_validation_and_private_access(client, world):
    make_task(client, world, evidence="photo")
    a = mine(client, world)[0]
    h = as_user("m1@t.demo")
    url = f"/assignments/{a['id']}/submissions"
    assert client.post(url, data={"text": "no photo"}, headers=h).status_code == 422
    fake = client.post(url, files={"file": ("x.png", b"<script>alert(1)</script>", "image/png")}, headers=h)
    assert fake.status_code == 415
    big = client.post(url, files={"file": ("x.png", PNG + b"0" * (9 * 1024 * 1024), "image/png")}, headers=h)
    assert big.status_code == 413
    assert client.post(url, files={"file": ("../../x.png", PNG, "image/png")}, headers=h).status_code == 201
    sid = client.get(f"/orgs/{world['org_a']}/review", headers=as_user("lead@t.demo")).json()[0]["id"]
    assert client.get(f"/submissions/{sid}/file", headers=h).content == PNG
    assert client.get(f"/submissions/{sid}/file", headers=as_user("lead@t.demo")).status_code == 200
    assert client.get(f"/submissions/{sid}/file", headers=as_user("m2@t.demo")).status_code == 404
    assert client.get(f"/submissions/{sid}/file", headers=as_user("outsider@t.demo")).status_code == 404
    assert client.get(f"/submissions/{sid}/file").status_code == 401


def test_claim_open_task(client, world):
    tid = make_task(client, world, assign="open")["id"]
    h = as_user("m1@t.demo")
    assert [t["task_id"] for t in client.get(f"/orgs/{world['org_a']}/tasks/open", headers=h).json()] == [tid]
    assert client.post(f"/tasks/{tid}/claim", headers=h).status_code == 201
    assert client.post(f"/tasks/{tid}/claim", headers=h).status_code == 409
    assert client.post(f"/tasks/{tid}/claim", headers=as_user("outsider@t.demo")).status_code == 404
    assert mine(client, world)[0]["status"] == "in_progress"


def test_invites_and_role_escalation(client, world):
    org = world["org_a"]
    lead, admin, out = as_user("lead@t.demo"), as_user("admin@t.demo"), as_user("outsider@t.demo")
    assert client.post(f"/orgs/{org}/invites", json={"role": "admin"}, headers=lead).status_code == 403
    assert client.post(f"/orgs/{org}/invites", json={}, headers=as_user("m1@t.demo")).status_code == 403
    code = client.post(f"/orgs/{org}/invites", json={}, headers=lead).json()["code"]
    assert client.post(f"/invites/{code}/accept", headers=out).json() == {"org_id": org}
    assert client.get(f"/orgs/{org}/members", headers=out).status_code == 200
    assert client.post("/invites/not-a-code/accept", headers=out).status_code == 404
    # Role changes are admin-only, and the last admin can't be demoted.
    assert client.patch(f"/orgs/{org}/members/{world['m1']}", json={"role": "lead"}, headers=lead).status_code == 403
    assert client.patch(f"/orgs/{org}/members/{world['m1']}", json={"role": "lead"}, headers=admin).status_code == 200
    assert client.patch(f"/orgs/{org}/members/{world['admin']}", json={"role": "member"}, headers=admin).status_code == 409


def test_create_org_makes_creator_admin(client, world):
    h = as_user("m1@t.demo")
    org = client.post("/orgs", json={"name": "Intern pod", "kind": "intern_team"}, headers=h).json()
    me = client.get("/me", headers=h).json()
    assert {"id": org["id"], "role": "admin", "lead": "Team lead"} in [
        {"id": o["id"], "role": o["role"], "lead": o["lead_label"]} for o in me["orgs"]]


def _set_rules(client, who, rules):
    r = client.put("/availability/me", json={"rules": rules}, headers=as_user(f"{who}@t.demo"))
    assert r.status_code == 200, r.text


def test_best_times_from_typed_availability(client, world):
    every_day = [{"weekday": d, "start_minute": 18 * 60, "end_minute": 20 * 60} for d in range(7)]
    for who in ("admin", "lead", "m1", "m2"):
        _set_rules(client, who, every_day)
    r = client.get(f"/orgs/{world['org_a']}/best-times?duration=60&days=3", headers=as_user("m1@t.demo")).json()
    assert r["total"] == 5 and r["no_data"] == ["m3"]
    best = r["options"][0]
    assert best["count"] == 4 and best["unavailable"] == ["m3"]
    start = datetime.fromisoformat(best["start"])
    assert start.astimezone(timezone(timedelta(hours=-5))).hour == 18
    bad = client.put("/availability/me", json={"rules": [{"weekday": 0, "start_minute": 600, "end_minute": 600}]}, headers=as_user("m1@t.demo"))
    assert bad.status_code == 422


def test_calendar_sync_feeds_study_plan(client, world, monkeypatch):
    h = as_user("m1@t.demo")
    empty = client.get(f"/orgs/{world['org_a']}/study/plan", headers=h).json()
    assert empty["has_availability"] is False and empty["blocks"] == []

    busy_start = now() + timedelta(hours=1)
    busy = [(busy_start, busy_start + timedelta(days=2))]
    seen = {}

    def fake_fetch(token, start, end):
        seen["token"] = token
        return busy

    monkeypatch.setattr(schedule, "fetch_busy", fake_fetch)
    r = client.post("/calendar/sync", json={"provider_token": "google-token-123", "days": 7}, headers=h)
    assert r.status_code == 200 and r.json()["busy_blocks"] == 1 and seen["token"] == "google-token-123"

    plan = client.get(f"/orgs/{world['org_a']}/study/plan?target_hours=6&day_start=0&day_end=24", headers=h).json()
    assert plan["has_availability"] and plan["planned_minutes"] == 360
    for b in plan["blocks"]:
        s, e = datetime.fromisoformat(b["start"]), datetime.fromisoformat(b["end"])
        assert e <= busy[0][0] or s >= busy[0][1]

    assert client.delete("/calendar", headers=h).status_code == 204
    assert client.get(f"/orgs/{world['org_a']}/study/plan", headers=h).json()["has_availability"] is False


def test_group_study_times_only_count_members(client, world):
    rules = [{"weekday": d, "start_minute": 600, "end_minute": 900} for d in range(7)]
    for who in ("lead", "m1", "m2"):
        _set_rules(client, who, rules)
    r = client.get(f"/orgs/{world['org_a']}/study/group-times?duration=120&days=3", headers=as_user("m1@t.demo")).json()
    assert r["total"] == 3 and r["options"][0]["count"] == 2 and r["options"][0]["unavailable"] == ["m3"]


def test_study_timer_uses_timestamps(client, world):
    org, h = world["org_a"], as_user("m1@t.demo")
    assert client.post(f"/orgs/{org}/study/pause", headers=h).status_code == 409
    sid = client.post(f"/orgs/{org}/study/start", headers=h).json()["id"]
    assert client.post(f"/orgs/{org}/study/start", headers=h).status_code == 409
    with SessionLocal() as db:  # pretend it started 30 minutes ago
        s = db.get(StudySession, sid)
        s.started_at = now() - timedelta(minutes=30)
        db.commit()
    active = client.get(f"/orgs/{org}/study", headers=h).json()["active"]
    assert 1795 <= active["elapsed_seconds"] <= 1805
    assert client.post(f"/orgs/{org}/study/pause", headers=h).json()["state"] == "paused"
    with SessionLocal() as db:  # paused 10 minutes ago: that time must not count
        s = db.get(StudySession, sid)
        s.paused_at = now() - timedelta(minutes=10)
        db.commit()
    assert client.post(f"/orgs/{org}/study/resume", headers=h).json()["state"] == "running"
    done = client.post(f"/orgs/{org}/study/end", headers=h).json()
    assert done["state"] == "ended" and 1195 <= done["elapsed_seconds"] <= 1205
    overview = client.get(f"/orgs/{org}/study", headers=h).json()
    assert overview["active"] is None and len(overview["history"]) == 1


def test_meetings_and_rsvp(client, world):
    org = world["org_a"]
    start = now() + timedelta(days=1)
    body = {"title": "Game night", "start_at": start.isoformat(), "end_at": (start + timedelta(hours=1)).isoformat()}
    assert client.post(f"/orgs/{org}/meetings", json=body, headers=as_user("m1@t.demo")).status_code == 403
    mid = client.post(f"/orgs/{org}/meetings", json=body, headers=as_user("lead@t.demo")).json()["id"]
    r = client.post(f"/meetings/{mid}/rsvp", json={"response": "yes"}, headers=as_user("m1@t.demo")).json()
    assert (r["yes"], r["my_response"]) == (1, "yes")
    r = client.post(f"/meetings/{mid}/rsvp", json={"response": "no"}, headers=as_user("m1@t.demo")).json()
    assert (r["yes"], r["no"]) == (0, 1)
    assert client.post(f"/meetings/{mid}/rsvp", json={"response": "yes"}, headers=as_user("outsider@t.demo")).status_code == 404


def test_demo_seed_is_usable(client):
    from app.seed import seed_demo

    assert seed_demo() is True and seed_demo() is False
    users = client.get("/demo/users").json()
    assert len(users) == 27
    assert {u["name"] for u in users if u["role"] == "member"} >= {"Mohammad Butt", "Kishor GS"}
    assert not [u for u in users if u["role"] == "lead"]  # every brother is an admin in the demo group
    h = as_user("mohammad.butt@plare.demo")
    org = client.get("/me", headers=h).json()["orgs"][0]["id"]
    assert len(client.get(f"/orgs/{org}/tasks/mine", headers=h).json()) == 4
    # GM messages: yesterday's inbox has flags; today's code word is set and pledges can send.
    lead = as_user("abirami@plare.demo")
    today = client.get(f"/orgs/{org}/gm/inbox", headers=lead).json()
    assert today["code"] == "lantern"
    yesterday = (date.fromisoformat(today["day"]) - timedelta(days=1)).isoformat()
    past = client.get(f"/orgs/{org}/gm/inbox?day={yesterday}", headers=lead).json()
    assert past["counts"]["flagged"] > 0 and past["counts"]["missing"] > 0 and past["counts"]["on_time"] > 0
    assert client.post(f"/orgs/{org}/gm", json={"goal": "Study", "code": "lantern"}, headers=h).status_code == 201
    # 8 days, so next Tuesday's 7-9 PM all-hands slot is always in range (7 misses it on Tuesday evenings).
    best = client.get(f"/orgs/{org}/best-times?duration=90&days=8", headers=h).json()
    assert best["options"][0]["count"] == 27


def test_member_titles_are_optional_and_scoped_to_the_group(client, world):
    from app.models import MemberTitle

    with SessionLocal() as db:
        db.add(MemberTitle(org_id=world["org_a"], user_id=world["admin"], title="NME"))
        db.commit()
    rows = client.get(f"/orgs/{world['org_a']}/members", headers=as_user("m1@t.demo")).json()
    titles = {r["name"]: r["title"] for r in rows}
    assert titles["admin"] == "NME" and titles["m1"] is None
    me = client.get("/me", headers=as_user("admin@t.demo")).json()
    assert me["orgs"][0]["title"] == "NME"
    assert client.get("/me", headers=as_user("m1@t.demo")).json()["orgs"][0]["title"] is None


def test_demo_seed_is_fair_and_resettable(client):
    from collections import Counter

    from app.db import SessionLocal
    from app.logbook import sync_overdue
    from app.models import LogEntry, MemberTitle, Organization
    from app.seed import reset_demo, seed_demo

    seed_demo()
    with SessionLocal() as db:
        org = db.query(Organization).filter_by(is_demo=True).one()
        assert org.name == "KTP Epsilon Class"
        sync_overdue(db, org.id)
        db.commit()
        per_person = Counter(e.user_id for e in db.query(LogEntry).filter_by(org_id=org.id))
        assert max(per_person.values()) <= 2
        assert db.query(MemberTitle).filter_by(org_id=org.id).count() == 12
    assert client.get("/me", headers=as_user("arnav@plare.demo")).json()["orgs"][0]["title"] == "NME"

    reset_demo()
    with SessionLocal() as db:
        assert db.query(Organization).filter_by(is_demo=True).count() == 0
        assert db.query(LogEntry).count() == 0
    assert seed_demo() is True


def test_invite_list_and_revoke(client, world):
    org, lead, admin = world["org_a"], as_user("lead@t.demo"), as_user("admin@t.demo")
    code = client.post(f"/orgs/{org}/invites", json={}, headers=lead).json()["code"]
    admin_code = client.post(f"/orgs/{org}/invites", json={"role": "lead"}, headers=admin).json()["code"]
    assert client.get(f"/orgs/{org}/invites", headers=as_user("m1@t.demo")).status_code == 403
    assert client.get(f"/orgs/{org}/invites", headers=as_user("outsider@t.demo")).status_code == 404
    assert {i["code"] for i in client.get(f"/orgs/{org}/invites", headers=lead).json()} == {code, admin_code}
    # A lead can't revoke an admin-made lead invite; the admin can.
    assert client.delete(f"/orgs/{org}/invites/{admin_code}", headers=lead).status_code == 403
    assert client.delete(f"/orgs/{org}/invites/{code}", headers=lead).status_code == 204
    assert client.delete(f"/orgs/{org}/invites/{code}", headers=lead).status_code == 404
    assert [i["code"] for i in client.get(f"/orgs/{org}/invites", headers=lead).json()] == [admin_code]
    # A revoked link no longer works.
    assert client.post(f"/invites/{code}/accept", headers=as_user("outsider@t.demo")).status_code == 404


def test_update_org_is_admin_only(client, world):
    org = world["org_a"]
    assert client.patch(f"/orgs/{org}", json={"name": "New"}, headers=as_user("lead@t.demo")).status_code == 403
    r = client.patch(f"/orgs/{org}", json={"name": "Intern pod", "kind": "intern_team"}, headers=as_user("admin@t.demo"))
    assert r.status_code == 200 and r.json()["member_label"] == "Intern"
    assert client.patch(f"/orgs/{org}", json={"kind": "nope"}, headers=as_user("admin@t.demo")).status_code == 422
    members = client.get(f"/orgs/{org}/members", headers=as_user("m1@t.demo")).json()
    assert all("joined_at" in m for m in members)


def test_overview_is_lead_only_and_uses_real_records(client, world):
    org, lead, m1 = world["org_a"], as_user("lead@t.demo"), as_user("m1@t.demo")
    assert client.get(f"/orgs/{org}/overview", headers=m1).status_code == 403
    assert client.get(f"/orgs/{org}/overview", headers=as_user("outsider@t.demo")).status_code == 404
    empty = client.get(f"/orgs/{org}/overview", headers=lead).json()
    assert empty["deadlines"] == [] and empty["overdue_count"] == 0 and empty["study_seconds_week"] == 0
    assert empty["member_count"] == 3 and {e["kind"] for e in empty["activity"]} == {"joined"}

    soon = (now() + timedelta(days=2)).isoformat()
    past = (now() - timedelta(hours=3)).isoformat()
    client.post(f"/orgs/{org}/tasks", json={"title": "Soon", "due_at": soon}, headers=lead)
    client.post(f"/orgs/{org}/tasks", json={"title": "Late", "due_at": past}, headers=lead)
    a = next(x for x in mine(client, world) if x["title"] == "Soon")
    client.post(f"/assignments/{a['id']}/submissions", data={"text": "done"}, headers=m1)
    client.post(f"/orgs/{org}/study/start", headers=m1)
    o = client.get(f"/orgs/{org}/overview", headers=lead).json()
    assert [d["title"] for d in o["deadlines"]] == ["Soon"] and o["deadlines"][0]["done"] == 1
    assert o["overdue_count"] == 3 and {x["title"] for x in o["overdue"]} == {"Late"}
    assert o["activity"][0]["kind"] == "submitted" and o["activity"][0]["who"] == "m1"


def test_overview_skips_overdue_work_the_pledge_was_excused_from(client, world):
    from zoneinfo import ZoneInfo

    from app.models import Excuse

    org, lead = world["org_a"], as_user("lead@t.demo")
    due = now() - timedelta(hours=3)
    client.post(f"/orgs/{org}/tasks", json={"title": "GM", "category": "Good Morning Messages", "due_at": due.isoformat()}, headers=lead)
    assert client.get(f"/orgs/{org}/overview", headers=lead).json()["overdue_count"] == 3
    day = due.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    with SessionLocal() as db:
        # m1: approved GM excuse that day. m2: a pending (not approved) one, which must not count.
        db.add(Excuse(org_id=org, user_id=world["m1"], kind="gm", start_day=day, end_day=day, reason="exam", status="approved"))
        db.add(Excuse(org_id=org, user_id=world["m2"], kind="all", start_day=day, end_day=day, reason="sick", status="pending"))
        db.commit()
    o = client.get(f"/orgs/{org}/overview", headers=lead).json()
    assert o["overdue_count"] == 2 and "m1" not in {x["user_name"] for x in o["overdue"]}
