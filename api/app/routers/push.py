"""Push notification settings: subscribe a device, list or remove devices, quiet hours, test push."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import push
from ..auth import current_user, notify
from ..config import get_settings
from ..db import get_db
from ..models import NotificationPrefs, PushSubscription, User

router = APIRouter()


class Keys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1024, pattern="^https://")
    keys: Keys
    device: str = Field("", max_length=120)


class EndpointIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1024)


class PrefsIn(BaseModel):
    # Both set, or both null to turn quiet hours off. Minutes after local midnight.
    quiet_start_minute: int | None = Field(None, ge=0, le=24 * 60 - 1)
    quiet_end_minute: int | None = Field(None, ge=0, le=24 * 60 - 1)


def _prefs(db: Session, user: User) -> dict:
    p = db.get(NotificationPrefs, user.id)
    return {
        "quiet_start_minute": p.quiet_start_minute if p else None,
        "quiet_end_minute": p.quiet_end_minute if p else None,
        "timezone": user.timezone,
    }


@router.get("/push/config")
def config():
    """The public key the browser needs to subscribe. Not secret."""
    return {"configured": push.configured(), "public_key": get_settings().vapid_public_key or None}


@router.get("/push/devices")
def devices(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id)
                      .order_by(PushSubscription.created_at)).all()
    return [{"id": s.id, "device": s.device or "This browser", "endpoint": s.endpoint, "created_at": s.created_at} for s in rows]


@router.post("/push/subscriptions", status_code=201)
def subscribe(body: SubscriptionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not push.configured():
        raise HTTPException(409, "Push notifications aren't set up on the server yet. Ask whoever runs PLARE to add VAPID keys.")
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint)
        db.add(sub)
    # A shared device follows whoever signed in on it most recently.
    sub.user_id, sub.p256dh, sub.auth, sub.device = user.id, body.keys.p256dh, body.keys.auth, body.device.strip()
    db.commit()
    return {"id": sub.id}


@router.post("/push/unsubscribe", status_code=204)
def unsubscribe(body: EndpointIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    push.forget_device(db, user.id, body.endpoint)
    db.commit()
    return Response(status_code=204)


@router.delete("/push/devices/{device_id}", status_code=204)
def remove_device(device_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub = db.get(PushSubscription, device_id)
    if sub is None or sub.user_id != user.id:
        raise HTTPException(404, "Device not found")
    db.delete(sub)
    db.commit()
    return Response(status_code=204)


@router.post("/push/test")
def test_push(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not push.configured():
        raise HTTPException(409, "Push notifications aren't set up on the server yet.")
    if not db.scalar(select(PushSubscription).where(PushSubscription.user_id == user.id)):
        raise HTTPException(409, "Turn on notifications on this device first.")
    notify(db, user.id, None, "test", "Test notification", body="Notifications from PLARE will look like this.", link="/app")
    db.commit()
    return {"sent": push.send_pending(db)}


@router.get("/me/notification-prefs")
def get_prefs(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _prefs(db, user)


@router.put("/me/notification-prefs")
def set_prefs(body: PrefsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if (body.quiet_start_minute is None) != (body.quiet_end_minute is None):
        raise HTTPException(422, "Set both a start and an end for quiet hours, or clear both.")
    if body.quiet_start_minute is not None and body.quiet_start_minute == body.quiet_end_minute:
        raise HTTPException(422, "Quiet hours need different start and end times.")
    p = db.get(NotificationPrefs, user.id)
    if p is None:
        p = NotificationPrefs(user_id=user.id)
        db.add(p)
    p.quiet_start_minute, p.quiet_end_minute = body.quiet_start_minute, body.quiet_end_minute
    db.commit()
    return _prefs(db, user)
