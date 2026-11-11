"""Personal work plan (deadline back-planner) and owner suggestions for open tasks."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import LEADS, audit, current_user, membership, notify
from ..db import get_db, now
from ..engine.availability import Interval, daily_windows, subtract
from ..engine.planner import WorkItem, plan_work, suggest_owners
from ..models import Assignment, Membership, Task, TaskStatus, User
from .schedule import free_time

router = APIRouter()

DEFAULT_ESTIMATE = 30  # minutes, for tasks created without an estimate
OPEN = (TaskStatus.not_started, TaskStatus.in_progress, TaskStatus.needs_revision)
HORIZON_DAYS = 21


class AssignIn(BaseModel):
    user_id: str


def waking_free(db: Session, user: User, start, end) -> list[Interval] | None:
    """Free time limited to 8 AM to 11 PM in the person's own timezone."""
    free = free_time(db, user, start, end)
    if free is None:
        return None
    awake = daily_windows(start, end, user.timezone, 8, 23)
    return subtract(free, subtract([(start, end)], awake))


def _open_assignments(db: Session, org_id: str, user_id: str) -> list[Assignment]:
    return db.scalars(
        select(Assignment).join(Task).where(
            Assignment.org_id == org_id, Assignment.user_id == user_id,
            Assignment.status.in_(OPEN), Task.deleted_at.is_(None),
        )
    ).all()


@router.get("/orgs/{org_id}/plan/mine")
def my_plan(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    start = now()
    open_work = [a for a in _open_assignments(db, org_id, user.id) if a.task.due_at and a.task.evidence != "none"]
    end = max([start + timedelta(days=1)] + [a.task.due_at for a in open_work])
    end = min(end, start + timedelta(days=HORIZON_DAYS))
    free = waking_free(db, user, start, end)
    if free is None:
        return {"has_availability": False, "sessions": [], "at_risk": [], "timezone": user.timezone}
    if not open_work:
        return {"has_availability": True, "sessions": [], "at_risk": [], "timezone": user.timezone}
    by_id = {a.id: a for a in open_work}
    plan = plan_work(
        free,
        [WorkItem(a.id, a.task.due_at, a.task.estimate_minutes or DEFAULT_ESTIMATE) for a in open_work],
        start,
    )
    return {
        "has_availability": True,
        "timezone": user.timezone,
        "sessions": [
            {"assignment_id": s.task_id, "title": by_id[s.task_id].task.title, "start": s.start, "end": s.end,
             "minutes": s.minutes, "due_at": by_id[s.task_id].task.due_at}
            for s in plan.sessions
        ],
        "at_risk": [
            {"assignment_id": a_id, "title": by_id[a_id].task.title, "due_at": by_id[a_id].task.due_at,
             "missing_minutes": missing, "overdue": by_id[a_id].task.due_at <= start}
            for a_id, missing in plan.at_risk.items()
        ],
    }


@router.get("/tasks/{task_id}/suggest-owners")
def owner_suggestions(task_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.deleted_at:
        raise HTTPException(404, "Task not found")
    membership(db, user, task.org_id, *LEADS)
    start = now()
    due = task.due_at if task.due_at and task.due_at > start else start + timedelta(days=7)
    estimate = task.estimate_minutes or DEFAULT_ESTIMATE
    taken = set(db.scalars(select(Assignment.user_id).where(Assignment.task_id == task_id)))
    members = [
        m for m in db.scalars(select(Membership).where(Membership.org_id == task.org_id)).all()
        if m.user_id not in taken
    ]
    candidates = {}
    for m in members:
        committed = sum(
            a.task.estimate_minutes or DEFAULT_ESTIMATE
            for a in _open_assignments(db, task.org_id, m.user_id)
            if a.task.due_at is None or a.task.due_at <= due
        )
        candidates[m.user_id] = (waking_free(db, m.user, start, due), committed)
    names = {m.user_id: m.user.name for m in members}
    ranked = suggest_owners(candidates, start, due, estimate)
    return {
        "task_id": task.id,
        "estimate_minutes": estimate,
        "due_at": due,
        "options": [
            {"user_id": o.user, "name": names[o.user], "free_minutes": o.free_minutes,
             "committed_minutes": o.committed_minutes, "spare_minutes": o.spare_minutes,
             "has_availability": o.has_availability, "fits": fits}
            for o, fits in ranked[:8]
        ],
    }


@router.post("/tasks/{task_id}/assign", status_code=201)
def assign(task_id: str, body: AssignIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.deleted_at:
        raise HTTPException(404, "Task not found")
    membership(db, user, task.org_id, *LEADS)
    target = db.scalar(select(Membership).where(Membership.org_id == task.org_id, Membership.user_id == body.user_id))
    if target is None:
        raise HTTPException(422, "That person isn't in this group")
    if db.scalar(select(Assignment).where(Assignment.task_id == task_id, Assignment.user_id == body.user_id)):
        raise HTTPException(409, "They already have this task")
    a = Assignment(task_id=task_id, org_id=task.org_id, user_id=body.user_id)
    db.add(a)
    task.claimable = False  # an open task stops being claimable once someone owns it
    notify(db, body.user_id, task.org_id, "task", f"You were assigned: {task.title}", link="/app")
    audit(db, task.org_id, user, "task.assign", f"{task.id} -> {body.user_id}")
    db.commit()
    return {"id": a.id}
