"""Random BP check-ins: brothers' settings and pledges' blocked times.

Brothers turn check-ins on for the group and choose the days, the window, how many per day,
how long each stays open, and whether class counts as blocked. Pledges list the times they
can't take a photo (class, interviews, religious services, work, medical). They can type
them in or pick them from their imported Google Calendar busy times on a confirmation step.

No location is collected. Brothers see the kind and time of each block, and when it was
added, so they can follow up in person. The note on a block is private to the pledge.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, available_timezones

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth import LEADS, audit, current_user, membership
from ..config import get_settings
from ..db import get_db, now
from ..engine import bp_checkin as rules
from ..models import BpBlock, BpDayPlan, BpPing, BpRandomSettings, BusyBlock, Membership, Role, User, uid

router = APIRouter()

MAX_BLOCKS = 60
# Blocks added this recently are flagged for brothers, so last-minute changes are visible.
RECENT = timedelta(hours=24)
KIND_PATTERN = "^(" + "|".join(rules.BLOCK_KINDS) + ")$"


class SettingsIn(BaseModel):
    enabled: bool
    weekdays: list[int] = Field(min_length=1, max_length=7)
    window_start_minute: int = Field(ge=0, le=24 * 60 - 1)
    window_end_minute: int = Field(ge=1, le=24 * 60)
    checks_per_day: int = Field(ge=1, le=3)
    response_minutes: int = Field(ge=5, le=60)
    class_blocks: bool = True
    timezone: str = "America/New_York"


class BlockIn(BaseModel):
    kind: str = Field(pattern=KIND_PATTERN)
    weekday: int | None = Field(None, ge=0, le=6)
    day: date | None = None
    start_minute: int = Field(ge=0, le=24 * 60 - 1)
    end_minute: int = Field(ge=1, le=24 * 60)
    note: str = Field("", max_length=120)
    source: str = Field("manual", pattern="^(manual|calendar)$")


class DeclineIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


PHOTO_TYPES = {"image/jpeg": (b"\xff\xd8\xff", ".jpg"), "image/png": (b"\x89PNG\r\n\x1a\n", ".png")}


class BlocksIn(BaseModel):
    blocks: list[BlockIn] = Field(min_length=1, max_length=MAX_BLOCKS)


def get_settings_row(db: Session, org_id: str) -> BpRandomSettings:
    """The group's settings, or unsaved defaults (check-ins off)."""
    return db.get(BpRandomSettings, org_id) or BpRandomSettings(
        org_id=org_id, enabled=False, weekdays="0,1,2,3,4", window_start_minute=9 * 60, window_end_minute=17 * 60,
        checks_per_day=1, response_minutes=15, class_blocks=True, timezone="America/New_York",
    )


def weekdays_of(s: BpRandomSettings) -> list[int]:
    return [int(d) for d in s.weekdays.split(",") if d != ""]


def settings_dict(s: BpRandomSettings) -> dict:
    return {
        "enabled": s.enabled, "weekdays": weekdays_of(s), "window_start_minute": s.window_start_minute,
        "window_end_minute": s.window_end_minute, "checks_per_day": s.checks_per_day,
        "response_minutes": s.response_minutes, "class_blocks": s.class_blocks, "timezone": s.timezone,
    }


def block_rules(db: Session, user_id: str) -> list[rules.BlockRule]:
    return [
        rules.BlockRule(b.kind, b.start_minute, b.end_minute, weekday=b.weekday,
                        day=date.fromisoformat(b.day) if b.day else None)
        for b in db.scalars(select(BpBlock).where(BpBlock.user_id == user_id))
    ]


def block_dict(b: BpBlock, private: bool) -> dict:
    out = {
        "id": b.id, "kind": b.kind, "kind_label": rules.BLOCK_KINDS.get(b.kind, b.kind), "weekday": b.weekday,
        "day": b.day, "start_minute": b.start_minute, "end_minute": b.end_minute, "source": b.source,
        "created_at": b.created_at, "recent": now() - b.created_at < RECENT,
    }
    if private:
        out["note"] = b.note
    return out


def replan_today(db: Session, user_id: str | None = None, org_id: str | None = None) -> None:
    """Drop today's check-ins that haven't opened yet, so the next scheduler pass plans them again
    with the current blocks and settings. Check-ins already sent are kept."""
    q = select(BpRandomSettings)
    if org_id:
        q = q.where(BpRandomSettings.org_id == org_id)
    for s in db.scalars(q):
        today = datetime.now(ZoneInfo(s.timezone)).date().isoformat()
        pings = delete(BpPing).where(BpPing.org_id == s.org_id, BpPing.day == today, BpPing.notified.is_(False))
        plans = delete(BpDayPlan).where(BpDayPlan.org_id == s.org_id, BpDayPlan.day == today)
        if user_id:
            pings, plans = pings.where(BpPing.user_id == user_id), plans.where(BpDayPlan.user_id == user_id)
        db.execute(pings)
        db.execute(plans)


# --- Brothers: settings ----------------------------------------------------------------------

@router.get("/orgs/{org_id}/bp/random/settings")
def read_settings(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    return settings_dict(get_settings_row(db, org_id))


@router.put("/orgs/{org_id}/bp/random/settings")
def write_settings(org_id: str, body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    if body.timezone not in available_timezones():
        raise HTTPException(422, "Pick a timezone from the list.")
    if body.window_end_minute - body.window_start_minute < body.response_minutes:
        raise HTTPException(422, "The window has to be longer than the time each check-in stays open.")
    days = sorted(set(body.weekdays))
    if any(d < 0 or d > 6 for d in days):
        raise HTTPException(422, "Pick days from Monday to Sunday.")
    s = db.get(BpRandomSettings, org_id)
    if s is None:
        s = BpRandomSettings(org_id=org_id)
        db.add(s)
    s.enabled, s.weekdays = body.enabled, ",".join(map(str, days))
    s.window_start_minute, s.window_end_minute = body.window_start_minute, body.window_end_minute
    s.checks_per_day, s.response_minutes, s.class_blocks = body.checks_per_day, body.response_minutes, body.class_blocks
    s.timezone, s.updated_by = body.timezone, user.id
    db.flush()
    replan_today(db, org_id=org_id)
    audit(db, org_id, user, "bp_random.settings", "on" if body.enabled else "off")
    db.commit()
    return settings_dict(s)


# --- Pledges: blocked times ------------------------------------------------------------------

@router.get("/me/bp/random/blocks")
def my_blocks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(BpBlock).where(BpBlock.user_id == user.id)
                      .order_by(BpBlock.day.is_not(None), BpBlock.weekday, BpBlock.day, BpBlock.start_minute)).all()
    return [block_dict(b, private=True) for b in rows]


@router.post("/me/bp/random/blocks", status_code=201)
def add_blocks(body: BlocksIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = datetime.now(ZoneInfo(user.timezone)).date()
    have = db.scalar(select(func.count()).select_from(BpBlock).where(BpBlock.user_id == user.id))
    if have + len(body.blocks) > MAX_BLOCKS:
        raise HTTPException(422, f"You can have up to {MAX_BLOCKS} blocked times. Remove some you don't need first.")
    for b in body.blocks:
        if (b.weekday is None) == (b.day is None):
            raise HTTPException(422, "Pick a day of the week for a weekly time, or a date for a one-time one.")
        if b.end_minute <= b.start_minute:
            raise HTTPException(422, "The end time has to be after the start time.")
        if b.day is not None and b.day < today:
            raise HTTPException(422, "That date has already passed.")
        db.add(BpBlock(user_id=user.id, kind=b.kind, weekday=b.weekday, day=b.day.isoformat() if b.day else None,
                       start_minute=b.start_minute, end_minute=b.end_minute, note=b.note.strip(), source=b.source))
    db.flush()
    replan_today(db, user_id=user.id)
    db.commit()
    return my_blocks(user, db)


@router.delete("/me/bp/blocks/{block_id}", status_code=204)
def remove_block(block_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = db.get(BpBlock, block_id)
    if b is None or b.user_id != user.id:
        raise HTTPException(404, "Blocked time not found")
    db.delete(b)
    db.flush()
    replan_today(db, user_id=user.id)
    db.commit()
    return Response(status_code=204)


@router.get("/me/bp/calendar")
def calendar_candidates(days: int = 7, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Imported Google Calendar busy times for the next `days` days, split by local day, for the
    confirmation step. PLARE only has start and end times, never event names."""
    if not 1 <= days <= 14:
        raise HTTPException(422, "Pick 1 to 14 days.")
    tz = ZoneInfo(user.timezone)
    start = now()
    rows = db.scalars(select(BusyBlock).where(BusyBlock.user_id == user.id, BusyBlock.end_at > start,
                                              BusyBlock.start_at < start + timedelta(days=days))
                      .order_by(BusyBlock.start_at)).all()
    mine = db.scalars(select(BpBlock).where(BpBlock.user_id == user.id)).all()
    out = []
    for r in rows:
        a, b = r.start_at.astimezone(tz), r.end_at.astimezone(tz)
        d = a.date()
        while d <= b.date():
            s_min = a.hour * 60 + a.minute if d == a.date() else 0
            e_min = b.hour * 60 + b.minute if d == b.date() else 24 * 60
            if e_min > s_min:
                covered = any(m.start_minute <= s_min and m.end_minute >= e_min
                              and (m.weekday == d.weekday() or m.day == d.isoformat()) for m in mine)
                out.append({"day": d.isoformat(), "weekday": d.weekday(), "start_minute": s_min,
                            "end_minute": e_min, "already_blocked": covered})
            d += timedelta(days=1)
    return {"connected": user.calendar_synced_at is not None, "synced_at": user.calendar_synced_at, "busy": out}


@router.get("/orgs/{org_id}/bp/random/blocks")
def group_blocks(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """For brothers: every pledge's blocked times (kind and time only) and weekly totals."""
    membership(db, user, org_id, *LEADS)
    members = db.scalars(select(Membership).where(Membership.org_id == org_id, Membership.role == Role.member)).all()
    out = []
    for m in members:
        blocks = db.scalars(select(BpBlock).where(BpBlock.user_id == m.user_id)
                            .order_by(BpBlock.day.is_not(None), BpBlock.weekday, BpBlock.day, BpBlock.start_minute)).all()
        weekly = rules.blocked_minutes_per_week(block_rules(db, m.user_id))
        out.append({"user_id": m.user_id, "name": m.user.name, "blocks": [block_dict(b, private=False) for b in blocks],
                    "weekly_minutes": weekly, "recent": sum(now() - b.created_at < RECENT for b in blocks)})
    return sorted(out, key=lambda p: p["name"].lower())


# --- Answering a check-in ----------------------------------------------------------------------

def _ping_dict(p: BpPing) -> dict:
    return {
        "id": p.id, "day": p.day, "ping_at": p.ping_at, "closes_at": p.closes_at, "response": p.response,
        "responded_at": p.responded_at, "decline_reason": p.decline_reason, "has_photo": bool(p.file_path),
    }


def _load_open_ping(db: Session, user: User, ping_id: str) -> BpPing:
    p = db.get(BpPing, ping_id)
    t = now()
    # A check-in that hasn't opened yet doesn't exist, as far as anyone can tell.
    if p is None or p.user_id != user.id or t < p.ping_at:
        raise HTTPException(404, "Check-in not found")
    membership(db, user, p.org_id)
    if p.response in ("photo", "declined"):
        raise HTTPException(409, "You already answered this check-in.")
    if t >= p.closes_at:
        raise HTTPException(409, "This check-in closed. Watch for the next one.")
    return p


@router.get("/orgs/{org_id}/bp/random/me")
def my_check_ins(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A pledge's view: the open check-in (if any), how today is going, and the last two weeks.
    Check-ins that haven't opened yet are counted but their times are never shown."""
    membership(db, user, org_id)
    s = get_settings_row(db, org_id)
    t = now()
    today = datetime.now(ZoneInfo(s.timezone)).date().isoformat()
    since = (datetime.now(ZoneInfo(s.timezone)).date() - timedelta(days=14)).isoformat()
    rows = db.scalars(select(BpPing).where(BpPing.org_id == org_id, BpPing.user_id == user.id, BpPing.day >= since)
                      .order_by(BpPing.ping_at.desc())).all()
    opened = [p for p in rows if p.ping_at <= t]
    open_now = next((p for p in opened if p.response is None and t < p.closes_at), None)
    return {
        "settings": settings_dict(s),
        "open": _ping_dict(open_now) if open_now else None,
        "today": {
            "planned": sum(p.day == today for p in rows),
            "still_to_come": sum(p.day == today and p.ping_at > t for p in rows),
            "photos": sum(p.day == today and p.response == "photo" for p in rows),
        },
        "history": [_ping_dict(p) for p in opened if p is not open_now],
    }


@router.post("/bp/pings/{ping_id}/photo")
async def send_photo(ping_id: str, photo: UploadFile = File(...), user: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    p = _load_open_ping(db, user, ping_id)
    cfg = get_settings()
    data = await photo.read(cfg.max_upload_bytes + 1)
    if len(data) > cfg.max_upload_bytes:
        raise HTTPException(413, f"Photo is larger than {cfg.max_upload_bytes // (1024 * 1024)} MB. Take it again.")
    file_type = next((mime for mime, (sig, _) in PHOTO_TYPES.items() if data.startswith(sig)), None)
    if file_type is None:
        raise HTTPException(415, "Send a JPEG or PNG photo.")
    file_path = f"{p.org_id}/bp/{uid()}{PHOTO_TYPES[file_type][1]}"
    target = Path(cfg.upload_dir) / file_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    p.response, p.responded_at, p.file_path, p.file_type = "photo", now(), file_path, file_type
    db.commit()
    return _ping_dict(p)


@router.post("/bp/pings/{ping_id}/decline")
def decline(ping_id: str, body: DeclineIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """"Can't right now." Always available while a check-in is open. Brothers see the reason;
    it isn't logged as missed."""
    p = _load_open_ping(db, user, ping_id)
    p.response, p.responded_at, p.decline_reason = "declined", now(), body.reason.strip()
    db.commit()
    return _ping_dict(p)


@router.get("/bp/pings/{ping_id}/photo")
def ping_photo(ping_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Private: the pledge who took it and the group's brothers."""
    p = db.get(BpPing, ping_id)
    if p is None or not p.file_path:
        raise HTTPException(404, "Photo not found")
    m = membership(db, user, p.org_id)
    if p.user_id != user.id and Role(m.role) not in LEADS:
        raise HTTPException(404, "Photo not found")
    path = Path(get_settings().upload_dir) / p.file_path
    if not path.is_file():
        raise HTTPException(404, "Photo not found")
    return FileResponse(path, media_type=p.file_type, headers={"Cache-Control": "private, no-store"})


@router.get("/orgs/{org_id}/bp/random/today")
def group_today(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """For brothers: today's check-ins per pledge and the last week's answers. Planned times that
    haven't opened stay hidden from brothers too, so nobody can tip a pledge off."""
    membership(db, user, org_id, *LEADS)
    s = get_settings_row(db, org_id)
    t = now()
    local_today = datetime.now(ZoneInfo(s.timezone)).date()
    today, since = local_today.isoformat(), (local_today - timedelta(days=7)).isoformat()
    members = db.scalars(select(Membership).where(Membership.org_id == org_id, Membership.role == Role.member)).all()
    rows = db.scalars(select(BpPing).where(BpPing.org_id == org_id, BpPing.day >= since).order_by(BpPing.ping_at.desc())).all()
    people = []
    for m in members:
        mine = [p for p in rows if p.user_id == m.user_id and p.day == today]
        people.append({
            "user_id": m.user_id, "name": m.user.name, "planned": len(mine),
            "photos": sum(p.response == "photo" for p in mine), "declined": sum(p.response == "declined" for p in mine),
            "missed": sum(p.response == "missed" for p in mine),
            "open_now": any(p.ping_at <= t < p.closes_at and p.response is None for p in mine),
        })
    names = {m.user_id: m.user.name for m in members}
    recent = [{**_ping_dict(p), "user_id": p.user_id, "name": names.get(p.user_id, "")}
              for p in rows if p.ping_at <= t and p.response in ("photo", "declined", "missed")]
    return {"day": today, "settings": settings_dict(s), "members": sorted(people, key=lambda p: p["name"].lower()),
            "recent": recent}
