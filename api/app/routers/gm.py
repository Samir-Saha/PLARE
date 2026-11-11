"""Good-morning messages: members send a daily goal plus the code word, and leads get one inbox.

The day, deadline, submit time, and flags are all computed on the server. The NME posts a
code word per day; members see it only once that day has started, never ahead of time.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from zoneinfo import available_timezones

from ..auth import LEADS, audit, current_user, membership, notify
from ..db import get_db, now
from ..engine import gm as rules
from ..models import GmCode, GmMessage, GmReminder, GmSettings, Membership, Notification, Role, User

router = APIRouter()


class SettingsIn(BaseModel):
    enabled: bool | None = None
    due_minute: int | None = Field(None, ge=0, le=24 * 60 - 1)
    reminder_minutes: int | None = Field(None, ge=1, le=120)
    timezone: str | None = None


class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class GmIn(BaseModel):
    goal: str = Field(min_length=1, max_length=1000)
    code: str = Field(min_length=1, max_length=64)


def get_settings_row(db: Session, org_id: str, tz: str = "America/New_York") -> GmSettings:
    s = db.get(GmSettings, org_id)
    if s is None:
        s = GmSettings(org_id=org_id, due_minute=rules.DEFAULT_DUE_MINUTE,
                       reminder_minutes=rules.DEFAULT_REMINDER_MINUTES, timezone=tz, enabled=True)
        db.add(s)
        db.flush()
    return s


def _settings(s: GmSettings, day: date) -> dict:
    return {
        "enabled": s.enabled, "due_minute": s.due_minute, "reminder_minutes": s.reminder_minutes,
        "timezone": s.timezone, "day": day.isoformat(),
        "due_at": rules.due_at(day, s.due_minute, s.timezone),
        "reminder_at": rules.reminder_at(day, s.due_minute, s.reminder_minutes, s.timezone),
    }


def _code_for(db: Session, org_id: str, day: str) -> str | None:
    row = db.scalar(select(GmCode).where(GmCode.org_id == org_id, GmCode.day == day))
    return row.code if row else None


def _message(m: GmMessage, expected: str | None, show_code: bool) -> dict:
    out = {
        "id": m.id, "user_id": m.user_id, "user_name": m.user.name, "day": m.day, "goal": m.goal,
        "submitted_at": m.submitted_at, "due_at": m.due_at,
        "late": m.submitted_at > m.due_at,
        "code_status": rules.code_status(m.code_given, expected),
        "flags": rules.flags(m.submitted_at, m.due_at, m.code_given, expected),
    }
    if show_code:
        out["code_given"] = m.code_given
    return out


def _parse_day(day: str) -> date:
    try:
        return date.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(422, "Use a date like 2026-11-10") from exc


@router.get("/orgs/{org_id}/gm/settings")
def read_settings(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    s = get_settings_row(db, org_id, user.timezone)
    db.commit()
    return _settings(s, rules.local_day(now(), s.timezone))


@router.patch("/orgs/{org_id}/gm/settings")
def update_settings(org_id: str, body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    s = get_settings_row(db, org_id, user.timezone)
    if body.timezone is not None:
        if body.timezone not in available_timezones():
            raise HTTPException(422, "Unknown timezone")
        s.timezone = body.timezone
    if body.enabled is not None:
        s.enabled = body.enabled
    if body.due_minute is not None:
        s.due_minute = body.due_minute
    if body.reminder_minutes is not None:
        s.reminder_minutes = body.reminder_minutes
    # The reminder has to land on the same day as the deadline.
    if s.due_minute < s.reminder_minutes:
        raise HTTPException(422, f"Pick a due time at least {s.reminder_minutes} minutes after midnight.")
    audit(db, org_id, user, "gm.settings", f"due {s.due_minute} remind {s.reminder_minutes} {s.timezone}")
    db.commit()
    return _settings(s, rules.local_day(now(), s.timezone))


@router.get("/orgs/{org_id}/gm/me")
def my_gm(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Today's deadline, the caller's message for today, and their last two weeks."""
    membership(db, user, org_id)
    s = get_settings_row(db, org_id, user.timezone)
    db.commit()
    today = rules.local_day(now(), s.timezone)
    rows = db.scalars(
        select(GmMessage).where(GmMessage.org_id == org_id, GmMessage.user_id == user.id)
        .order_by(GmMessage.day.desc()).limit(14)
    ).all()
    codes = {c.day: c.code for c in db.scalars(
        select(GmCode).where(GmCode.org_id == org_id, GmCode.day.in_([m.day for m in rows]))
    )}
    history = [_message(m, codes.get(m.day), show_code=False) for m in rows]
    return {
        **_settings(s, today),
        "today": next((h for h in history if h["day"] == today.isoformat()), None),
        "history": history,
        "code": _code_for(db, org_id, today.isoformat()),  # today's only; future days stay hidden
    }


@router.post("/orgs/{org_id}/gm", status_code=201)
def send_gm(org_id: str, body: GmIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = membership(db, user, org_id)
    if Role(m.role) != Role.member:
        raise HTTPException(403, "GM messages are sent by members of the group.")
    s = get_settings_row(db, org_id, user.timezone)
    if not s.enabled:
        raise HTTPException(409, "GM messages are turned off for this group.")
    at = now()
    day = rules.local_day(at, s.timezone)
    already = "You already sent today's GM message. You can send the next one tomorrow."
    if db.scalar(select(GmMessage.id).where(
        GmMessage.org_id == org_id, GmMessage.user_id == user.id, GmMessage.day == day.isoformat()
    )):
        raise HTTPException(409, already)
    # Sending clears today's reminder.
    for n in db.scalars(select(Notification).where(
        Notification.user_id == user.id, Notification.org_id == org_id, Notification.category == "gm",
        Notification.read_at.is_(None),
    )):
        n.read_at = at
    msg = GmMessage(org_id=org_id, user_id=user.id, day=day.isoformat(), goal=body.goal.strip(),
                    code_given=body.code.strip(), due_at=rules.due_at(day, s.due_minute, s.timezone),
                    submitted_at=at)
    db.add(msg)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, already)  # a double-tap that raced the check above
    db.refresh(msg)
    return _message(msg, _code_for(db, org_id, msg.day), show_code=False)


@router.get("/orgs/{org_id}/gm/inbox")
def inbox(org_id: str, day: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Every member's GM for one day, with late, wrong-code, and missing flags."""
    membership(db, user, org_id, *LEADS)
    s = get_settings_row(db, org_id, user.timezone)
    db.commit()
    today = rules.local_day(now(), s.timezone)
    d = _parse_day(day) if day else today
    key = d.isoformat()
    code = _code_for(db, org_id, key)
    rows = db.scalars(
        select(GmMessage).where(GmMessage.org_id == org_id, GmMessage.day == key).order_by(GmMessage.submitted_at)
    ).all()
    messages = [_message(m, code, show_code=True) for m in rows]
    sent = {m.user_id for m in rows}
    members = sorted(
        (m for m in db.scalars(select(Membership).where(Membership.org_id == org_id)) if Role(m.role) == Role.member),
        key=lambda m: m.user.name.lower(),
    )
    # Before today's deadline, people without a message are "not yet"; after it, they're missing.
    past_due = now() > rules.due_at(d, s.due_minute, s.timezone)
    return {
        **_settings(s, d),
        "today": today.isoformat(),
        "code": code,
        "past_due": past_due,
        "messages": messages,
        "not_sent": [{"user_id": m.user_id, "name": m.user.name} for m in members if m.user_id not in sent],
        "counts": {
            "members": len(members),
            "sent": len(messages),
            "on_time": sum(1 for m in messages if not m["flags"]),
            "flagged": sum(1 for m in messages if m["flags"]),
            "missing": sum(1 for m in members if m.user_id not in sent) if past_due else 0,
        },
    }


@router.put("/orgs/{org_id}/gm/codes/{day}")
def set_code(org_id: str, day: str, body: CodeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    s = get_settings_row(db, org_id, user.timezone)
    d = _parse_day(day)
    today = rules.local_day(now(), s.timezone)
    if not today - timedelta(days=30) <= d <= today + timedelta(days=60):
        raise HTTPException(422, "Set code words for a day within the last 30 or next 60 days.")
    row = db.scalar(select(GmCode).where(GmCode.org_id == org_id, GmCode.day == d.isoformat()))
    if row is None:
        row = GmCode(org_id=org_id, day=d.isoformat(), code=body.code.strip(), set_by=user.id)
        db.add(row)
    else:
        row.code, row.set_by = body.code.strip(), user.id
    audit(db, org_id, user, "gm.code", d.isoformat())
    if d == today:  # posting today's word tells members who haven't sent yet
        done = set(db.scalars(select(GmMessage.user_id).where(GmMessage.org_id == org_id, GmMessage.day == row.day)))
        for m in db.scalars(select(Membership).where(Membership.org_id == org_id)):
            if Role(m.role) == Role.member and m.user_id not in done:
                notify(db, m.user_id, org_id, "gm", "Today's GM code word is up",
                       f"Send your goal and the code word by {_clock(s.due_minute)}.", link="/app/gm")
    db.commit()
    return {"day": row.day, "code": row.code}


@router.get("/orgs/{org_id}/gm/codes")
def list_codes(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Code words from a week ago onward, for planning ahead."""
    membership(db, user, org_id, *LEADS)
    s = get_settings_row(db, org_id, user.timezone)
    db.commit()
    start = (rules.local_day(now(), s.timezone) - timedelta(days=7)).isoformat()
    rows = db.scalars(select(GmCode).where(GmCode.org_id == org_id, GmCode.day >= start).order_by(GmCode.day)).all()
    return [{"day": r.day, "code": r.code} for r in rows]


def _clock(minute: int) -> str:
    h, m = divmod(minute, 60)
    return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def send_gm_reminders(db: Session, at: datetime | None = None) -> int:
    """Remind each member who hasn't sent today's GM, once, starting N minutes before it's due.

    Safe to run every minute from several processes: the GmReminder unique key drops duplicates.
    """
    at = at or now()
    sent = 0
    for s in db.scalars(select(GmSettings).where(GmSettings.enabled.is_(True))).all():
        day = rules.local_day(at, s.timezone)
        due = rules.due_at(day, s.due_minute, s.timezone)
        if not rules.should_remind(at, due, s.reminder_minutes):
            continue
        key = day.isoformat()
        done = set(db.scalars(select(GmMessage.user_id).where(GmMessage.org_id == s.org_id, GmMessage.day == key)))
        reminded = set(db.scalars(select(GmReminder.user_id).where(GmReminder.org_id == s.org_id, GmReminder.day == key)))
        code = _code_for(db, s.org_id, key)
        members = db.scalars(select(Membership).where(Membership.org_id == s.org_id)).all()
        for m in members:
            if Role(m.role) != Role.member or m.user_id in done or m.user_id in reminded:
                continue
            try:
                with db.begin_nested():
                    db.add(GmReminder(org_id=s.org_id, user_id=m.user_id, day=key))
                    notify(db, m.user_id, s.org_id, "gm", "Send your GM message",
                           f"It's due at {_clock(s.due_minute)}. Add your goal for today and the code word"
                           + (f" ({code})." if code else "."),
                           link="/app/gm")
                sent += 1
            except IntegrityError:
                pass  # another worker already reminded this person
    db.commit()
    return sent
