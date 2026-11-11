"""Web Push: subscriptions, quiet hours, no duplicates, and the cron endpoint."""
from datetime import timedelta

import pytest

from app import push
from app.auth import notify
from app.config import get_settings
from app.db import SessionLocal, now
from app.models import Notification, NotificationPrefs, PushDelivery, PushSubscription

from .conftest import as_user

SUB = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "key", "auth": "secret"}, "device": "iPhone"}


@pytest.fixture
def vapid(monkeypatch):
    """Turn push on with a fake sender. Returns the list of (endpoint, payload) it was given."""
    monkeypatch.setattr(get_settings(), "vapid_public_key", "pub")
    monkeypatch.setattr(get_settings(), "vapid_private_key", "priv")
    sent: list[tuple[str, dict]] = []
    monkeypatch.setattr(push, "send_one", lambda sub, payload: sent.append((sub.endpoint, payload)))
    return sent


def _notify(user_id, title="Hello", minutes_ago=0):
    with SessionLocal() as db:
        n = Notification(user_id=user_id, category="task", title=title, link="/app",
                         created_at=now() - timedelta(minutes=minutes_ago))
        db.add(n)
        db.commit()
        return n.id


def _run():
    with SessionLocal() as db:
        return push.send_pending(db)


def test_not_configured_says_so(client, world):
    assert client.get("/push/config").json() == {"configured": False, "public_key": None}
    r = client.post("/push/subscriptions", json=SUB, headers=as_user("m1@t.demo"))
    assert r.status_code == 409 and "VAPID" in r.json()["detail"]
    _notify(world["m1"])
    assert _run() == 0


def test_subscribe_list_and_remove_devices(client, world, vapid):
    h = as_user("m1@t.demo")
    assert client.get("/push/config").json() == {"configured": True, "public_key": "pub"}
    assert client.post("/push/subscriptions", json=SUB, headers=h).status_code == 201
    assert client.post("/push/subscriptions", json=SUB, headers=h).status_code == 201  # same device: no duplicate
    devices = client.get("/push/devices", headers=h).json()
    assert [d["device"] for d in devices] == ["iPhone"]
    # Plain http push endpoints are rejected.
    assert client.post("/push/subscriptions", json={**SUB, "endpoint": "http://x"}, headers=h).status_code == 422
    # Someone else can't remove it.
    assert client.delete(f"/push/devices/{devices[0]['id']}", headers=as_user("m2@t.demo")).status_code == 404
    assert client.delete(f"/push/devices/{devices[0]['id']}", headers=h).status_code == 204
    assert client.get("/push/devices", headers=h).json() == []


def test_shared_device_follows_latest_sign_in(client, world, vapid):
    client.post("/push/subscriptions", json=SUB, headers=as_user("m1@t.demo"))
    client.post("/push/subscriptions", json=SUB, headers=as_user("m2@t.demo"))
    assert client.get("/push/devices", headers=as_user("m1@t.demo")).json() == []
    assert len(client.get("/push/devices", headers=as_user("m2@t.demo")).json()) == 1


def test_pushes_each_notification_once(client, world, vapid):
    client.post("/push/subscriptions", json=SUB, headers=as_user("m1@t.demo"))
    nid = _notify(world["m1"], "New task: BP post")
    _notify(world["m2"])  # no device: recorded, not sent
    assert _run() == 1
    assert vapid == [(SUB["endpoint"], {"title": "New task: BP post", "body": "", "link": "/app", "tag": f"task-{nid}"})]
    assert _run() == 0 and len(vapid) == 1
    with SessionLocal() as db:
        assert {d.status for d in db.query(PushDelivery)} == {"sent", "no_device"}


def test_skips_old_and_read_notifications(client, world, vapid):
    client.post("/push/subscriptions", json=SUB, headers=as_user("m1@t.demo"))
    _notify(world["m1"], minutes_ago=45)
    nid = _notify(world["m1"])
    client.post("/notifications/read", json={"ids": [nid]}, headers=as_user("m1@t.demo"))
    assert _run() == 0 and vapid == []


def test_quiet_hours_hold_pushes(client, world, vapid):
    h = as_user("m1@t.demo")
    client.post("/push/subscriptions", json=SUB, headers=h)
    local = now().astimezone(__import__("zoneinfo").ZoneInfo("America/New_York"))
    minute = local.hour * 60 + local.minute
    r = client.put("/me/notification-prefs", json={"quiet_start_minute": minute, "quiet_end_minute": (minute + 60) % 1440}, headers=h)
    assert r.status_code == 200
    _notify(world["m1"])
    assert _run() == 0 and vapid == []
    with SessionLocal() as db:
        assert db.query(PushDelivery).one().status == "quiet"


def test_quiet_hours_validation(client, world):
    h = as_user("m1@t.demo")
    assert client.get("/me/notification-prefs", headers=h).json()["quiet_start_minute"] is None
    assert client.put("/me/notification-prefs", json={"quiet_start_minute": 600}, headers=h).status_code == 422
    assert client.put("/me/notification-prefs", json={"quiet_start_minute": 600, "quiet_end_minute": 600}, headers=h).status_code == 422
    ok = client.put("/me/notification-prefs", json={"quiet_start_minute": 1320, "quiet_end_minute": 420}, headers=h)
    assert ok.json()["quiet_end_minute"] == 420
    off = client.put("/me/notification-prefs", json={"quiet_start_minute": None, "quiet_end_minute": None}, headers=h)
    assert off.json()["quiet_start_minute"] is None


def test_gone_devices_are_removed(client, world, monkeypatch):
    monkeypatch.setattr(get_settings(), "vapid_public_key", "pub")
    monkeypatch.setattr(get_settings(), "vapid_private_key", "priv")

    def gone(sub, payload):
        raise push.Gone()

    monkeypatch.setattr(push, "send_one", gone)
    client.post("/push/subscriptions", json=SUB, headers=as_user("m1@t.demo"))
    _notify(world["m1"])
    assert _run() == 0
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 0
        assert db.query(PushDelivery).one().status == "failed"


def test_test_push(client, world, vapid):
    h = as_user("m1@t.demo")
    assert client.post("/push/test", headers=h).status_code == 409
    client.post("/push/subscriptions", json=SUB, headers=h)
    assert client.post("/push/test", headers=h).json() == {"sent": 1}
    assert vapid[0][1]["title"] == "Test notification"


def test_notify_rows_reach_the_sender(client, world, vapid):
    client.post("/push/subscriptions", json=SUB, headers=as_user("m1@t.demo"))
    with SessionLocal() as db:
        notify(db, world["m1"], world["org_a"], "review", "BP post approved", link="/app")
        db.commit()
    assert _run() == 1


def test_cron_tick_needs_the_secret(client, world, monkeypatch, vapid):
    assert client.post("/cron/tick").status_code == 404  # off without a secret
    monkeypatch.setattr(get_settings(), "cron_secret", "s3cret")
    assert client.post("/cron/tick").status_code == 403
    assert client.post("/cron/tick", headers={"X-Cron-Secret": "wrong"}).status_code == 403
    client.post("/push/subscriptions", json=SUB, headers=as_user("m1@t.demo"))
    _notify(world["m1"])
    assert client.post("/cron/tick", headers={"X-Cron-Secret": "s3cret"}).json() == {"ok": True}
    assert len(vapid) == 1


def test_prefs_table_is_per_user(client, world):
    client.put("/me/notification-prefs", json={"quiet_start_minute": 1, "quiet_end_minute": 2}, headers=as_user("m1@t.demo"))
    with SessionLocal() as db:
        assert db.query(NotificationPrefs).count() == 1
    assert client.get("/me/notification-prefs", headers=as_user("m2@t.demo")).json()["quiet_start_minute"] is None
