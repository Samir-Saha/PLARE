from datetime import timedelta

import pytest

from app.db import SessionLocal, now
from app.logbook import add_entry, sync_overdue
from app.models import LogEntry, Notification

from .conftest import as_user

LEAD = as_user("lead@t.demo")


def log_url(world, suffix=""):
    return f"/orgs/{world['org_a']}/log{suffix}"


def add(client, world, who="m1", kind="other", detail="Missed coffee chat", headers=LEAD):
    return client.post(log_url(world), json={"user_id": world[who], "kind": kind, "detail": detail}, headers=headers)


def overdue_task(client, world):
    due = (now() - timedelta(hours=2)).isoformat()
    r = client.post(f"/orgs/{world['org_a']}/tasks", json={"title": "BP post", "due_at": due}, headers=LEAD)
    assert r.status_code == 201, r.text


def test_member_sees_only_their_own_entries(client, world):
    assert add(client, world, "m1").status_code == 201
    assert add(client, world, "m2").status_code == 201
    # A member's user_id filter is ignored: they still only get their own rows.
    rows = client.get(log_url(world) + f"?user_id={world['m2']}", headers=as_user("m1@t.demo")).json()
    assert [r["user_id"] for r in rows] == [world["m1"]]
    everyone = client.get(log_url(world), headers=LEAD).json()
    assert {r["user_id"] for r in everyone} == {world["m1"], world["m2"]}
    assert everyone[0]["created_by_name"] == "lead"
    assert everyone[0]["label"] == "Other"


def test_member_cannot_add_delete_or_see_summary(client, world):
    m1 = as_user("m1@t.demo")
    assert add(client, world, "m2", headers=m1).status_code == 403
    entry = add(client, world, "m2").json()
    assert client.delete(log_url(world, f"/{entry['id']}"), headers=m1).status_code == 403
    assert client.get(log_url(world, "/summary"), headers=m1).status_code == 403


def test_other_org_gets_404(client, world):
    entry = add(client, world).json()
    out = as_user("outsider@t.demo")
    assert client.get(log_url(world), headers=out).status_code == 404
    assert client.get(log_url(world, "/summary"), headers=out).status_code == 404
    assert add(client, world, headers=out).status_code == 404
    assert client.delete(log_url(world, f"/{entry['id']}"), headers=out).status_code == 404
    # A lead can't log someone from another org, or delete another org's entry through their own org.
    assert add(client, world, "outsider").status_code == 404
    r = client.delete(f"/orgs/{world['org_b']}/log/{entry['id']}", headers=as_user("outsider@t.demo"))
    assert r.status_code == 404


def test_rejects_unknown_kind_and_empty_detail(client, world):
    assert add(client, world, kind="punishment").status_code == 422
    assert add(client, world, detail="").status_code == 422


def test_source_key_deduplicates(world):
    with SessionLocal() as db:
        first = add_entry(db, world["org_a"], world["m1"], "late_gm", "Sent 9:12 AM", source_key="gm:1")
        again = add_entry(db, world["org_a"], world["m1"], "late_gm", "Sent 9:12 AM", source_key="gm:1")
        db.commit()
        assert first.id == again.id
        assert db.query(LogEntry).count() == 1
        # One notification, linking to the log.
        notes = db.query(Notification).filter_by(user_id=world["m1"], category="log").all()
        assert [(n.title, n.link) for n in notes] == [("New log entry: Late GM message", "/app/log")]
        with pytest.raises(ValueError):
            add_entry(db, world["org_a"], world["m1"], "not_a_kind", "x")


def test_overdue_sync_is_idempotent(client, world):
    overdue_task(client, world)
    first = client.get(log_url(world), headers=LEAD).json()
    assert len(first) == 3 and all(r["kind"] == "overdue_task" and r["automatic"] for r in first)
    assert first[0]["detail"].startswith("BP post was due ")
    client.get(log_url(world), headers=as_user("m1@t.demo"))
    client.get(log_url(world, "/summary"), headers=LEAD)
    with SessionLocal() as db:
        assert sync_overdue(db, world["org_a"]) == 0
    assert len(client.get(log_url(world), headers=LEAD).json()) == 3


def test_submitted_work_is_not_logged_as_overdue(client, world):
    overdue_task(client, world)
    a = client.get(f"/orgs/{world['org_a']}/tasks/mine", headers=as_user("m1@t.demo")).json()[0]
    client.post(f"/assignments/{a['id']}/submissions", data={"text": "done"}, headers=as_user("m1@t.demo"))
    rows = client.get(log_url(world), headers=LEAD).json()
    assert world["m1"] not in {r["user_id"] for r in rows}


def test_cannot_delete_automatic_entries(client, world):
    overdue_task(client, world)
    auto = client.get(log_url(world), headers=LEAD).json()[0]
    assert client.delete(log_url(world, f"/{auto['id']}"), headers=LEAD).status_code == 409
    manual = add(client, world).json()
    assert client.delete(log_url(world, f"/{manual['id']}"), headers=LEAD).status_code == 204
    assert client.delete(log_url(world, f"/{manual['id']}"), headers=LEAD).status_code == 404


def test_summary_includes_members_with_zero(client, world):
    add(client, world, "m1")
    add(client, world, "m1", detail="Second one")
    s = client.get(log_url(world, "/summary"), headers=LEAD).json()
    assert s["members"][0] == {"user_id": world["m1"], "name": "m1", "count": 2}
    assert {r["name"]: r["count"] for r in s["members"]} == {"m1": 2, "m2": 0, "m3": 0}
    assert s["today"] == 2 and s["total"] == 2
