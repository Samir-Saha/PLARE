from datetime import date, datetime, timedelta, timezone

import pytest

from app.engine import bp as rules
from app.routers import bp

from .conftest import as_user

NY = "America/New_York"
UTC = timezone.utc
# Tue Nov 10 2026: New York is UTC-5, so 10:00 PM local is 03:00 UTC on Nov 11.
DUE = datetime(2026, 11, 11, 3, 0, tzinfo=UTC)
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


# ---- engine ----------------------------------------------------------------------------

def test_default_deadline_is_ten_pm_local():
    assert rules.due_at(date(2026, 11, 10), rules.DEFAULT_DUE_MINUTE, NY) == DUE


def test_status_flags_late_and_missing():
    assert rules.status(DUE, DUE, DUE) == "on_time"  # exactly on the deadline counts
    assert rules.status(DUE + timedelta(seconds=1), DUE, DUE) == "late"
    assert rules.status(None, DUE, DUE - timedelta(minutes=1)) == "pending"
    assert rules.status(None, DUE, DUE + timedelta(minutes=1)) == "missing"
    c = rules.counts(["on_time", "late", "missing", "pending"])
    assert c == {"on_time": 1, "late": 1, "missing": 1, "pending": 1, "members": 4, "flagged": 2}


def test_valid_days_exclude_the_future():
    today = date(2026, 11, 10)
    assert rules.is_valid_day(today, today)
    assert not rules.is_valid_day(today + timedelta(days=1), today)
    assert not rules.is_valid_day(today - timedelta(days=31), today)


# ---- API -------------------------------------------------------------------------------

@pytest.fixture
def clock(monkeypatch):
    """Freeze the BP router's clock. Call clock(dt) to move it."""
    state = {"at": DUE - timedelta(hours=2)}
    monkeypatch.setattr(bp, "now", lambda: state["at"])

    def set_(at: datetime):
        state["at"] = at
    return set_


def url(world, path=""):
    return f"/orgs/{world['org_a']}/bp{path}"


def send(client, world, who="m1", data=JPEG, caption="With a brother at the library"):
    return client.post(url(world), files={"photo": ("bp.jpg", data, "image/jpeg")},
                       data={"caption": caption}, headers=as_user(f"{who}@t.demo"))


def test_member_sends_once_and_server_stamps_time(client, world, clock):
    r = send(client, world)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["day"] == "2026-11-10" and body["status"] == "on_time"
    assert body["submitted_at"].startswith("2026-11-11T01:00")
    assert send(client, world).status_code == 409
    me = client.get(url(world, "/me"), headers=as_user("m1@t.demo")).json()
    assert me["today"]["id"] == body["id"]


def test_leads_cannot_send_and_only_photos_are_accepted(client, world, clock):
    assert send(client, world, who="lead").status_code == 403
    assert send(client, world, data=b"%PDF-1.4 not a photo").status_code == 415
    assert send(client, world, data=PNG).status_code == 201


def test_grid_flags_late_and_missing(client, world, clock):
    send(client, world, who="m1")
    clock(DUE + timedelta(minutes=5))
    assert send(client, world, who="m2").json()["status"] == "late"
    g = client.get(url(world, "/grid"), headers=as_user("lead@t.demo")).json()
    assert {t["name"]: t["status"] for t in g["tiles"]} == {"m1": "on_time", "m2": "late", "m3": "missing"}
    assert g["counts"]["flagged"] == 2 and g["past_due"]


def test_grid_and_settings_are_leads_only(client, world, clock):
    m = as_user("m1@t.demo")
    assert client.get(url(world, "/grid"), headers=m).status_code == 403
    assert client.patch(url(world, "/settings"), json={"due_minute": 1200}, headers=m).status_code == 403
    r = client.patch(url(world, "/settings"), json={"due_minute": 1200}, headers=as_user("admin@t.demo"))
    assert r.status_code == 200 and r.json()["due_minute"] == 1200
    assert client.get(url(world, "/grid?day=2026-11-12"), headers=as_user("lead@t.demo")).status_code == 422


def test_photos_are_private(client, world, clock):
    cid = send(client, world).json()["id"]
    assert client.get(f"/bp/{cid}/photo", headers=as_user("m1@t.demo")).status_code == 200
    assert client.get(f"/bp/{cid}/photo", headers=as_user("lead@t.demo")).status_code == 200
    assert client.get(f"/bp/{cid}/photo", headers=as_user("m2@t.demo")).status_code == 404
    assert client.get(f"/bp/{cid}/photo", headers=as_user("outsider@t.demo")).status_code == 404


def test_other_groups_get_404(client, world, clock):
    h = as_user("outsider@t.demo")
    for path in ("/me", "/grid", "/settings"):
        assert client.get(url(world, path), headers=h).status_code == 404, path


def test_turned_off_blocks_sending(client, world, clock):
    client.patch(url(world, "/settings"), json={"enabled": False}, headers=as_user("lead@t.demo"))
    assert send(client, world).status_code == 409
