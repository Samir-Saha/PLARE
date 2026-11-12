"""Opt-in deadline alarms: repeating push until a server-checked sum is solved, or dismissed."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import notify
from .db import now
from .models import Assignment, DeadlineAlarm, Task, TaskStatus


REPEAT_EVERY = timedelta(minutes=15)


def _question(alarm: DeadlineAlarm) -> None:
    alarm.operand_a = secrets.randbelow(12) + 2  # 2..13
    alarm.operand_b = secrets.randbelow(12) + 2


def arm(db: Session, assignment: Assignment) -> DeadlineAlarm:
    existing = db.scalar(select(DeadlineAlarm).where(
        DeadlineAlarm.assignment_id == assignment.id, DeadlineAlarm.user_id == assignment.user_id,
    ))
    if existing:
        if existing.status in ("stopped", "dismissed"):
            existing.status = "armed"
            existing.stopped_at = None
            existing.last_pushed_at = None
            _question(existing)
        return existing
    alarm = DeadlineAlarm(
        assignment_id=assignment.id, user_id=assignment.user_id, org_id=assignment.org_id, status="armed",
    )
    _question(alarm)
    db.add(alarm)
    return alarm


def public(alarm: DeadlineAlarm) -> dict:
    task = alarm.assignment.task if alarm.assignment else None
    ringing = alarm.status == "ringing"
    return {
        "id": alarm.id,
        "assignment_id": alarm.assignment_id,
        "status": alarm.status,
        "prompt": f"What is {alarm.operand_a} + {alarm.operand_b}?" if ringing else "",
        "operand_a": alarm.operand_a if ringing else None,
        "operand_b": alarm.operand_b if ringing else None,
        "task_title": task.title if task else "",
        "due_at": task.due_at if task else None,
        "link": "/app/tasks",
    }


def solve(alarm: DeadlineAlarm, answer: int) -> bool:
    if alarm.status != "ringing":
        return alarm.status == "stopped"
    if answer != alarm.operand_a + alarm.operand_b:
        return False
    alarm.status = "stopped"
    alarm.stopped_at = now()
    return True


def dismiss(alarm: DeadlineAlarm) -> None:
    alarm.status = "dismissed"
    alarm.stopped_at = now()


def tick(db: Session, at: datetime | None = None) -> int:
    """Start or repeat ringing alarms whose deadlines have arrived. Called by the minute scheduler."""
    at = at or now()
    rows = db.scalars(select(DeadlineAlarm).join(Assignment).join(Task).where(
        DeadlineAlarm.status.in_(("armed", "ringing")),
        Task.due_at.is_not(None), Task.due_at <= at,
        Assignment.status.not_in((TaskStatus.submitted, TaskStatus.approved)),
    )).all()
    sent = 0
    for alarm in rows:
        if alarm.status == "armed":
            alarm.status = "ringing"
            _question(alarm)
        if alarm.last_pushed_at and at - alarm.last_pushed_at < REPEAT_EVERY:
            continue
        task = alarm.assignment.task
        notify(
            db, alarm.user_id, alarm.org_id, "alarm",
            f"Alarm: {task.title}",
            f"Solve {alarm.operand_a} + {alarm.operand_b} in PLARE to turn this off, or dismiss it.",
            link="/app/tasks",
        )
        alarm.last_pushed_at = at
        sent += 1
    db.commit()
    return sent
