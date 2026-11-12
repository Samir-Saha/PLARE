"""Lead-managed recurring task templates; each occurrence uses the normal task pipeline."""
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import LEADS, audit, current_user, membership
from ..db import get_db, now
from ..models import Membership, TaskTemplate, TaskTemplateAssignee, User
from ..task_automation import TASK_FIELDS, create_occurrence
from .tasks import TaskIn

router = APIRouter()


class TemplateIn(TaskIn):
    due_at: datetime
    frequency: str = Field(pattern="^(daily|weekly)$")
    timezone: str = Field(min_length=1, max_length=64)
    ends_at: datetime | None = None


class StatusIn(BaseModel):
    status: str = Field(pattern="^(active|paused|ended)$")


def _template(t: TaskTemplate) -> dict:
    return {"id": t.id, **{field: getattr(t, field) for field in TASK_FIELDS},
            "assign": t.assign, "frequency": t.frequency, "timezone": t.timezone,
            "first_due_at": t.first_due_at, "next_run_at": t.next_run_at,
            "ends_at": t.ends_at, "status": t.status}


@router.post("/orgs/{org_id}/task-templates", status_code=201)
def create_template(org_id: str, body: TemplateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    if not body.title.strip():
        raise HTTPException(422, "Give the template a title")
    if body.due_at.tzinfo is None or (body.ends_at and body.ends_at.tzinfo is None):
        raise HTTPException(422, "Deadlines must include a timezone offset")
    if body.due_at <= now():
        raise HTTPException(422, "Choose a future first deadline")
    if body.ends_at and body.ends_at < body.due_at:
        raise HTTPException(422, "The final deadline must be on or after the first deadline")
    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Choose a valid timezone, such as America/New_York")
    targets = list(dict.fromkeys(body.user_ids)) if body.assign == "users" else []
    if body.assign == "users":
        valid = set(db.scalars(select(Membership.user_id).where(Membership.org_id == org_id)))
        if not targets or not set(targets) <= valid:
            raise HTTPException(422, "Assignees must be members of this group")
    template = TaskTemplate(**{field: getattr(body, field) for field in TASK_FIELDS},
                            org_id=org_id, assign=body.assign, frequency=body.frequency, timezone=body.timezone,
                            first_due_at=body.due_at, next_run_at=body.due_at, ends_at=body.ends_at, created_by=user.id)
    template.title = template.title.strip()
    db.add(template)
    db.flush()
    db.add_all(TaskTemplateAssignee(template_id=template.id, user_id=target) for target in targets)
    db.flush()
    task, assigned = create_occurrence(db, template, body.due_at)
    audit(db, org_id, user, "task_template.create", template.title)
    db.commit()
    return {**_template(template), "task_id": task.id, "assigned": assigned}


@router.get("/orgs/{org_id}/task-templates")
def list_templates(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    return [_template(t) for t in db.scalars(select(TaskTemplate).where(
        TaskTemplate.org_id == org_id,
    ).order_by(TaskTemplate.created_at.desc(), TaskTemplate.id))]


@router.patch("/orgs/{org_id}/task-templates/{template_id}")
def set_status(org_id: str, template_id: str, body: StatusIn,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    template = db.scalar(select(TaskTemplate).where(
        TaskTemplate.id == template_id, TaskTemplate.org_id == org_id,
    ).with_for_update())
    if template is None:
        raise HTTPException(404, "Template not found")
    if template.status == "ended" and body.status != "ended":
        raise HTTPException(409, "This template has ended. Create a new template to repeat it again.")
    template.status = body.status
    audit(db, org_id, user, f"task_template.{body.status}", template.id)
    db.commit()
    return _template(template)
