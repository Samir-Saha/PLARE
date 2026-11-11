"""Coffee chats: a list of brothers each pledge meets by a deadline, checked off by the pledge."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth import LEADS, audit, current_user, membership
from ..db import get_db, now
from ..models import CoffeeChatBrother, CoffeeChatCompletion, Membership, Role, User

router = APIRouter()


class BrotherIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    due_at: datetime


def _brother(db: Session, org_id: str, brother_id: str) -> CoffeeChatBrother:
    b = db.get(CoffeeChatBrother, brother_id)
    if b is None or b.org_id != org_id:
        raise HTTPException(404, "Brother not found")
    return b


@router.get("/orgs/{org_id}/coffee-chats")
def list_chats(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = membership(db, user, org_id)
    brothers = db.scalars(select(CoffeeChatBrother).where(CoffeeChatBrother.org_id == org_id)
                          .order_by(CoffeeChatBrother.due_at, CoffeeChatBrother.last_name, CoffeeChatBrother.first_name)).all()
    mine = dict(db.execute(select(CoffeeChatCompletion.brother_id, CoffeeChatCompletion.completed_at).where(
        CoffeeChatCompletion.org_id == org_id, CoffeeChatCompletion.user_id == user.id)).all())
    is_lead = Role(m.role) in LEADS
    done_counts: dict[str, int] = {}
    pledges = 0
    if is_lead:
        member_ids = select(Membership.user_id).where(Membership.org_id == org_id, Membership.role == Role.member.value)
        pledges = db.scalar(select(func.count()).select_from(member_ids.subquery())) or 0
        done_counts = dict(db.execute(
            select(CoffeeChatCompletion.brother_id, func.count()).where(
                CoffeeChatCompletion.org_id == org_id, CoffeeChatCompletion.user_id.in_(member_ids))
            .group_by(CoffeeChatCompletion.brother_id)).all())
    t = now()
    rows = []
    for b in brothers:
        done_at = mine.get(b.id)
        row = {
            "id": b.id, "first_name": b.first_name, "last_name": b.last_name, "due_at": b.due_at,
            "done": done_at is not None, "completed_at": done_at,
            "overdue": done_at is None and b.due_at < t,
        }
        if is_lead:
            row["done_count"] = done_counts.get(b.id, 0)
            row["member_count"] = pledges
        rows.append(row)
    return rows


@router.post("/orgs/{org_id}/coffee-chats", status_code=201)
def add_brother(org_id: str, body: BrotherIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    if body.due_at.tzinfo is None:
        raise HTTPException(422, "due_at must include a timezone offset")
    b = CoffeeChatBrother(org_id=org_id, first_name=body.first_name.strip(), last_name=body.last_name.strip(),
                          due_at=body.due_at, created_by=user.id)
    if not b.first_name or not b.last_name:
        raise HTTPException(422, "Enter the brother's first and last name")
    db.add(b)
    audit(db, org_id, user, "coffee.add", f"{b.first_name} {b.last_name}")
    db.commit()
    return {"id": b.id, "first_name": b.first_name, "last_name": b.last_name, "due_at": b.due_at}


@router.delete("/orgs/{org_id}/coffee-chats/{brother_id}", status_code=204)
def remove_brother(org_id: str, brother_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    b = _brother(db, org_id, brother_id)
    audit(db, org_id, user, "coffee.remove", f"{b.first_name} {b.last_name}")
    # Explicit, since SQLite doesn't enforce the ON DELETE CASCADE.
    db.execute(delete(CoffeeChatCompletion).where(CoffeeChatCompletion.brother_id == b.id))
    db.delete(b)
    db.commit()
    return Response(status_code=204)


@router.put("/orgs/{org_id}/coffee-chats/{brother_id}/done")
def mark_done(org_id: str, brother_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = membership(db, user, org_id)
    if Role(m.role) != Role.member:
        raise HTTPException(403, "Only pledges check off coffee chats")
    b = _brother(db, org_id, brother_id)
    c = db.scalar(select(CoffeeChatCompletion).where(CoffeeChatCompletion.brother_id == b.id,
                                                     CoffeeChatCompletion.user_id == user.id))
    if c is None:
        c = CoffeeChatCompletion(brother_id=b.id, org_id=org_id, user_id=user.id)
        db.add(c)
        db.commit()
    return {"done": True, "completed_at": c.completed_at}


@router.delete("/orgs/{org_id}/coffee-chats/{brother_id}/done")
def mark_not_done(org_id: str, brother_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    b = _brother(db, org_id, brother_id)
    c = db.scalar(select(CoffeeChatCompletion).where(CoffeeChatCompletion.brother_id == b.id,
                                                     CoffeeChatCompletion.user_id == user.id))
    if c is not None:
        db.delete(c)
        db.commit()
    return {"done": False, "completed_at": None}
