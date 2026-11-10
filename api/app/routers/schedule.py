"""Availability, Google Calendar free/busy import, best meeting times, meetings."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import LEADS, current_user, membership, notify
from ..db import get_db, now
from ..engine.availability import Interval, UTC, merge, rank_group_slots, subtract
from ..models import AvailabilityRule, BusyBlock, Meeting, MeetingResponse, Membership, Role, User

router = APIRouter()
FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"


class RuleIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_minute: int = Field(ge=0, le=1440)
    end_minute: int = Field(ge=0, le=1440)


class AvailabilityIn(BaseModel):
    rules: list[RuleIn] = Field(max_length=200)


class CalendarSyncIn(BaseModel):
    provider_token: str = Field(min_length=10)
    days: int = Field(14, ge=1, le=60)


class MeetingIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    location: str = Field("", max_length=255)
    start_at: datetime
    end_at: datetime


class RsvpIn(BaseModel):
    response: str = Field(pattern="^(yes|no|maybe)$")


# ---------- helpers shared with the study router ----------

def expand_rules(rules: list[AvailabilityRule], tz: str, start: datetime, end: datetime) -> list[Interval]:
    """Turn weekly local-time rules into concrete UTC intervals inside [start, end)."""
    zone = ZoneInfo(tz)
    out: list[Interval] = []
    day = start.astimezone(zone).date() - timedelta(days=1)
    last = end.astimezone(zone).date()
    while day <= last:
        midnight = datetime(day.year, day.month, day.day, tzinfo=zone)
        for r in rules:
            if r.weekday == day.weekday():
                lo = (midnight + timedelta(minutes=r.start_minute)).astimezone(UTC)
                hi = (midnight + timedelta(minutes=r.end_minute)).astimezone(UTC)
                if hi > start and lo < end:
                    out.append((max(lo, start), min(hi, end)))
        day += timedelta(days=1)
    return merge(out)


def free_time(db: Session, user: User, start: datetime, end: datetime) -> list[Interval] | None:
    """A person's free intervals, or None if they've given no availability at all.

    Typed weekly availability is the base when present. With only a synced
    calendar, the whole window is the base. Calendar busy time is always removed.
    """
    rules = db.scalars(select(AvailabilityRule).where(AvailabilityRule.user_id == user.id)).all()
    if rules:
        base = expand_rules(rules, user.timezone, start, end)
    elif user.calendar_synced_at:
        base = [(start, end)]
    else:
        return None
    busy = db.scalars(
        select(BusyBlock).where(BusyBlock.user_id == user.id, BusyBlock.end_at > start, BusyBlock.start_at < end)
    ).all()
    return subtract(base, [(b.start_at, b.end_at) for b in busy])


def fetch_busy(provider_token: str, start: datetime, end: datetime) -> list[Interval]:
    """Ask Google for busy ranges only (free/busy scope). Event titles and details are never requested."""
    try:
        resp = httpx.post(
            FREEBUSY_URL,
            headers={"Authorization": f"Bearer {provider_token}"},
            json={"timeMin": start.isoformat(), "timeMax": end.isoformat(), "items": [{"id": "primary"}]},
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Couldn't reach Google Calendar. Try again.") from exc
    if resp.status_code in (401, 403):
        raise HTTPException(401, "Google Calendar access expired or wasn't granted. Reconnect your calendar.")
    if resp.status_code != 200:
        raise HTTPException(502, "Google Calendar returned an error. Try again.")
    primary = resp.json().get("calendars", {}).get("primary", {})
    if primary.get("errors"):
        raise HTTPException(502, "Google Calendar couldn't read your primary calendar.")
    return merge([
        (datetime.fromisoformat(b["start"].replace("Z", "+00:00")), datetime.fromisoformat(b["end"].replace("Z", "+00:00")))
        for b in primary.get("busy", [])
    ])


# ---------- routes ----------

@router.get("/availability/me")
def get_availability(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rules = db.scalars(select(AvailabilityRule).where(AvailabilityRule.user_id == user.id)).all()
    return {
        "timezone": user.timezone,
        "calendar_synced_at": user.calendar_synced_at,
        "rules": [{"weekday": r.weekday, "start_minute": r.start_minute, "end_minute": r.end_minute} for r in rules],
    }


@router.put("/availability/me")
def set_availability(body: AvailabilityIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    for r in body.rules:
        if r.end_minute <= r.start_minute:
            raise HTTPException(422, "Each block must end after it starts")
    db.execute(delete(AvailabilityRule).where(AvailabilityRule.user_id == user.id))
    db.add_all(AvailabilityRule(user_id=user.id, **r.model_dump()) for r in body.rules)
    db.commit()
    return {"saved": len(body.rules)}


@router.post("/calendar/sync")
def calendar_sync(body: CalendarSyncIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Import busy times for the next N days. The Google token is used once and never stored."""
    start = now()
    end = start + timedelta(days=body.days)
    busy = fetch_busy(body.provider_token, start, end)
    user = db.merge(user)
    db.execute(delete(BusyBlock).where(BusyBlock.user_id == user.id))
    db.add_all(BusyBlock(user_id=user.id, start_at=s, end_at=e) for s, e in busy)
    user.calendar_synced_at = now()
    db.commit()
    return {"busy_blocks": len(busy), "synced_at": user.calendar_synced_at, "through": end}


@router.delete("/calendar", status_code=204)
def calendar_disconnect(user: User = Depends(current_user), db: Session = Depends(get_db)):
    user = db.merge(user)
    db.execute(delete(BusyBlock).where(BusyBlock.user_id == user.id))
    user.calendar_synced_at = None
    db.commit()


@router.get("/orgs/{org_id}/best-times")
def best_times(
    org_id: str,
    duration: int = 60,
    days: int = 7,
    day_start: int = 8,
    day_end: int = 23,
    who: str = "everyone",  # everyone | members
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    membership(db, user, org_id)
    if duration < 15 or duration > 480 or duration % 15:
        raise HTTPException(422, "Duration must be 15 to 480 minutes, in 15-minute steps")
    if not 1 <= days <= 30 or not 0 <= day_start < day_end <= 24:
        raise HTTPException(422, "Invalid search window")
    start = now()
    end = start + timedelta(days=days)
    rows = db.scalars(select(Membership).where(Membership.org_id == org_id)).all()
    if who == "members":
        rows = [m for m in rows if Role(m.role) == Role.member]
    names = {m.user_id: m.user.name for m in rows}
    result = rank_group_slots(
        {m.user_id: free_time(db, m.user, start, end) for m in rows},
        start, end, duration, tz=user.timezone, day_start_hour=day_start, day_end_hour=day_end,
        min_attendance=max(1, len(rows) // 2), limit=8,
    )
    return {
        "total": result.total,
        "timezone": user.timezone,
        "no_data": [names[u] for u in result.no_data],
        "options": [
            {"start": o.start, "end": o.end, "count": o.count, "total": o.total,
             "flexibility_minutes": o.flexibility_minutes,
             "unavailable": [names[u] for u in o.unavailable]}
            for o in result.options
        ],
    }


def _meeting(db: Session, m: Meeting, user: User) -> dict:
    responses = db.scalars(select(MeetingResponse).where(MeetingResponse.meeting_id == m.id)).all()
    return {
        "id": m.id, "title": m.title, "description": m.description, "location": m.location,
        "start_at": m.start_at, "end_at": m.end_at, "status": m.status,
        "yes": sum(r.response == "yes" for r in responses), "no": sum(r.response == "no" for r in responses),
        "maybe": sum(r.response == "maybe" for r in responses),
        "my_response": next((r.response for r in responses if r.user_id == user.id), None),
    }


@router.post("/orgs/{org_id}/meetings", status_code=201)
def propose_meeting(org_id: str, body: MeetingIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    if body.start_at.tzinfo is None or body.end_at.tzinfo is None or body.end_at <= body.start_at:
        raise HTTPException(422, "Meeting needs timezone-aware times and must end after it starts")
    meeting = Meeting(org_id=org_id, created_by=user.id, **body.model_dump())
    db.add(meeting)
    for m in db.scalars(select(Membership).where(Membership.org_id == org_id, Membership.user_id != user.id)):
        notify(db, m.user_id, org_id, "meeting", f"Meeting proposed: {body.title}", link="/app/schedule")
    db.commit()
    return _meeting(db, meeting, user)


@router.get("/orgs/{org_id}/meetings")
def meetings(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    rows = db.scalars(select(Meeting).where(Meeting.org_id == org_id).order_by(Meeting.start_at)).all()
    return [_meeting(db, m, user) for m in rows]


@router.post("/meetings/{meeting_id}/rsvp")
def rsvp(meeting_id: str, body: RsvpIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(404, "Meeting not found")
    membership(db, user, meeting.org_id)
    if meeting.status in ("cancelled", "completed"):
        raise HTTPException(409, f"This meeting is {meeting.status}")
    row = db.scalar(select(MeetingResponse).where(MeetingResponse.meeting_id == meeting_id, MeetingResponse.user_id == user.id))
    if row:
        row.response = body.response
    else:
        db.add(MeetingResponse(meeting_id=meeting_id, user_id=user.id, response=body.response))
    db.commit()
    return _meeting(db, meeting, user)


@router.post("/meetings/{meeting_id}/status")
def meeting_status(meeting_id: str, status: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    meeting = db.get(Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(404, "Meeting not found")
    membership(db, user, meeting.org_id, *LEADS)
    if status not in ("confirmed", "cancelled", "completed"):
        raise HTTPException(422, "Unknown status")
    meeting.status = status
    db.commit()
    return _meeting(db, meeting, user)
