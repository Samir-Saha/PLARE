"""Due-soon and overdue BP reminders. One notification per person per day."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import notify
from .db import now
from .engine import bp as rules
from .models import BpCheckin, BpReminder, BpSettings, Membership, Role


def send_due_reminders(db: Session, at: datetime | None = None) -> int:
    at = at or now()
    sent = 0
    for settings in db.scalars(select(BpSettings).where(BpSettings.enabled.is_(True))).all():
        day = rules.local_day(at, settings.timezone)
        due = rules.due_at(day, settings.due_minute, settings.timezone)
        if at < due - timedelta(hours=1):
            continue
        key = day.isoformat()
        posted = set(db.scalars(select(BpCheckin.user_id).where(
            BpCheckin.org_id == settings.org_id, BpCheckin.day == key,
        )))
        already = set(db.scalars(select(BpReminder.user_id).where(
            BpReminder.org_id == settings.org_id, BpReminder.day == key,
        )))
        members = db.scalars(select(Membership).where(
            Membership.org_id == settings.org_id, Membership.role == Role.member,
        )).all()
        late = at > due
        title = "BP is overdue" if late else "BP is due soon"
        body = (
            "Today's BP photo is overdue. Open PLARE to post it."
            if late else
            "Today's BP photo is due within the hour. Open PLARE to post it."
        )
        for member in members:
            if member.user_id in posted or member.user_id in already:
                continue
            try:
                with db.begin_nested():
                    db.add(BpReminder(org_id=settings.org_id, user_id=member.user_id, day=key))
                    db.flush()
                    notify(db, member.user_id, settings.org_id, "bp", title, body, link="/app/bp")
                sent += 1
            except IntegrityError:
                pass
    db.commit()
    return sent
