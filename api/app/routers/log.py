"""Accountability log routes. Facts only: what was late, missed, or short."""
from datetime import datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import LEADS, audit, current_user, membership
from ..db import get_db, now
from ..logbook import KINDS, LOCAL_TZ, add_entry, label, sync_overdue
from ..models import LogEntry, Membership, Role, User

router = APIRouter()

KIND_PATTERN = "^(" + "|".join(KINDS) + ")$"


class EntryIn(BaseModel):
    user_id: str = Field(min_length=1, max_length=32)
    kind: str = Field(pattern=KIND_PATTERN)
    detail: str = Field(min_length=1, max_length=500)


def _today_start_utc() -> datetime:
    local_midnight = datetime.combine(now().astimezone(LOCAL_TZ).date(), time.min, tzinfo=LOCAL_TZ)
    return local_midnight.astimezone(timezone.utc)


def _names(db: Session, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(ids))).all())


def _out(e: LogEntry, names: dict[str, str]) -> dict:
    return {
        "id": e.id, "user_id": e.user_id, "user_name": names.get(e.user_id, ""), "kind": e.kind, "label": label(e.kind),
        "detail": e.detail, "automatic": e.automatic, "created_by": e.created_by,
        "created_by_name": names.get(e.created_by, "") if e.created_by else None, "created_at": e.created_at,
    }


@router.get("/orgs/{org_id}/log")
def list_log(org_id: str, user_id: str | None = None, kind: str | None = None,
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = membership(db, user, org_id)
    if sync_overdue(db, org_id):
        db.commit()
    q = select(LogEntry).where(LogEntry.org_id == org_id)
    if Role(m.role) == Role.member:
        q = q.where(LogEntry.user_id == user.id)  # members only ever see their own entries
    elif user_id:
        q = q.where(LogEntry.user_id == user_id)
    if kind:
        q = q.where(LogEntry.kind == kind)
    rows = db.scalars(q.order_by(LogEntry.created_at.desc(), LogEntry.id.desc()).limit(500)).all()
    names = _names(db, {e.user_id for e in rows} | {e.created_by for e in rows if e.created_by})
    return [_out(e, names) for e in rows]


@router.get("/orgs/{org_id}/log/summary")
def log_summary(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    if sync_overdue(db, org_id):
        db.commit()
    pledges = db.execute(
        select(User.id, User.name).join(Membership, Membership.user_id == User.id)
        .where(Membership.org_id == org_id, Membership.role == Role.member.value)
    ).all()
    counts = dict(db.execute(
        select(LogEntry.user_id, func.count()).where(LogEntry.org_id == org_id).group_by(LogEntry.user_id)
    ).all())
    today = db.scalar(select(func.count()).select_from(LogEntry).where(
        LogEntry.org_id == org_id, LogEntry.created_at >= _today_start_utc()))
    members = [{"user_id": uid, "name": name, "count": counts.get(uid, 0)} for uid, name in pledges]
    members.sort(key=lambda r: (-r["count"], r["name"]))
    return {"today": today or 0, "total": sum(r["count"] for r in members), "members": members}


@router.post("/orgs/{org_id}/log", status_code=201)
def create_entry(org_id: str, body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    target = db.scalar(select(Membership).where(Membership.org_id == org_id, Membership.user_id == body.user_id))
    if target is None:
        raise HTTPException(404, "That person isn't in this group")
    entry = add_entry(db, org_id, body.user_id, body.kind, body.detail, created_by=user.id)
    audit(db, org_id, user, "log.create", f"{body.kind}: {body.detail[:120]}")
    db.commit()
    return _out(entry, _names(db, {entry.user_id, user.id}))


@router.delete("/orgs/{org_id}/log/{entry_id}", status_code=204)
def delete_entry(org_id: str, entry_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    entry = db.get(LogEntry, entry_id)
    if entry is None or entry.org_id != org_id:
        raise HTTPException(404, "Log entry not found")
    if entry.automatic:
        raise HTTPException(409, "Automatic entries can't be removed. They come from the group's records.")
    audit(db, org_id, user, "log.delete", f"{entry.kind}: {entry.detail[:120]}")
    db.delete(entry)
    db.commit()
    return Response(status_code=204)
