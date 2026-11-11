from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ai_check
from ..auth import LEADS, audit, current_user, membership, notify
from ..config import get_settings
from ..db import get_db, now
from ..models import Assignment, CaptureToken, Membership, Role, Submission, SubmissionCheck, Task, TaskStatus, User, uid

router = APIRouter()

# Allowed evidence types, checked against the file's leading bytes, not the client's claim.
SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff", ".jpg"),
    "image/png": (b"\x89PNG\r\n\x1a\n", ".png"),
    "application/pdf": (b"%PDF-", ".pdf"),
}

# A camera-only photo must be sent within this long after "Take photo" was pressed.
CAPTURE_TTL = timedelta(minutes=10)


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    category: str = Field("General", max_length=48)
    priority: str = Field("normal", pattern="^(low|normal|high)$")
    due_at: datetime | None = None
    estimate_minutes: int | None = Field(None, ge=5, le=6000)
    evidence: str = Field("any", pattern="^(any|text|photo|camera|none)$")
    # "all_members", "open" (anyone can claim), or explicit user ids.
    assign: str = Field("all_members", pattern="^(all_members|open|users)$")
    user_ids: list[str] = []


class ReviewIn(BaseModel):
    decision: str = Field(pattern="^(approved|needs_revision)$")
    feedback: str = ""


def _overdue(task: Task, status: str) -> bool:
    return bool(task.due_at and task.due_at < now() and status not in (TaskStatus.submitted, TaskStatus.approved))


def _ai_check_on(evidence: str) -> bool:
    """Whether written work on this task is sent to the AI check, so the form can say so."""
    return bool(ai_check.get_settings().gptzero_api_key) and evidence in ("any", "text")


def _assignment(a: Assignment, latest: Submission | None = None, check: SubmissionCheck | None = None) -> dict:
    t = a.task
    return {
        "id": a.id, "task_id": t.id, "title": t.title, "description": t.description, "category": t.category,
        "priority": t.priority, "due_at": t.due_at, "estimate_minutes": t.estimate_minutes, "evidence": t.evidence,
        "status": a.status, "overdue": _overdue(t, a.status), "completed_at": a.completed_at,
        "user_id": a.user_id, "user_name": a.user.name,
        "feedback": latest.feedback if latest else "",
        "ai_check_on": _ai_check_on(t.evidence),
        # The submitter sees their own latest check, the same thing reviewers see.
        "check": ai_check.as_dict(check) if latest else None,
    }


def _load_assignment(db: Session, user: User, assignment_id: str) -> Assignment:
    a = db.get(Assignment, assignment_id)
    if a is None or a.task.deleted_at:
        raise HTTPException(404, "Task not found")
    membership(db, user, a.org_id)
    if a.user_id != user.id:
        raise HTTPException(404, "Task not found")
    return a


@router.post("/orgs/{org_id}/tasks", status_code=201)
def create_task(org_id: str, body: TaskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    if body.due_at and body.due_at.tzinfo is None:
        raise HTTPException(422, "due_at must include a timezone offset")
    task = Task(
        org_id=org_id, title=body.title.strip(), description=body.description, category=body.category,
        priority=body.priority, due_at=body.due_at, estimate_minutes=body.estimate_minutes,
        evidence=body.evidence, claimable=body.assign == "open", created_by=user.id,
    )
    db.add(task)
    db.flush()
    members = db.scalars(select(Membership).where(Membership.org_id == org_id)).all()
    if body.assign == "all_members":
        targets = [m.user_id for m in members if Role(m.role) == Role.member]
    elif body.assign == "users":
        valid = {m.user_id for m in members}
        if not body.user_ids or not set(body.user_ids) <= valid:
            raise HTTPException(422, "Assignees must be members of this group")
        targets = list(dict.fromkeys(body.user_ids))
    else:
        targets = []
    for user_id in targets:
        db.add(Assignment(task_id=task.id, org_id=org_id, user_id=user_id))
        notify(db, user_id, org_id, "task", f"New task: {task.title}", link="/app")
    audit(db, org_id, user, "task.create", task.title)
    db.commit()
    return {"id": task.id, "assigned": len(targets)}


@router.get("/orgs/{org_id}/tasks/mine")
def my_tasks(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    rows = db.scalars(
        select(Assignment).join(Task).where(
            Assignment.org_id == org_id, Assignment.user_id == user.id, Task.deleted_at.is_(None)
        )
    ).all()
    out = []
    for a in rows:
        latest = db.scalar(
            select(Submission).where(Submission.assignment_id == a.id).order_by(Submission.created_at.desc())
        )
        out.append(_assignment(a, latest, db.get(SubmissionCheck, latest.id) if latest else None))
    far = datetime.max.replace(tzinfo=now().tzinfo)
    return sorted(out, key=lambda x: (x["status"] == TaskStatus.approved, x["due_at"] or far))


@router.get("/orgs/{org_id}/tasks/open")
def open_tasks(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    mine = select(Assignment.task_id).where(Assignment.user_id == user.id)
    rows = db.scalars(
        select(Task).where(Task.org_id == org_id, Task.claimable, Task.deleted_at.is_(None), Task.id.not_in(mine))
    ).all()
    return [
        {"task_id": t.id, "title": t.title, "description": t.description, "category": t.category,
         "due_at": t.due_at, "estimate_minutes": t.estimate_minutes}
        for t in rows
    ]


@router.post("/tasks/{task_id}/claim", status_code=201)
def claim(task_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.deleted_at:
        raise HTTPException(404, "Task not found")
    membership(db, user, task.org_id)
    if not task.claimable:
        raise HTTPException(409, "This task can't be claimed")
    if db.scalar(select(Assignment).where(Assignment.task_id == task_id, Assignment.user_id == user.id)):
        raise HTTPException(409, "You already have this task")
    a = Assignment(task_id=task_id, org_id=task.org_id, user_id=user.id, status=TaskStatus.in_progress)
    db.add(a)
    db.commit()
    return {"id": a.id}


@router.post("/assignments/{assignment_id}/start")
def start(assignment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = _load_assignment(db, user, assignment_id)
    if a.status == TaskStatus.not_started:
        a.status = TaskStatus.in_progress
        db.commit()
    return {"status": a.status}


@router.post("/assignments/{assignment_id}/capture", status_code=201)
def start_capture(assignment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Called when the person presses "Take photo" on a camera-only task."""
    a = _load_assignment(db, user, assignment_id)
    if a.task.evidence != "camera":
        raise HTTPException(409, "This task doesn't use the in-app camera")
    tok = CaptureToken(assignment_id=a.id, user_id=user.id)
    db.add(tok)
    db.commit()
    return {"token": tok.token, "expires_at": tok.created_at + CAPTURE_TTL}


def _use_capture_token(db: Session, a: Assignment, user: User, token: str) -> CaptureToken:
    tok = db.get(CaptureToken, token) if token else None
    if tok is None or tok.assignment_id != a.id or tok.user_id != user.id:
        raise HTTPException(422, "Take the photo with the camera in PLARE. Uploaded files aren't accepted for this task.")
    if tok.used_at is not None:
        raise HTTPException(409, "That photo was already sent. Take a new one.")
    if now() - tok.created_at > CAPTURE_TTL:
        raise HTTPException(422, "That photo is more than 10 minutes old. Take a new one.")
    return tok


@router.post("/assignments/{assignment_id}/submissions", status_code=201)
async def submit(
    assignment_id: str,
    background: BackgroundTasks,
    text: str = Form(""),
    file: UploadFile | None = File(None),
    capture_token: str = Form(""),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    a = _load_assignment(db, user, assignment_id)
    if a.status == TaskStatus.approved:
        raise HTTPException(409, "This task is already approved")
    if a.status == TaskStatus.submitted:
        raise HTTPException(409, "Your last submission is still waiting for review")
    text = text.strip()
    need = a.task.evidence
    if need in ("photo", "camera") and file is None:
        raise HTTPException(422, "This task needs a photo")
    token = _use_capture_token(db, a, user, capture_token) if need == "camera" else None
    if need == "text" and not text:
        raise HTTPException(422, "This task needs a written response")
    if need == "any" and not text and file is None:
        raise HTTPException(422, "Add a note or attach a file")

    file_path = file_type = data = None
    if file is not None:
        settings = get_settings()
        data = await file.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, f"File is larger than {settings.max_upload_bytes // (1024 * 1024)} MB")
        file_type = next((mime for mime, (sig, _) in SIGNATURES.items() if data.startswith(sig)), None)
        if file_type is None:
            raise HTTPException(415, "Only JPEG, PNG, or PDF files are accepted")
        if need in ("photo", "camera") and not file_type.startswith("image/"):
            raise HTTPException(415, "This task needs a photo (JPEG or PNG)")
        # Server-generated name; the client's filename is never used on disk.
        file_path = f"{a.org_id}/{uid()}{SIGNATURES[file_type][1]}"
        target = Path(settings.upload_dir) / file_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    sub = Submission(assignment_id=a.id, org_id=a.org_id, user_id=user.id, text=text, file_path=file_path, file_type=file_type)
    db.add(sub)
    db.flush()
    t = now()
    if token is not None:
        token.used_at = t
    status = ai_check.initial_status(ai_check.checkable_text(text, data, file_type))
    db.add(SubmissionCheck(submission_id=sub.id, captured_at=t if token is not None else None, ai_status=status))
    a.status = TaskStatus.submitted
    for m in db.scalars(select(Membership).where(Membership.org_id == a.org_id, Membership.role.in_(LEADS))):
        notify(db, m.user_id, a.org_id, "review", f"{user.name} submitted {a.task.title}", link="/app/review")
    db.commit()
    if status == "pending":
        background.add_task(ai_check.run_check, sub.id)
    return {"id": sub.id, "status": a.status}


def _submission(s: Submission, check: SubmissionCheck | None) -> dict:
    a = s.assignment
    return {
        "id": s.id, "assignment_id": a.id, "task_title": a.task.title, "category": a.task.category,
        "user_id": s.user_id, "user_name": a.user.name, "text": s.text, "has_file": bool(s.file_path),
        "file_type": s.file_type, "status": s.status, "feedback": s.feedback,
        "created_at": s.created_at, "reviewed_at": s.reviewed_at, "evidence": a.task.evidence,
        **ai_check.as_dict(check),
    }


@router.get("/orgs/{org_id}/review")
def review_queue(org_id: str, status: str = "pending", user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    q = select(Submission).where(Submission.org_id == org_id)
    if status != "all":
        q = q.where(Submission.status == status)
    return [_submission(s, db.get(SubmissionCheck, s.id)) for s in db.scalars(q.order_by(Submission.created_at)).all()]


@router.get("/submissions/{submission_id}/file")
def submission_file(submission_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Private evidence: only the submitter and the group's leads can fetch it."""
    s = db.get(Submission, submission_id)
    if s is None or not s.file_path:
        raise HTTPException(404, "File not found")
    m = membership(db, user, s.org_id)
    if s.user_id != user.id and Role(m.role) not in LEADS:
        raise HTTPException(404, "File not found")
    path = Path(get_settings().upload_dir) / s.file_path
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type=s.file_type, headers={"Cache-Control": "private, no-store"})


@router.post("/submissions/{submission_id}/review")
def review(submission_id: str, body: ReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Submission, submission_id)
    if s is None:
        raise HTTPException(404, "Submission not found")
    membership(db, user, s.org_id, *LEADS)
    if s.status != "pending":
        raise HTTPException(409, "This submission was already reviewed")
    if body.decision == "needs_revision" and not body.feedback.strip():
        raise HTTPException(422, "Say what needs to change")
    s.status, s.feedback, s.reviewer_id, s.reviewed_at = body.decision, body.feedback.strip(), user.id, now()
    a = s.assignment
    a.status = TaskStatus(body.decision)
    a.completed_at = now() if body.decision == "approved" else None
    verdict = "approved" if body.decision == "approved" else "needs a revision"
    notify(db, s.user_id, s.org_id, "review", f"{a.task.title} {verdict}", body=s.feedback, link="/app")
    audit(db, s.org_id, user, f"submission.{body.decision}", s.id)
    db.commit()
    return _submission(s, db.get(SubmissionCheck, s.id))


@router.post("/submissions/{submission_id}/ai-check")
def rerun_ai_check(submission_id: str, background: BackgroundTasks, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    """Reviewers can run the AI check again after an error or once a key is added."""
    s = db.get(Submission, submission_id)
    if s is None:
        raise HTTPException(404, "Submission not found")
    membership(db, user, s.org_id, *LEADS)
    check = db.get(SubmissionCheck, s.id)
    # Only a failed or never-configured check is re-run. A missing row means it predates the check.
    if check is not None and check.ai_status not in ("error", "not_configured"):
        raise HTTPException(409, {"pending": "The check is already running. Refresh in a moment.",
                                  "done": "This submission was already checked."}.get(
            check.ai_status, "There's no written work long enough to check."))
    if check is None:
        check = SubmissionCheck(submission_id=s.id)
        db.add(check)
    data = None
    if s.file_path:
        path = Path(get_settings().upload_dir) / s.file_path
        data = path.read_bytes() if path.is_file() else None
    status = ai_check.initial_status(ai_check.checkable_text(s.text, data, s.file_type))
    if status == "not_configured":
        raise HTTPException(409, "The AI check isn't set up. Add GPTZERO_API_KEY on the server, then try again.")
    check.ai_status, check.ai_error = status, ""
    db.commit()
    if status == "pending":
        background.add_task(ai_check.run_check, s.id)
    return _submission(s, check)


@router.get("/orgs/{org_id}/progress")
def progress(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    rows = db.scalars(
        select(Assignment).join(Task).where(Assignment.org_id == org_id, Task.deleted_at.is_(None))
    ).all()
    people: dict[str, dict] = {}
    for a in rows:
        p = people.setdefault(a.user_id, {"user_id": a.user_id, "name": a.user.name, "total": 0, "approved": 0,
                                          "submitted": 0, "needs_revision": 0, "overdue": 0})
        p["total"] += 1
        if a.status in ("approved", "submitted", "needs_revision"):
            p[a.status] += 1
        p["overdue"] += _overdue(a.task, a.status)
    return {
        "members": sorted(people.values(), key=lambda p: p["name"].lower()),
        "total": len(rows),
        "approved": sum(a.status == "approved" for a in rows),
        "pending_review": sum(a.status == "submitted" for a in rows),
        "overdue": sum(_overdue(a.task, a.status) for a in rows),
    }
