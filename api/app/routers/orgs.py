from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from zoneinfo import available_timezones

from ..auth import LEADS, audit, current_user, membership
from ..db import get_db, now
from ..models import Invitation, Membership, Notification, Organization, Role, User

router = APIRouter()

TEMPLATES = {
    "pledge_class": ("Pledge", "Brother / PM"),
    "study_group": ("Member", "Organizer"),
    "intern_team": ("Intern", "Team lead"),
    "club": ("Member", "Officer"),
    "project_group": ("Teammate", "Project lead"),
}


class ProfileIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    timezone: str | None = None


class OrgIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    kind: str = "pledge_class"


class InviteIn(BaseModel):
    role: Role = Role.member
    expires_in_days: int | None = Field(7, ge=1, le=90)


class RoleIn(BaseModel):
    role: Role


def _me(db: Session, user: User) -> dict:
    rows = db.scalars(select(Membership).where(Membership.user_id == user.id)).all()
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "timezone": user.timezone,
        "is_demo": user.is_demo,
        "calendar_synced_at": user.calendar_synced_at,
        "orgs": [
            {
                "id": m.org.id,
                "name": m.org.name,
                "kind": m.org.kind,
                "role": m.role,
                "member_label": m.org.member_label,
                "lead_label": m.org.lead_label,
                "is_demo": m.org.is_demo,
            }
            for m in rows
        ],
    }


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _me(db, user)


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user = db.merge(user)
    if body.timezone is not None:
        if body.timezone not in available_timezones():
            raise HTTPException(422, "Unknown timezone")
        user.timezone = body.timezone
    if body.name is not None:
        user.name = body.name.strip()
    db.commit()
    return _me(db, user)


@router.post("/orgs", status_code=201)
def create_org(body: OrgIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.kind not in TEMPLATES:
        raise HTTPException(422, "Unknown group type")
    member_label, lead_label = TEMPLATES[body.kind]
    org = Organization(name=body.name.strip(), kind=body.kind, member_label=member_label, lead_label=lead_label)
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=user.id, role=Role.admin))
    audit(db, org.id, user, "org.create", org.name)
    db.commit()
    return {"id": org.id, "name": org.name}


@router.get("/orgs/{org_id}/members")
def members(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    rows = db.scalars(select(Membership).where(Membership.org_id == org_id)).all()
    return [
        {"user_id": m.user_id, "name": m.user.name, "role": m.role, "timezone": m.user.timezone}
        for m in sorted(rows, key=lambda m: m.user.name.lower())
    ]


@router.post("/orgs/{org_id}/invites", status_code=201)
def create_invite(org_id: str, body: InviteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    me_ = membership(db, user, org_id, *LEADS)
    # Only admins can mint invites for elevated roles.
    if body.role != Role.member and Role(me_.role) != Role.admin:
        raise HTTPException(403, "Only an admin can invite leads or admins")
    invite = Invitation(
        org_id=org_id,
        role=body.role,
        created_by=user.id,
        expires_at=now() + timedelta(days=body.expires_in_days) if body.expires_in_days else None,
    )
    db.add(invite)
    audit(db, org_id, user, "invite.create", body.role.value)
    db.commit()
    return {"code": invite.code, "role": invite.role, "expires_at": invite.expires_at}


@router.get("/invites/{code}")
def preview_invite(code: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    invite = _valid_invite(db, code)
    org = db.get(Organization, invite.org_id)
    return {"org_name": org.name, "kind": org.kind, "role": invite.role}


@router.post("/invites/{code}/accept")
def accept_invite(code: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    invite = _valid_invite(db, code)
    existing = db.scalar(
        select(Membership).where(Membership.org_id == invite.org_id, Membership.user_id == user.id)
    )
    if existing is None:
        db.add(Membership(org_id=invite.org_id, user_id=user.id, role=invite.role))
        audit(db, invite.org_id, user, "member.join", user.email)
        db.commit()
    return {"org_id": invite.org_id}


def _valid_invite(db: Session, code: str) -> Invitation:
    invite = db.get(Invitation, code)
    if invite is None or invite.revoked or (invite.expires_at and invite.expires_at < now()):
        raise HTTPException(404, "This invite link is invalid or has expired")
    return invite


@router.patch("/orgs/{org_id}/members/{user_id}")
def set_role(org_id: str, user_id: str, body: RoleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, Role.admin)
    target = db.scalar(select(Membership).where(Membership.org_id == org_id, Membership.user_id == user_id))
    if target is None:
        raise HTTPException(404, "Member not found")
    if Role(target.role) == Role.admin and body.role != Role.admin and _admin_count(db, org_id) == 1:
        raise HTTPException(409, "A group needs at least one admin")
    target.role = body.role
    audit(db, org_id, user, "member.role", f"{user_id} -> {body.role.value}")
    db.commit()
    return {"user_id": user_id, "role": target.role}


@router.delete("/orgs/{org_id}/members/{user_id}", status_code=204)
def remove_member(org_id: str, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    # Admins remove anyone; anyone can remove themselves.
    membership(db, user, org_id, *([] if user_id == user.id else [Role.admin]))
    target = db.scalar(select(Membership).where(Membership.org_id == org_id, Membership.user_id == user_id))
    if target is None:
        raise HTTPException(404, "Member not found")
    if Role(target.role) == Role.admin and _admin_count(db, org_id) == 1:
        raise HTTPException(409, "A group needs at least one admin")
    db.delete(target)
    audit(db, org_id, user, "member.remove", user_id)
    db.commit()


def _admin_count(db: Session, org_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(Membership).where(Membership.org_id == org_id, Membership.role == Role.admin)
    )


@router.get("/notifications")
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(50)
    ).all()
    return [
        {"id": n.id, "category": n.category, "title": n.title, "body": n.body, "link": n.link,
         "read": n.read_at is not None, "created_at": n.created_at}
        for n in rows
    ]


class ReadIn(BaseModel):
    ids: list[str] | None = None  # omit to mark everything read


@router.post("/notifications/read", status_code=204)
def mark_read(body: ReadIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if body and body.ids is not None:
        q = q.where(Notification.id.in_(body.ids))
    for n in db.scalars(q):
        n.read_at = now()
    db.commit()
