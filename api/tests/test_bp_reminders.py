from datetime import datetime, timedelta

from sqlalchemy import select

from app.bp_reminders import send_due_reminders
from app.db import SessionLocal
from app.engine import bp as rules
from app.models import BpSettings, Notification
from app.routers.bp import get_settings_row
from .conftest import as_user


JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


def _enable(world, due_minute=12 * 60):
    with SessionLocal() as db:
        s = get_settings_row(db, world["org_a"], "America/New_York")
        s.enabled = True
        s.due_minute = due_minute
        s.timezone = "America/New_York"
        db.commit()
        return s.timezone, s.due_minute


def test_bp_due_reminder_once_per_day_and_not_if_already_posted(client, world):
    tz, due_minute = _enable(world)
    # A Tuesday 17:00 New York is 22:00 UTC in winter.
    at = datetime.fromisoformat("2030-01-14T22:00:00+00:00")
    due = rules.due_at(rules.local_day(at, tz), due_minute, tz)
    # More than an hour early: nothing.
    with SessionLocal() as db:
        assert send_due_reminders(db, due - timedelta(hours=2)) == 0
    with SessionLocal() as db:
        sent = send_due_reminders(db, due - timedelta(minutes=30))
        assert sent == 3  # m1, m2, m3
    with SessionLocal() as db:
        assert send_due_reminders(db, due - timedelta(minutes=10)) == 0  # unique per day
        notes = db.scalars(select(Notification).where(Notification.category == "bp")).all()
        assert len(notes) == 3

    # A fresh day: m1 posts first, then only m2 and m3 are reminded.
    later = due + timedelta(days=1)
    # Shift settings so "today" matches `later`'s local day — posting uses server now(),
    # so this test only checks the reminder skip-if-posted path via the DB helper, not the HTTP post.
    day = rules.local_day(later - timedelta(minutes=30), tz)
    from app.models import BpCheckin
    with SessionLocal() as db:
        db.add(BpCheckin(
            org_id=world["org_a"], user_id=world["m1"], day=day.isoformat(),
            file_path="x.jpg", file_type="image/jpeg",
            due_at=rules.due_at(day, due_minute, tz), submitted_at=later - timedelta(hours=2),
        ))
        db.commit()
        sent = send_due_reminders(db, later - timedelta(minutes=30))
        assert sent == 2


def test_leads_are_notified_on_every_bp_post(client, world):
    _enable(world, due_minute=23 * 60)  # late evening, so a now-post is typically on time
    r = client.post(
        f"/orgs/{world['org_a']}/bp",
        headers=as_user("m1@t.demo"),
        data={"caption": "done"},
        files={"photo": ("bp.jpg", JPEG, "image/jpeg")},
    )
    assert r.status_code == 201, r.text
    with SessionLocal() as db:
        titles = [n.title for n in db.scalars(select(Notification).where(Notification.category == "bp"))]
    # Admin and lead both get a post alert (not only late posts).
    assert any("posted today's BP" in t or "came in late" in t for t in titles)
    assert len(titles) >= 2
