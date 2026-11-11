"""Shared calendar: events with invited members, RSVPs, and a confirmed state."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import LEADS, current_user, membership, notify
from ..db import get_db
from ..engine.rsvp import going_count, is_confirmed
from ..models import CalendarEvent, CalendarEventGuest, Membership, Role, User

router = APIRouter()


def _aware(v: datetime | None) -> datetime | None:
    # The UTCDateTime column rejects naive datetimes, so reject them here with a clear 422.
    if v is not None and v.tzinfo is None:
        raise ValueError("include a timezone, e.g. 2026-11-12T18:00:00Z")
    return v


class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field("", max_length=2000)
    location: str = Field("", max_length=255)
    start_at: datetime
    end_at: datetime
    required_rsvps: int = Field(1, ge=1, le=500)
    guest_ids: list[str] = Field(default_factory=list, max_length=500)

    _tz = field_validator("start_at", "end_at")(_aware)

    @model_validator(mode="after")
    def _order(self):
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class EventPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    location: str | None = Field(None, max_length=255)
    start_at: datetime | None = None
    end_at: datetime | None = None
    required_rsvps: int | None = Field(None, ge=1, le=500)
    guest_ids: list[str] | None = Field(None, max_length=500)

    _tz = field_validator("start_at", "end_at")(_aware)


class RsvpIn(BaseModel):
    response: Literal["yes", "no", "maybe"]


def _names(db: Session, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(ids))).all())


def _out(ev: CalendarEvent, names: dict[str, str], me: str) -> dict:
    responses = [g.response for g in ev.guests]
    going = going_count(responses)
    return {
        "id": ev.id, "title": ev.title, "description": ev.description, "location": ev.location,
        "start_at": ev.start_at, "end_at": ev.end_at, "required_rsvps": ev.required_rsvps,
        "going": going, "needed": max(0, ev.required_rsvps - going),
        "confirmed": is_confirmed(ev.required_rsvps, responses),
        "my_response": next((g.response for g in ev.guests if g.user_id == me), None),
        "created_by": ev.created_by, "created_by_name": names.get(ev.created_by, ""),
        "guests": [{"user_id": g.user_id, "name": names.get(g.user_id, ""), "response": g.response}
                   for g in sorted(ev.guests, key=lambda g: names.get(g.user_id, "").lower())],
    }


def _list(db: Session, rows: list[CalendarEvent], me: str) -> list[dict]:
    ids = {ev.created_by for ev in rows} | {g.user_id for ev in rows for g in ev.guests}
    names = _names(db, ids)
    return [_out(ev, names, me) for ev in rows]


def _load(db: Session, event_id: str) -> CalendarEvent:
    ev = db.get(CalendarEvent, event_id)
    if ev is None:
        raise HTTPException(404, "Event not found")
    return ev


def _check_guests(db: Session, org_id: str, ids: set[str]) -> None:
    in_org = set(db.scalars(select(Membership.user_id).where(Membership.org_id == org_id)))
    if not ids <= in_org:
        raise HTTPException(422, "Everyone invited has to be in this group")


def _check_required(required: int, guests: int) -> None:
    if required > guests:
        raise HTTPException(422, f"You need {required} RSVPs but only {guests} {'person is' if guests == 1 else 'people are'} invited")


@router.get("/orgs/{org_id}/events")
def list_events(org_id: str, start: datetime | None = None, end: datetime | None = None,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    q = select(CalendarEvent).where(CalendarEvent.org_id == org_id).order_by(CalendarEvent.start_at)
    if start:
        q = q.where(CalendarEvent.end_at >= _aware(start))
    if end:
        q = q.where(CalendarEvent.start_at <= _aware(end))
    return _list(db, list(db.scalars(q)), user.id)


@router.post("/orgs/{org_id}/events", status_code=201)
def create_event(org_id: str, body: EventIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    guests = set(body.guest_ids) | {user.id}
    _check_guests(db, org_id, guests)
    _check_required(body.required_rsvps, len(guests))
    ev = CalendarEvent(org_id=org_id, title=body.title.strip(), description=body.description, location=body.location,
                       start_at=body.start_at, end_at=body.end_at, required_rsvps=body.required_rsvps, created_by=user.id)
    # The creator is going by default; everyone else starts as "invited" (no answer yet).
    ev.guests = [CalendarEventGuest(user_id=u, response="yes" if u == user.id else "invited") for u in guests]
    db.add(ev)
    for u in guests - {user.id}:
        notify(db, u, org_id, "event", f"{user.name} invited you: {ev.title}", "RSVP on the calendar.", "/app/events")
    db.commit()
    return _list(db, [ev], user.id)[0]


@router.patch("/events/{event_id}")
def update_event(event_id: str, body: EventPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ev = _load(db, event_id)
    m = membership(db, user, ev.org_id)
    if ev.created_by != user.id and Role(m.role) not in LEADS:
        raise HTTPException(403, "Only the person who made this event or a brother can change it")
    data = body.model_dump(exclude_unset=True)
    guest_ids = data.pop("guest_ids", None)
    for key, value in data.items():
        if value is None:
            raise HTTPException(422, f"{key} can't be empty")
        setattr(ev, key, value)
    if ev.end_at <= ev.start_at:
        raise HTTPException(422, "end_at must be after start_at")
    if guest_ids is not None:
        wanted = set(guest_ids) | {ev.created_by}
        _check_guests(db, ev.org_id, wanted)
        have = {g.user_id for g in ev.guests}
        ev.guests = [g for g in ev.guests if g.user_id in wanted]  # keeps everyone's existing RSVP
        for u in wanted - have:
            ev.guests.append(CalendarEventGuest(user_id=u, response="invited"))
            notify(db, u, ev.org_id, "event", f"{user.name} invited you: {ev.title}", "RSVP on the calendar.", "/app/events")
    _check_required(ev.required_rsvps, len(ev.guests))
    db.commit()
    return _list(db, [ev], user.id)[0]


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ev = _load(db, event_id)
    m = membership(db, user, ev.org_id)
    if ev.created_by != user.id and Role(m.role) not in LEADS:
        raise HTTPException(403, "Only the person who made this event or a brother can delete it")
    db.delete(ev)
    db.commit()
    return Response(status_code=204)


@router.put("/events/{event_id}/rsvp")
def rsvp(event_id: str, body: RsvpIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ev = _load(db, event_id)
    membership(db, user, ev.org_id)
    mine = next((g for g in ev.guests if g.user_id == user.id), None)
    if mine is None:
        raise HTTPException(403, "You weren't invited to this event")
    was = is_confirmed(ev.required_rsvps, [g.response for g in ev.guests])
    mine.response = body.response
    now_confirmed = is_confirmed(ev.required_rsvps, [g.response for g in ev.guests])
    if now_confirmed and not was:
        for g in ev.guests:
            if g.user_id != user.id:
                notify(db, g.user_id, ev.org_id, "event", f"Confirmed: {ev.title}", f"{ev.required_rsvps} people are going.", "/app/events")
    db.commit()
    return _list(db, [ev], user.id)[0]
