from datetime import timedelta

import pytest

from app.db import SessionLocal, now
from app.excuses import is_excused
from app.logbook import LOCAL_TZ
from app.models import Notification

from .conftest import as_user

LEAD = as_user("lead@t.demo")
M1 = as_user("m1@t.demo")
M2 = as_user("m2@t.demo")
OUT = as_user("outsider@t.demo")
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def day(offset=0):
    return (now().astimezone(LOCAL_TZ).date() + timedelta(days=offset)).isoformat()


def ask(client, world, headers=M1, files=None, **over):
    data = {"kind": "bp", "start_day": day(1), "reason": "exam", "note": "Calc midterm", **over}
    return client.post(f"/orgs/{world['org_a']}/excuses", data=data, files=files, headers=headers)


def review(client, excuse_id, decision="approved", reply="", headers=LEAD):
    return client.post(f"/excuses/{excuse_id}/review", json={"decision": decision, "reply": reply}, headers=headers)


def test_member_requests_and_lead_approves(client, world):
    r = ask(client, world)
    assert r.status_code == 201, r.text
    e = r.json()
    assert (e["status"], e["late"], e["kind_label"], e["reason_label"]) == ("pending", False, "BP check-in", "Exam")
    assert e["end_day"] == e["start_day"] == day(1)
    queue = client.get(f"/orgs/{world['org_a']}/excuses", headers=LEAD).json()
    assert [(q["id"], q["user_name"]) for q in queue] == [(e["id"], "m1")]
    done = review(client, e["id"]).json()
    assert done["status"] == "approved" and done["reviewer_name"] == "lead"
    assert client.get(f"/orgs/{world['org_a']}/excuses", headers=LEAD).json() == []
    mine = client.get(f"/orgs/{world['org_a']}/excuses/mine", headers=M1).json()
    assert [m["status"] for m in mine] == ["approved"]
    with SessionLocal() as db:
        titles = {n.title for n in db.query(Notification).filter_by(category="excuse")}
    assert titles == {"m1 requested an excuse: BP check-in", "Excuse approved: BP check-in"}


def test_is_excused_only_counts_approved_matching_days_and_kinds(client, world):
    e = ask(client, world, start_day=day(1), end_day=day(3)).json()
    with SessionLocal() as db:
        args = (db, world["org_a"], world["m1"])
        assert not is_excused(*args, "bp", day(2))  # still pending
    review(client, e["id"])
    with SessionLocal() as db:
        args = (db, world["org_a"], world["m1"])
        assert is_excused(*args, "bp", day(1)) and is_excused(*args, "bp", day(3))
        assert not is_excused(*args, "bp", day(0)) and not is_excused(*args, "bp", day(4))
        assert not is_excused(*args, "gm", day(2))
        assert not is_excused(db, world["org_a"], world["m2"], "bp", day(2))
        assert not is_excused(db, world["org_b"], world["m1"], "bp", day(2))
        with pytest.raises(ValueError):
            is_excused(*args, "nap", day(2))
    everything = ask(client, world, headers=M2, kind="all", reason="sick", note="").json()
    denied = ask(client, world, headers=M2, kind="gm", start_day=day(5)).json()
    review(client, everything["id"])
    review(client, denied["id"], "denied", "Exam is at night")
    with SessionLocal() as db:
        assert is_excused(db, world["org_a"], world["m2"], "study", day(1))
        assert not is_excused(db, world["org_a"], world["m2"], "gm", day(5))


def test_late_request_is_flagged_by_the_server(client, world):
    assert ask(client, world, start_day=day(-1)).json()["late"] is True
    assert ask(client, world, start_day=day(0)).json()["late"] is False
    # A client can't send its own late flag.
    assert ask(client, world, start_day=day(-2), late="false").json()["late"] is True


def test_validation(client, world):
    assert ask(client, world, kind="nap").status_code == 422
    assert ask(client, world, reason="bored").status_code == 422
    assert ask(client, world, reason="other", note=" ").status_code == 422
    assert ask(client, world, start_day="tomorrow").status_code == 422
    assert ask(client, world, start_day=day(3), end_day=day(1)).status_code == 422
    assert ask(client, world, start_day=day(1), end_day=day(15)).status_code == 422
    assert ask(client, world, note="x" * 501).status_code == 422
    assert ask(client, world).status_code == 201
    assert ask(client, world).status_code == 409  # same pending request twice


def test_permissions(client, world):
    e = ask(client, world).json()
    org = world["org_a"]
    # Leads don't request excuses; members can't see the queue, the summary, or review.
    assert ask(client, world, headers=LEAD).status_code == 403
    assert client.get(f"/orgs/{org}/excuses", headers=M1).status_code == 403
    assert client.get(f"/orgs/{org}/excuses/summary", headers=M1).status_code == 403
    assert review(client, e["id"], headers=M1).status_code == 403
    assert review(client, e["id"], headers=M2).status_code == 403
    # Members only ever see their own requests.
    assert client.get(f"/orgs/{org}/excuses/mine", headers=M2).json() == []
    assert client.delete(f"/excuses/{e['id']}", headers=M2).status_code == 404
    # Another group gets 404 everywhere.
    assert ask(client, world, headers=OUT).status_code == 404
    assert client.get(f"/orgs/{org}/excuses", headers=OUT).status_code == 404
    assert client.get(f"/orgs/{org}/excuses/mine", headers=OUT).status_code == 404
    assert client.get(f"/orgs/{org}/excuses/summary", headers=OUT).status_code == 404
    assert review(client, e["id"], headers=OUT).status_code == 404
    assert client.delete(f"/excuses/{e['id']}", headers=OUT).status_code == 404
    assert client.get(f"/orgs/{world['org_b']}/excuses", headers=OUT).json() == []


def test_review_rules(client, world):
    e = ask(client, world).json()
    assert review(client, e["id"], "denied").status_code == 422  # a denial needs a reason
    assert review(client, e["id"], "maybe").status_code == 422
    assert review(client, e["id"], "denied", "Not a conflict").json()["reply"] == "Not a conflict"
    assert review(client, e["id"]).status_code == 409
    assert review(client, "nope").status_code == 404


def test_withdraw_only_while_pending(client, world):
    e = ask(client, world).json()
    assert client.delete(f"/excuses/{e['id']}", headers=M1).status_code == 204
    assert client.get(f"/orgs/{world['org_a']}/excuses/mine", headers=M1).json() == []
    e = ask(client, world).json()
    review(client, e["id"])
    assert client.delete(f"/excuses/{e['id']}", headers=M1).status_code == 409


def test_proof_file_is_private_and_checked(client, world):
    bad = ask(client, world, files={"file": ("x.png", b"not an image", "image/png")})
    assert bad.status_code == 415
    e = ask(client, world, files={"file": ("schedule.png", PNG, "image/png")}).json()
    assert e["has_file"] and e["file_type"] == "image/png"
    url = f"/excuses/{e['id']}/file"
    assert client.get(url, headers=M1).content == PNG
    assert client.get(url, headers=LEAD).status_code == 200
    assert client.get(url, headers=M2).status_code == 404
    assert client.get(url, headers=OUT).status_code == 404
    plain = ask(client, world, kind="gm").json()
    assert client.get(f"/excuses/{plain['id']}/file", headers=M1).status_code == 404


def test_summary_and_history(client, world):
    a = ask(client, world).json()
    ask(client, world, kind="gm")
    b = ask(client, world, headers=M2).json()
    review(client, a["id"])
    review(client, b["id"], "denied", "No")
    s = client.get(f"/orgs/{world['org_a']}/excuses/summary", headers=LEAD).json()
    assert s["pending"] == 1
    assert s["members"] == [
        {"user_id": world["m1"], "name": "m1", "pending": 1, "approved": 1, "denied": 0},
        {"user_id": world["m2"], "name": "m2", "pending": 0, "approved": 0, "denied": 1},
        {"user_id": world["m3"], "name": "m3", "pending": 0, "approved": 0, "denied": 0},
    ]
    org = world["org_a"]
    assert len(client.get(f"/orgs/{org}/excuses?status=all", headers=LEAD).json()) == 3
    only = client.get(f"/orgs/{org}/excuses?status=all&user_id={world['m2']}", headers=LEAD).json()
    assert [r["status"] for r in only] == ["denied"]
