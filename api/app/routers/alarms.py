"""Opt-in deadline alarm routes. The answer is checked on the server; alarms are always dismissible."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import alarms as svc
from ..auth import current_user, membership
from ..db import get_db
from ..models import Assignment, DeadlineAlarm, TaskStatus, User

router = APIRouter()


class AnswerIn(BaseModel):
    answer: int


def _load(db: Session, user: User, assignment_id: str) -> Assignment:
    a = db.get(Assignment, assignment_id)
    if a is None:
        raise HTTPException(404, "Task not found")
    membership(db, user, a.org_id)
    if a.user_id != user.id:
        raise HTTPException(404, "Task not found")
    return a


@router.post("/assignments/{assignment_id}/alarm", status_code=201)
def opt_in(assignment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = _load(db, user, assignment_id)
    if a.task.due_at is None:
        raise HTTPException(422, "This task has no deadline to alarm.")
    if a.status in (TaskStatus.submitted, TaskStatus.approved):
        raise HTTPException(409, "This task is already submitted.")
    alarm = svc.arm(db, a)
    db.commit()
    db.refresh(alarm)
    return svc.public(alarm)


@router.get("/alarms/mine")
def mine(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(DeadlineAlarm).where(
        DeadlineAlarm.user_id == user.id, DeadlineAlarm.status.in_(("armed", "ringing")),
    ).order_by(DeadlineAlarm.created_at.desc())).all()
    return [svc.public(a) for a in rows]


@router.post("/alarms/{alarm_id}/solve")
def solve(alarm_id: str, body: AnswerIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    alarm = db.get(DeadlineAlarm, alarm_id)
    if alarm is None or alarm.user_id != user.id:
        raise HTTPException(404, "Alarm not found")
    if not svc.solve(alarm, body.answer):
        raise HTTPException(422, "That's not the right answer. Try again, or dismiss the alarm.")
    db.commit()
    return svc.public(alarm)


@router.post("/alarms/{alarm_id}/dismiss")
def dismiss(alarm_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    alarm = db.get(DeadlineAlarm, alarm_id)
    if alarm is None or alarm.user_id != user.id:
        raise HTTPException(404, "Alarm not found")
    svc.dismiss(alarm)
    db.commit()
    return svc.public(alarm)
