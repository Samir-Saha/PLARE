from datetime import timedelta

from app.db import SessionLocal, now
from app.engine.rsvp import going_count, is_confirmed
from app.models import Notification

from .conftest import as_user

LEAD = as_user("lead@t.demo")
M1 = as_user("m1@t.demo")
M2 = as_user("m2@t.demo")
M3 = as_user("m3@t.demo")
OUT = as_user("outsider@t.demo")


def when(days=1, hours=0):
    return (now() + timedelta(days=days, hours=hours)).isoformat()


def make(client, world, headers=M1, guests=("m2", "m3"), required=3, **over):
    body = {"title": "Rutgers game", "start_at": when(1), "end_at": when(1, 2), "required_rsvps": required,
            "guest_ids": [world[g] for g in guests], **over}
    return client.post(f"/orgs/{world['org_a']}/events", json=body, headers=headers)


def rsvp(client, event_id, response, headers):
    return client.put(f"/events/{event_id}/rsvp", json={"response": response}, headers=headers)


def test_confirmed_rule():
    assert not is_confirmed(2, ["yes", "maybe", "no", "invited"])
    assert is_confirmed(2, ["yes", "yes", "invited"])
    assert going_count(["yes", "no", "yes"]) == 2


def test_event_turns_confirmed_when_enough_say_yes(client, world):
    r = make(client, world)
    assert r.status_code == 201, r.text
    ev = r.json()
    # The creator counts as going; two more are needed.
    assert (ev["going"], ev["needed"], ev["confirmed"], ev["my_response"]) == (1, 2, False, "yes")
    assert {g["name"]: g["response"] for g in ev["guests"]} == {"m1": "yes", "m2": "invited", "m3": "invited"}

    assert rsvp(client, ev["id"], "yes", M2).json()["confirmed"] is False
    done = rsvp(client, ev["id"], "yes", M3).json()
    assert (done["going"], done["needed"], done["confirmed"]) == (3, 0, True)

    # Someone backing out drops it back to unconfirmed.
    dropped = rsvp(client, ev["id"], "no", M3).json()
    assert dropped["confirmed"] is False and dropped["my_response"] == "no"


def test_maybe_does_not_count(client, world):
    ev = make(client, world, required=2, guests=("m2",)).json()
    assert rsvp(client, ev["id"], "maybe", M2).json()["confirmed"] is False


def test_invites_and_confirmation_notify(client, world):
    ev = make(client, world).json()
    rsvp(client, ev["id"], "yes", M2)
    rsvp(client, ev["id"], "yes", M3)
    with SessionLocal() as db:
        titles = sorted(n.title for n in db.query(Notification).filter_by(category="event"))
    assert titles.count("m1 invited you: Rutgers game") == 2
    assert titles.count("Confirmed: Rutgers game") == 2  # m1 and m2 hear about it; m3 caused it


def test_only_invited_members_can_rsvp(client, world):
    ev = make(client, world, guests=("m2",), required=1).json()
    assert rsvp(client, ev["id"], "yes", M3).status_code == 403
    assert rsvp(client, ev["id"], "yes", OUT).status_code == 404


def test_validation(client, world):
    assert make(client, world, required=4).status_code == 422                      # more than invited
    assert make(client, world, start_at="2026-11-12T18:00:00", end_at="2026-11-12T19:00:00").status_code == 422  # no tz
    assert make(client, world, start_at=when(2), end_at=when(1)).status_code == 422  # ends before it starts
    bad = client.post(f"/orgs/{world['org_a']}/events", headers=M1,
                      json={"title": "x", "start_at": when(1), "end_at": when(1, 1), "guest_ids": [world["outsider"]]})
    assert bad.status_code == 422                                                   # guest from another group


def test_list_is_scoped_to_the_group(client, world):
    make(client, world)
    assert len(client.get(f"/orgs/{world['org_a']}/events", headers=M3).json()) == 1
    assert client.get(f"/orgs/{world['org_a']}/events", headers=OUT).status_code == 404
    assert client.get(f"/orgs/{world['org_a']}/events?start={when(10).replace('+', '%2B')}", headers=M3).json() == []


def test_edit_guests_keeps_existing_rsvps(client, world):
    ev = make(client, world, guests=("m2",), required=2).json()
    rsvp(client, ev["id"], "yes", M2)
    r = client.patch(f"/events/{ev['id']}", json={"guest_ids": [world["m2"], world["m3"]], "required_rsvps": 3}, headers=M1)
    assert r.status_code == 200, r.text
    out = r.json()
    assert {g["name"]: g["response"] for g in out["guests"]} == {"m1": "yes", "m2": "yes", "m3": "invited"}
    assert out["confirmed"] is False
    assert client.patch(f"/events/{ev['id']}", json={"title": "x"}, headers=M2).status_code == 403


def test_delete_permissions(client, world):
    ev = make(client, world).json()
    assert client.delete(f"/events/{ev['id']}", headers=M2).status_code == 403
    assert client.delete(f"/events/{ev['id']}", headers=LEAD).status_code == 204  # a brother may delete
    assert client.get(f"/orgs/{world['org_a']}/events", headers=M1).json() == []
