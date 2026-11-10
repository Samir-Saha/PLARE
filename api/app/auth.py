"""Authentication and authorization.

Identity comes from a Supabase Auth JWT (Google sign-in). Roles are never read
from the client: every org-scoped route loads the caller's membership row.
"""
from __future__ import annotations

from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AuditLog, Membership, Notification, Role, User


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json")


def _decode(token: str) -> dict:
    settings = get_settings()
    try:
        if settings.supabase_jwt_secret:
            return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        if settings.supabase_url:
            key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token).key
            return jwt.decode(token, key, algorithms=["ES256", "RS256"], audience="authenticated")
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "Invalid or expired session") from exc
    raise HTTPException(503, "Sign-in is not configured on this server")


def current_user(
    authorization: str | None = Header(None),
    x_demo_user: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    settings = get_settings()
    if authorization and authorization.lower().startswith("bearer "):
        claims = _decode(authorization[7:])
        auth_id, email = claims.get("sub"), (claims.get("email") or "").lower()
        if not auth_id or not email:
            raise HTTPException(401, "Session is missing identity claims")
        user = db.scalar(select(User).where(User.auth_id == auth_id))
        if user is None:
            meta = claims.get("user_metadata") or {}
            user = User(auth_id=auth_id, email=email, name=meta.get("full_name") or email.split("@")[0])
            db.add(user)
            db.commit()
        return user
    if settings.demo_auth and x_demo_user:
        user = db.scalar(select(User).where(User.email == x_demo_user.lower(), User.is_demo.is_(True)))
        if user:
            return user
    raise HTTPException(401, "Sign in required")


def membership(db: Session, user: User, org_id: str, *roles: Role) -> Membership:
    """Caller's membership in the org, or 404/403. Passing roles restricts to those roles."""
    m = db.scalar(select(Membership).where(Membership.org_id == org_id, Membership.user_id == user.id))
    if m is None:
        # 404, not 403: don't reveal that another org exists.
        raise HTTPException(404, "Group not found")
    if roles and Role(m.role) not in roles:
        raise HTTPException(403, "You don't have permission to do that")
    return m


LEADS = (Role.admin, Role.lead)


def notify(db: Session, user_id: str, org_id: str | None, category: str, title: str, body: str = "", link: str = ""):
    db.add(Notification(user_id=user_id, org_id=org_id, category=category, title=title, body=body, link=link))


def audit(db: Session, org_id: str, actor: User, action: str, detail: str = ""):
    db.add(AuditLog(org_id=org_id, actor_id=actor.id, action=action, detail=detail))
