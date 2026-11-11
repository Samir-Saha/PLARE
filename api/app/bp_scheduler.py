"""One pass of the BP check-in scheduler. Runs every minute with the other reminders.

1. Plan: for each group with check-ins on, and each pledge who isn't excused today, pick
   today's random check-in times once (engine/bp_checkin.py). Times stay hidden.
2. Open: when a check-in's time comes, notify the pledge. That also pushes it to their phone.
3. Close: when a check-in closes with no answer, record a factual "Missed BP check-in" log
   entry, unless they were excused. If the server was asleep and never sent it, nothing is
   logged, because the pledge was never asked.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import notify
from .db import now
from .engine import bp_checkin as rules
from .excuses import is_excused
from .logbook import add_entry
from .models import BpDayPlan, BpPing, BpRandomSettings, Membership, Role
from .routers.bp_random import block_rules, weekdays_of

_rng = random.SystemRandom()


def _clock(at: datetime, tz: str) -> str:
    t = at.astimezone(ZoneInfo(tz))
    return f"{t.hour % 12 or 12}:{t:%M} {'AM' if t.hour < 12 else 'PM'}"


def plan_today(db: Session, s: BpRandomSettings, at: datetime, rng: random.Random) -> int:
    day = at.astimezone(ZoneInfo(s.timezone)).date()
    if day.weekday() not in weekdays_of(s):
        return 0
    key = day.isoformat()
    planned_for = set(db.scalars(select(BpDayPlan.user_id).where(BpDayPlan.org_id == s.org_id, BpDayPlan.day == key)))
    members = db.scalars(select(Membership).where(Membership.org_id == s.org_id, Membership.role == Role.member)).all()
    created = 0
    for m in members:
        if m.user_id in planned_for:
            continue
        times = [] if is_excused(db, s.org_id, m.user_id, "bp", day) else rules.plan(
            day, s.timezone, s.window_start_minute, s.window_end_minute, block_rules(db, m.user_id),
            s.class_blocks, s.checks_per_day, timedelta(minutes=s.response_minutes), rng, at)
        try:
            with db.begin_nested():
                db.add(BpDayPlan(org_id=s.org_id, user_id=m.user_id, day=key, planned=len(times)))
                for t in times:
                    db.add(BpPing(org_id=s.org_id, user_id=m.user_id, day=key, ping_at=t,
                                  closes_at=t + timedelta(minutes=s.response_minutes)))
                db.flush()
            created += len(times)
        except IntegrityError:
            pass  # another runner planned this pledge first
    return created


def open_due(db: Session, at: datetime) -> int:
    opened = 0
    for p in db.scalars(select(BpPing).where(BpPing.notified.is_(False), BpPing.ping_at <= at)).all():
        p.notified = True
        if p.response is not None:
            continue
        if p.closes_at <= at:
            p.response = "not_sent"  # the server was asleep the whole time it was open
            continue
        minutes = round((p.closes_at - p.ping_at).total_seconds() / 60)
        notify(db, p.user_id, p.org_id, "bp", "BP check-in: take your photo now",
               f"Open PLARE and take a photo in business professional in the next {minutes} minutes. "
               "If you can't right now, say why in the app.", link="/app/bp")
        opened += 1
    return opened


def close_missed(db: Session, at: datetime) -> int:
    missed = 0
    rows = db.scalars(select(BpPing).where(BpPing.notified.is_(True), BpPing.response.is_(None),
                                           BpPing.missed_logged.is_(False), BpPing.closes_at <= at)).all()
    tz_of = {s.org_id: s.timezone for s in db.scalars(select(BpRandomSettings))}
    for p in rows:
        p.missed_logged = True
        p.response = "missed"
        if is_excused(db, p.org_id, p.user_id, "bp", p.day):
            continue
        tz = tz_of.get(p.org_id, "America/New_York")
        add_entry(db, p.org_id, p.user_id, "missed_bp_checkin",
                  f"No photo for the BP check-in from {_clock(p.ping_at, tz)} to {_clock(p.closes_at, tz)}.",
                  source_key=f"bp_ping:{p.id}")
        missed += 1
    return missed


def run(db: Session, at: datetime | None = None, rng: random.Random | None = None) -> dict:
    at, rng = at or now(), rng or _rng
    planned = sum(plan_today(db, s, at, rng) for s in db.scalars(select(BpRandomSettings).where(BpRandomSettings.enabled.is_(True))).all())
    result = {"planned": planned, "opened": open_due(db, at), "missed": close_missed(db, at)}
    db.commit()
    return result
