"""Lead dashboard overview: upcoming group deadlines, overdue work, group study time, and recent activity.

Everything here is read from existing records. Nothing is estimated or invented.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import LEADS, current_user, membership
from ..db import get_db, now
from ..models import Assignment, Membership, Role, StudySession, Submission, Task, TaskStatus, User

router = APIRouter()

DONE = (TaskStatus.submitted, TaskStatus.approved)


@router.get("/orgs/{org_id}/overview")
def overview(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    t = now()
    week_ago = t - timedelta(days=7)

    tasks = db.scalars(select(Task).where(Task.org_id == org_id, Task.deleted_at.is_(None))).all()
    assignments = db.scalars(select(Assignment).where(Assignment.org_id == org_id)).all()
    by_task: dict[str, list[Assignment]] = {}
    for a in assignments:
        by_task.setdefault(a.task_id, []).append(a)
    live = {task.id for task in tasks}

    deadlines = sorted(
        (
            {"task_id": task.id, "title": task.title, "category": task.category, "due_at": task.due_at,
             "assigned": len(by_task.get(task.id, [])),
             "done": sum(a.status in DONE for a in by_task.get(task.id, []))}
            for task in tasks if task.due_at and t <= task.due_at <= t + timedelta(days=30)
        ),
        key=lambda d: d["due_at"],
    )

    overdue = sorted(
        (
            {"assignment_id": a.id, "title": a.task.title, "user_name": a.user.name, "due_at": a.task.due_at,
             "status": a.status}
            for a in assignments
            if a.task_id in live and a.task.due_at and a.task.due_at < t and a.status not in DONE
        ),
        key=lambda d: d["due_at"],
    )
    revisions = [
        {"assignment_id": a.id, "title": a.task.title, "user_name": a.user.name, "due_at": a.task.due_at}
        for a in assignments if a.task_id in live and a.status == TaskStatus.needs_revision
    ]

    member_ids = {
        m.user_id for m in db.scalars(select(Membership).where(Membership.org_id == org_id)).all()
        if Role(m.role) == Role.member
    }
    sessions = db.scalars(
        select(StudySession).where(StudySession.org_id == org_id, StudySession.started_at >= week_ago)
    ).all()
    member_sessions = [s for s in sessions if s.user_id in member_ids]

    # Recent activity: real events only (submissions, reviews, people joining).
    events = []
    subs = db.scalars(
        select(Submission).where(Submission.org_id == org_id).order_by(Submission.created_at.desc()).limit(10)
    ).all()
    for s in subs:
        a = s.assignment
        events.append({"kind": "submitted", "at": s.created_at, "who": a.user.name, "what": a.task.title})
        if s.reviewed_at and s.status in ("approved", "needs_revision"):
            reviewer = db.get(User, s.reviewer_id) if s.reviewer_id else None
            events.append({"kind": s.status, "at": s.reviewed_at, "who": reviewer.name if reviewer else "A reviewer",
                           "what": f"{a.task.title} from {a.user.name}"})
    for m in db.scalars(
        select(Membership).where(Membership.org_id == org_id).order_by(Membership.created_at.desc()).limit(5)
    ).all():
        events.append({"kind": "joined", "at": m.created_at, "who": m.user.name, "what": ""})
    events.sort(key=lambda e: e["at"], reverse=True)
    # Joins are useful context but shouldn't crowd out submissions and reviews.
    joins = [e for e in events if e["kind"] == "joined"]
    work = [e for e in events if e["kind"] != "joined"]
    events = sorted(work + joins[:2], key=lambda e: e["at"], reverse=True) if work else joins

    return {
        "deadlines": deadlines[:20],
        "overdue": overdue[:20],
        "overdue_count": len(overdue),
        "revisions": revisions[:20],
        "study_seconds_week": sum(s.elapsed_seconds() for s in member_sessions),
        "members_studied_week": len({s.user_id for s in member_sessions}),
        "member_count": len(member_ids),
        "activity": events[:8],
    }
