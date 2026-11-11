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

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth import LEADS, audit, current_user, membership
from ..db import get_db, now
from ..engine import bp_checkin as rules
from ..models import BpBlock, BpDayPlan, BpPing, BpSettings, BusyBlock, Membership, Role, User

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


class BlocksIn(BaseModel):
    blocks: list[BlockIn] = Field(min_length=1, max_length=MAX_BLOCKS)


def get_settings_row(db: Session, org_id: str) -> BpSettings:
    """The group's settings, or unsaved defaults (check-ins off)."""
    return db.get(BpSettings, org_id) or BpSettings(
        org_id=org_id, enabled=False, weekdays="0,1,2,3,4", window_start_minute=9 * 60, window_end_minute=17 * 60,
        checks_per_day=1, response_minutes=15, class_blocks=True, timezone="America/New_York",
    )


def weekdays_of(s: BpSettings) -> list[int]:
    return [int(d) for d in s.weekdays.split(",") if d != ""]


def settings_dict(s: BpSettings) -> dict:
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
    q = select(BpSettings)
    if org_id:
        q = q.where(BpSettings.org_id == org_id)
    for s in db.scalars(q):
        today = datetime.now(ZoneInfo(s.timezone)).date().isoformat()
        pings = delete(BpPing).where(BpPing.org_id == s.org_id, BpPing.day == today, BpPing.notified.is_(False))
        plans = delete(BpDayPlan).where(BpDayPlan.org_id == s.org_id, BpDayPlan.day == today)
        if user_id:
            pings, plans = pings.where(BpPing.user_id == user_id), plans.where(BpDayPlan.user_id == user_id)
        db.execute(pings)
        db.execute(plans)


# --- Brothers: settings ----------------------------------------------------------------------

@router.get("/orgs/{org_id}/bp/settings")
def read_settings(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    return settings_dict(get_settings_row(db, org_id))


@router.put("/orgs/{org_id}/bp/settings")
def write_settings(org_id: str, body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    if body.timezone not in available_timezones():
        raise HTTPException(422, "Pick a timezone from the list.")
    if body.window_end_minute - body.window_start_minute < body.response_minutes:
        raise HTTPException(422, "The window has to be longer than the time each check-in stays open.")
    days = sorted(set(body.weekdays))
    if any(d < 0 or d > 6 for d in days):
        raise HTTPException(422, "Pick days from Monday to Sunday.")
    s = db.get(BpSettings, org_id)
    if s is None:
        s = BpSettings(org_id=org_id)
        db.add(s)
    s.enabled, s.weekdays = body.enabled, ",".join(map(str, days))
    s.window_start_minute, s.window_end_minute = body.window_start_minute, body.window_end_minute
    s.checks_per_day, s.response_minutes, s.class_blocks = body.checks_per_day, body.response_minutes, body.class_blocks
    s.timezone, s.updated_by = body.timezone, user.id
    db.flush()
    replan_today(db, org_id=org_id)
    audit(db, org_id, user, "bp.settings", "on" if body.enabled else "off")
    db.commit()
    return settings_dict(s)


# --- Pledges: blocked times ------------------------------------------------------------------

@router.get("/me/bp/blocks")
def my_blocks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(BpBlock).where(BpBlock.user_id == user.id)
                      .order_by(BpBlock.day.is_not(None), BpBlock.weekday, BpBlock.day, BpBlock.start_minute)).all()
    return [block_dict(b, private=True) for b in rows]


@router.post("/me/bp/blocks", status_code=201)
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


@router.get("/orgs/{org_id}/bp/blocks")
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
