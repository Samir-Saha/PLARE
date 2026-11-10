"""Study hours: a timestamp-based timer, a personal study planner, and group study times."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user, membership
from ..db import get_db, now
from ..engine.availability import rank_group_slots
from ..engine.study import plan_study_blocks
from ..models import Membership, Role, StudySession, User
from .schedule import free_time

router = APIRouter()


def _session(s: StudySession) -> dict:
    return {
        "id": s.id, "started_at": s.started_at, "ended_at": s.ended_at, "paused_at": s.paused_at,
        "paused_seconds": s.paused_seconds, "elapsed_seconds": s.elapsed_seconds(),
        "state": "ended" if s.ended_at else "paused" if s.paused_at else "running",
    }


def _active(db: Session, org_id: str, user: User) -> StudySession | None:
    return db.scalar(
        select(StudySession).where(
            StudySession.org_id == org_id, StudySession.user_id == user.id, StudySession.ended_at.is_(None)
        )
    )


@router.get("/orgs/{org_id}/study")
def study_overview(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    rows = db.scalars(
        select(StudySession)
        .where(StudySession.org_id == org_id, StudySession.user_id == user.id)
        .order_by(StudySession.started_at.desc())
        .limit(50)
    ).all()
    week_ago = now() - timedelta(days=7)
    return {
        "active": next((_session(s) for s in rows if s.ended_at is None), None),
        "week_seconds": sum(s.elapsed_seconds() for s in rows if s.started_at >= week_ago),
        "total_seconds": sum(s.elapsed_seconds() for s in rows),
        "history": [_session(s) for s in rows if s.ended_at][:20],
    }


@router.post("/orgs/{org_id}/study/{action}")
def study_action(org_id: str, action: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    active = _active(db, org_id, user)
    if action == "start":
        if active:
            raise HTTPException(409, "You already have a study session running")
        active = StudySession(org_id=org_id, user_id=user.id)
        db.add(active)
    elif active is None:
        raise HTTPException(409, "No study session is running")
    elif action == "pause":
        if active.paused_at is None:
            active.paused_at = now()
    elif action == "resume":
        if active.paused_at is not None:
            active.paused_seconds += int((now() - active.paused_at).total_seconds())
            active.paused_at = None
    elif action == "end":
        end = now()
        if active.paused_at is not None:
            active.paused_seconds += int((end - active.paused_at).total_seconds())
            active.paused_at = None
        active.ended_at = end
    else:
        raise HTTPException(404, "Unknown action")
    db.commit()
    return _session(active)


@router.get("/orgs/{org_id}/study/plan")
def study_plan(
    org_id: str,
    target_hours: float = 10,
    days: int = 7,
    day_start: int = 8,
    day_end: int = 23,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Best study blocks for the caller this week, from their calendar and typed availability."""
    membership(db, user, org_id)
    if not 0 < target_hours <= 60 or not 1 <= days <= 14 or not 0 <= day_start < day_end <= 24:
        raise HTTPException(422, "Invalid plan settings")
    start = now()
    end = start + timedelta(days=days)
    free = free_time(db, user, start, end)
    if free is None:
        return {"has_availability": False, "blocks": [], "planned_minutes": 0,
                "target_minutes": int(target_hours * 60), "shortfall_minutes": int(target_hours * 60),
                "timezone": user.timezone}
    plan = plan_study_blocks(free, start, end, int(target_hours * 60), tz=user.timezone,
                             day_start_hour=day_start, day_end_hour=day_end)
    return {
        "has_availability": True,
        "timezone": user.timezone,
        "blocks": [{"start": s, "end": e, "minutes": int((e - s).total_seconds() // 60)} for s, e in plan.blocks],
        "planned_minutes": plan.planned_minutes,
        "target_minutes": plan.target_minutes,
        "shortfall_minutes": plan.shortfall_minutes,
    }


@router.get("/orgs/{org_id}/study/group-times")
def group_study_times(
    org_id: str,
    duration: int = 120,
    days: int = 7,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """When the most members (pledges) can study together."""
    membership(db, user, org_id)
    if duration < 30 or duration > 480 or duration % 15 or not 1 <= days <= 14:
        raise HTTPException(422, "Invalid search settings")
    start = now()
    end = start + timedelta(days=days)
    rows = [
        m for m in db.scalars(select(Membership).where(Membership.org_id == org_id)).all()
        if Role(m.role) == Role.member
    ]
    names = {m.user_id: m.user.name for m in rows}
    result = rank_group_slots(
        {m.user_id: free_time(db, m.user, start, end) for m in rows},
        start, end, duration, tz=user.timezone, min_attendance=2, limit=6,
    )
    return {
        "total": result.total,
        "timezone": user.timezone,
        "no_data": [names[u] for u in result.no_data],
        "options": [
            {"start": o.start, "end": o.end, "count": o.count, "total": o.total,
             "unavailable": [names[u] for u in o.unavailable]}
            for o in result.options
        ],
    }
