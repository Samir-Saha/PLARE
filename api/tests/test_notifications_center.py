from app.db import SessionLocal
from app.models import Notification
from .conftest import as_user
from .test_api import make_task


def test_unread_count_and_mark_read(client, world):
    make_task(client, world, title="Hello", assign="users", user_ids=[world["m1"]])
    headers = as_user("m1@t.demo")
    r = client.get("/notifications/unread-count", headers=headers)
    assert r.status_code == 200
    assert r.json()["count"] >= 1
    listed = client.get("/notifications", headers=headers).json()
    assert listed[0]["title"]
    client.post("/notifications/read", headers=headers, json={})
    assert client.get("/notifications/unread-count", headers=headers).json()["count"] == 0
