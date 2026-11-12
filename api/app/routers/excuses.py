"""Excused absence routes: pledges request, brothers approve or deny."""
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..auth import LEADS, audit, current_user, membership, notify
from ..config import get_settings
from ..db import get_db, now
from ..excuses import KINDS, REASONS
from ..logbook import LOCAL_TZ
from ..models import Excuse, Membership, Role, User, uid
from .tasks import SIGNATURES

router = APIRouter()

MAX_DAYS = 14


class ReviewIn(BaseModel):
    decision: str = Field(pattern="^(approved|denied)$")
    reply: str = Field("", max_length=500)


def _names(db: Session, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(ids))).all())


def _out(e: Excuse, names: dict[str, str]) -> dict:
    return {
        "id": e.id, "user_id": e.user_id, "user_name": names.get(e.user_id, ""),
        "kind": e.kind, "kind_label": KINDS.get(e.kind, e.kind), "start_day": e.start_day, "end_day": e.end_day,
        "reason": e.reason, "reason_label": REASONS.get(e.reason, e.reason), "note": e.note,
        "has_file": bool(e.file_path), "file_type": e.file_type, "late": e.late, "status": e.status,
        "reply": e.reply, "reviewer_name": names.get(e.reviewer_id, "") if e.reviewer_id else None,
        "created_at": e.created_at, "reviewed_at": e.reviewed_at,
    }


def _list(db: Session, rows: list[Excuse]) -> list[dict]:
    names = _names(db, {e.user_id for e in rows} | {e.reviewer_id for e in rows if e.reviewer_id})
    return [_out(e, names) for e in rows]


def _day(value: str, name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"{name} must be a date like 2026-11-10") from None


def _load(db: Session, user: User, excuse_id: str, *roles: Role) -> tuple[Excuse, Membership]:
    e = db.get(Excuse, excuse_id)
    if e is None:
        raise HTTPException(404, "Excuse not found")
    return e, membership(db, user, e.org_id, *roles)


@router.post("/orgs/{org_id}/excuses", status_code=201)
async def request_excuse(
    org_id: str,
    kind: str = Form(...),
    start_day: str = Form(...),
    end_day: str = Form(""),
    reason: str = Form(...),
    note: str = Form(""),
    file: UploadFile | None = File(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    membership(db, user, org_id, Role.member)
    if kind not in KINDS:
        raise HTTPException(422, "Choose what you're missing")
    if reason not in REASONS:
        raise HTTPException(422, "Choose a reason")
    note = note.strip()
    if len(note) > 500:
        raise HTTPException(422, "Keep the note under 500 characters")
    if reason == "other" and not note:
        raise HTTPException(422, "Add a note that explains the reason")
    start = _day(start_day, "The first day")
    end = _day(end_day, "The last day") if end_day else start
    if end < start:
        raise HTTPException(422, "The last day can't be before the first day")
    if (end - start).days >= MAX_DAYS:
        raise HTTPException(422, f"One request covers up to {MAX_DAYS} days. Split longer absences into separate requests.")
    duplicate = db.scalar(select(Excuse.id).where(
        Excuse.org_id == org_id, Excuse.user_id == user.id, Excuse.kind == kind, Excuse.status == "pending",
        Excuse.start_day == start.isoformat(), Excuse.end_day == end.isoformat()))
    if duplicate:
        raise HTTPException(409, "You already have a pending request for this. Wait for a reply or withdraw it first.")

    file_path = file_type = None
    if file is not None:
        settings = get_settings()
        data = await file.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, f"File is larger than {settings.max_upload_bytes // (1024 * 1024)} MB")
        file_type = next((mime for mime, (sig, _) in SIGNATURES.items() if data.startswith(sig)), None)
        if file_type is None:
            raise HTTPException(415, "Only JPEG, PNG, or PDF files are accepted")
        # Server-generated name; the client's filename is never used.
        file_path = storage.put(f"{org_id}/{uid()}{SIGNATURES[file_type][1]}", data)

    # Late is decided by the server clock: the request came in after the first day it covers.
    today = now().astimezone(LOCAL_TZ).date()
    e = Excuse(org_id=org_id, user_id=user.id, kind=kind, start_day=start.isoformat(), end_day=end.isoformat(),
               reason=reason, note=note, file_path=file_path, file_type=file_type, late=start < today)
    db.add(e)
    for m in db.scalars(select(Membership).where(Membership.org_id == org_id, Membership.role.in_(LEADS))):
        notify(db, m.user_id, org_id, "excuse", f"{user.name} requested an excuse: {KINDS[kind]}", link="/app/excuses")
    db.commit()
    return _out(e, {user.id: user.name})


@router.get("/orgs/{org_id}/excuses/mine")
def my_excuses(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    rows = db.scalars(select(Excuse).where(Excuse.org_id == org_id, Excuse.user_id == user.id)
                      .order_by(Excuse.created_at.desc(), Excuse.id.desc())).all()
    return _list(db, list(rows))


@router.get("/orgs/{org_id}/excuses")
def list_excuses(org_id: str, status: str = "pending", user_id: str | None = None,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    q = select(Excuse).where(Excuse.org_id == org_id)
    if status != "all":
        q = q.where(Excuse.status == status)
    if user_id:
        q = q.where(Excuse.user_id == user_id)
    # Pending requests oldest first, like the review queue; history newest first.
    order = (Excuse.created_at, Excuse.id) if status == "pending" else (Excuse.created_at.desc(), Excuse.id.desc())
    return _list(db, list(db.scalars(q.order_by(*order).limit(500)).all()))


@router.get("/orgs/{org_id}/excuses/summary")
def excuse_summary(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    pledges = db.execute(
        select(User.id, User.name).join(Membership, Membership.user_id == User.id)
        .where(Membership.org_id == org_id, Membership.role == Role.member.value)
    ).all()
    counts: dict[str, dict[str, int]] = {}
    for uid_, status in db.execute(select(Excuse.user_id, Excuse.status).where(Excuse.org_id == org_id)):
        counts.setdefault(uid_, {}).setdefault(status, 0)
        counts[uid_][status] += 1
    members = [{"user_id": i, "name": n, "pending": counts.get(i, {}).get("pending", 0),
                "approved": counts.get(i, {}).get("approved", 0), "denied": counts.get(i, {}).get("denied", 0)}
               for i, n in pledges]
    members.sort(key=lambda r: r["name"].lower())
    return {"pending": sum(r["pending"] for r in members), "members": members}


@router.post("/excuses/{excuse_id}/review")
def review_excuse(excuse_id: str, body: ReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e, _ = _load(db, user, excuse_id, *LEADS)
    if e.status != "pending":
        raise HTTPException(409, "This request was already reviewed")
    reply = body.reply.strip()
    if body.decision == "denied" and not reply:
        raise HTTPException(422, "Say why it's denied, so they know what to do next")
    e.status, e.reply, e.reviewer_id, e.reviewed_at = body.decision, reply, user.id, now()
    notify(db, e.user_id, e.org_id, "excuse", f"Excuse {body.decision}: {KINDS.get(e.kind, e.kind)}", body=reply, link="/app/excuses")
    audit(db, e.org_id, user, f"excuse.{body.decision}", e.id)
    db.commit()
    return _out(e, _names(db, {e.user_id, user.id}))


@router.delete("/excuses/{excuse_id}", status_code=204)
def withdraw_excuse(excuse_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e, _ = _load(db, user, excuse_id)
    if e.user_id != user.id:
        raise HTTPException(404, "Excuse not found")
    if e.status != "pending":
        raise HTTPException(409, "This request was already reviewed, so it can't be withdrawn")
    if e.file_path:
        storage.remove(e.file_path)
    db.delete(e)
    db.commit()
    return Response(status_code=204)


@router.get("/excuses/{excuse_id}/file")
def excuse_file(excuse_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Private proof: only the requester and the group's leads can fetch it."""
    e, m = _load(db, user, excuse_id)
    if not e.file_path or (e.user_id != user.id and Role(m.role) not in LEADS):
        raise HTTPException(404, "File not found")
    return storage.file_response(e.file_path, e.file_type)
