"""BP check-in: members take their BP photo in the app, and leads see a grid of everyone for the day.

The server stamps the time and works out the day, so a photo can't be backdated. Late and
missing photos are flagged automatically. Photos are private: only the member who took one
and the group's leads can open it.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from zoneinfo import available_timezones

from .. import storage
from ..auth import LEADS, audit, current_user, membership, notify
from ..config import get_settings
from ..db import get_db, now
from ..engine import bp as rules
from ..models import BpCheckin, BpSettings, Membership, Role, User, uid

router = APIRouter()

# Photos only, checked against the file's leading bytes, not the client's claim.
PHOTO_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff", ".jpg"),
    "image/png": (b"\x89PNG\r\n\x1a\n", ".png"),
}


class SettingsIn(BaseModel):
    enabled: bool | None = None
    due_minute: int | None = Field(None, ge=0, le=24 * 60 - 1)
    timezone: str | None = None


def get_settings_row(db: Session, org_id: str, tz: str = "America/New_York") -> BpSettings:
    s = db.get(BpSettings, org_id)
    if s is None:
        s = BpSettings(org_id=org_id, enabled=True, due_minute=rules.DEFAULT_DUE_MINUTE, timezone=tz)
        db.add(s)
        db.flush()
    return s


def _settings(s: BpSettings, day: date) -> dict:
    return {
        "enabled": s.enabled, "due_minute": s.due_minute, "timezone": s.timezone,
        "day": day.isoformat(), "due_at": rules.due_at(day, s.due_minute, s.timezone),
    }


def _checkin(c: BpCheckin) -> dict:
    late = c.submitted_at > c.due_at
    return {
        "id": c.id, "user_id": c.user_id, "user_name": c.user.name, "day": c.day, "caption": c.caption,
        "submitted_at": c.submitted_at, "due_at": c.due_at, "late": late,
        "status": "late" if late else "on_time",
    }


def _parse_day(day: str) -> date:
    try:
        return date.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(422, "Use a date like 2026-11-10") from exc


def _members(db: Session, org_id: str) -> list[Membership]:
    return sorted(
        (m for m in db.scalars(select(Membership).where(Membership.org_id == org_id)) if Role(m.role) == Role.member),
        key=lambda m: m.user.name.lower(),
    )


@router.get("/orgs/{org_id}/bp/settings")
def read_settings(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    s = get_settings_row(db, org_id, user.timezone)
    db.commit()
    return _settings(s, rules.local_day(now(), s.timezone))


@router.patch("/orgs/{org_id}/bp/settings")
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
    audit(db, org_id, user, "bp.settings", f"due {s.due_minute} {s.timezone} enabled={s.enabled}")
    db.commit()
    return _settings(s, rules.local_day(now(), s.timezone))


@router.get("/orgs/{org_id}/bp/me")
def my_bp(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Today's deadline, the caller's photo for today, and their last two weeks."""
    membership(db, user, org_id)
    s = get_settings_row(db, org_id, user.timezone)
    db.commit()
    today = rules.local_day(now(), s.timezone)
    rows = db.scalars(
        select(BpCheckin).where(BpCheckin.org_id == org_id, BpCheckin.user_id == user.id)
        .order_by(BpCheckin.day.desc()).limit(14)
    ).all()
    history = [_checkin(c) for c in rows]
    return {
        **_settings(s, today),
        "today": next((h for h in history if h["day"] == today.isoformat()), None),
        "history": history,
    }


@router.post("/orgs/{org_id}/bp", status_code=201)
async def check_in(
    org_id: str,
    photo: UploadFile = File(...),
    caption: str = Form("", max_length=280),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    m = membership(db, user, org_id)
    if Role(m.role) != Role.member:
        raise HTTPException(403, "BP check-ins are sent by members of the group.")
    s = get_settings_row(db, org_id, user.timezone)
    if not s.enabled:
        raise HTTPException(409, "BP check-ins are turned off for this group.")
    at = now()  # the server's clock, never the phone's
    day = rules.local_day(at, s.timezone)
    already = "You already sent today's BP. You can send the next one tomorrow."
    if db.scalar(select(BpCheckin.id).where(
        BpCheckin.org_id == org_id, BpCheckin.user_id == user.id, BpCheckin.day == day.isoformat()
    )):
        raise HTTPException(409, already)

    settings = get_settings()
    data = await photo.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, f"Photo is larger than {settings.max_upload_bytes // (1024 * 1024)} MB")
    file_type = next((mime for mime, (sig, _) in PHOTO_SIGNATURES.items() if data.startswith(sig)), None)
    if file_type is None:
        raise HTTPException(415, "Take the photo again. Only JPEG or PNG photos are accepted.")
    file_path = storage.put(f"{org_id}/bp/{uid()}{PHOTO_SIGNATURES[file_type][1]}", data)

    due = rules.due_at(day, s.due_minute, s.timezone)
    c = BpCheckin(org_id=org_id, user_id=user.id, day=day.isoformat(), caption=caption.strip(),
                  file_path=file_path, file_type=file_type, due_at=due, submitted_at=at)
    db.add(c)
    # Tell leads about every post, and flag late ones in the message.
    late = at > due
    title = f"{user.name}'s BP came in late" if late else f"{user.name} posted today's BP"
    for lead in db.scalars(select(Membership).where(Membership.org_id == org_id, Membership.role.in_(LEADS))):
        notify(db, lead.user_id, org_id, "bp", title, link="/app/bp")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        storage.remove(file_path)
        raise HTTPException(409, already)  # a double-tap that raced the check above
    db.refresh(c)
    return _checkin(c)


@router.get("/orgs/{org_id}/bp/grid")
def grid(org_id: str, day: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Every member for one day: their photo if they sent one, with late and missing flagged."""
    membership(db, user, org_id, *LEADS)
    s = get_settings_row(db, org_id, user.timezone)
    db.commit()
    at = now()
    today = rules.local_day(at, s.timezone)
    d = _parse_day(day) if day else today
    if not rules.is_valid_day(d, today):
        raise HTTPException(422, "Pick today or a day in the last 30 days.")
    key = d.isoformat()
    due = rules.due_at(d, s.due_minute, s.timezone)
    by_user = {c.user_id: c for c in db.scalars(
        select(BpCheckin).where(BpCheckin.org_id == org_id, BpCheckin.day == key)
    )}
    tiles = []
    for m in _members(db, org_id):
        c = by_user.get(m.user_id)
        tiles.append({
            "user_id": m.user_id, "name": m.user.name,
            "status": rules.status(c.submitted_at if c else None, c.due_at if c else due, at),
            "checkin": _checkin(c) if c else None,
        })
    return {
        **_settings(s, d),
        "today": today.isoformat(),
        "past_due": at > due,
        "tiles": tiles,
        "counts": rules.counts([t["status"] for t in tiles]),
    }


@router.get("/bp/{checkin_id}/photo")
def photo(checkin_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Private: only the member who took it and the group's leads can open it."""
    c = db.get(BpCheckin, checkin_id)
    if c is None:
        raise HTTPException(404, "Photo not found")
    m = membership(db, user, c.org_id)
    if c.user_id != user.id and Role(m.role) not in LEADS:
        raise HTTPException(404, "Photo not found")
    return storage.file_response(c.file_path, c.file_type)
