"""Database work for recurring tasks and reminders; called by the existing scheduler."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import notify
from .db import now
from .engine.task_automation import next_deadline, reminder_stage
from .models import (
    Assignment, Membership, Notification, Role, Task, TaskOccurrence, TaskReminder, TaskStatus,
    TaskTemplate, TaskTemplateAssignee,
)

TASK_FIELDS = ("title", "description", "category", "priority", "estimate_minutes", "evidence")


def create_occurrence(db: Session, template: TaskTemplate, due_at: datetime) -> tuple[Task, int]:
    """Caller owns the transaction, including the unique occurrence claim and notifications."""
    task = Task(**{field: getattr(template, field) for field in TASK_FIELDS},
                org_id=template.org_id, due_at=due_at, claimable=template.assign == "open",
                created_by=template.created_by)
    db.add(task)
    db.flush()
    db.add(TaskOccurrence(template_id=template.id, due_at=due_at, task_id=task.id))
    db.flush()  # Claim before creating assignments or notifications.
    q = select(Membership.user_id).where(Membership.org_id == template.org_id)
    if template.assign == "all_members":
        q = q.where(Membership.role == Role.member)
    elif template.assign == "users":
        picked = select(TaskTemplateAssignee.user_id).where(TaskTemplateAssignee.template_id == template.id)
        q = q.where(Membership.user_id.in_(picked))
    else:
        return task, 0
    targets = db.scalars(q).all()
    for user_id in targets:
        db.add(Assignment(task_id=task.id, org_id=template.org_id, user_id=user_id))
        notify(db, user_id, template.org_id, "task", f"New task: {task.title}"[:200],
               link=f"/app/tasks?org={template.org_id}")
    return task, len(targets)


def generate_recurring_tasks(db: Session, at: datetime | None = None) -> int:
    """Create one upcoming task per due template, skipping missed cycles after downtime.

    Postgres locks serialize status changes and runners. The unique occurrence constraint
    additionally protects SQLite and makes the whole task/assignments/notifications atomic.
    """
    at = at or now()
    templates = db.scalars(select(TaskTemplate).where(
        TaskTemplate.status == "active", TaskTemplate.next_run_at <= at,
    ).order_by(TaskTemplate.id).with_for_update(skip_locked=True)).all()
    created = 0
    for template in templates:
        due = next_deadline(template.first_due_at, at, template.frequency, template.timezone)
        if template.ends_at and due > template.ends_at:
            template.status = "ended"
            continue
        try:
            with db.begin_nested():
                create_occurrence(db, template, due)
                template.next_run_at = due
            created += 1
        except IntegrityError:
            # Another runner already created this occurrence. Never roll back other templates.
            db.refresh(template)
    db.commit()
    return created


def send_task_reminders(db: Session, at: datetime | None = None) -> int:
    """Remind current assignees once per active window. In-review work is already submitted."""
    at = at or now()
    rows = db.scalars(select(Assignment).join(Task).join(Membership, (
        (Membership.org_id == Assignment.org_id) & (Membership.user_id == Assignment.user_id)
    )).where(
        Task.deleted_at.is_(None), Task.due_at.is_not(None), Task.due_at <= at + timedelta(hours=24),
        Assignment.status.not_in((TaskStatus.submitted, TaskStatus.approved)),
    )).all()
    sent = 0
    for assignment in rows:
        task = assignment.task
        stage = reminder_stage(task.due_at, at)
        if db.scalar(select(TaskReminder.id).where(
            TaskReminder.assignment_id == assignment.id, TaskReminder.due_at == task.due_at,
            TaskReminder.stage == stage,
        )):
            continue
        when = task.due_at.astimezone(ZoneInfo(assignment.user.timezone))
        label = {"due_day": "Due within 24 hours", "due_hour": "Due within 1 hour", "overdue": "Task overdue"}[stage]
        try:
            with db.begin_nested():
                claim = TaskReminder(assignment_id=assignment.id, due_at=task.due_at, stage=stage)
                db.add(claim)
                db.flush()
                clear_task_reminders(db, assignment.id)
                notification = notify(db, assignment.user_id, assignment.org_id, "task_reminder", f"{label}: {task.title}"[:200],
                                      body=f"{task.title} is due {when:%b %d at %I:%M %p %Z}. Open Tasks to submit your work.",
                                      link=f"/app/tasks?org={assignment.org_id}")
                db.flush()
                claim.notification_id = notification.id
            sent += 1
        except IntegrityError:
            pass  # Unique (assignment, deadline, stage) claim belongs to another runner.
    db.commit()
    return sent


def clear_task_reminders(db: Session, assignment_id: str) -> None:
    """Clear obsolete reminders in the caller's transaction, retaining the delivery claims."""
    notes = db.scalars(select(Notification).join(TaskReminder, TaskReminder.notification_id == Notification.id).where(
        TaskReminder.assignment_id == assignment_id, Notification.read_at.is_(None),
    ))
    for note in notes:
        note.read_at = now()
