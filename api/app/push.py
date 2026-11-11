"""Web Push: sends in-app notifications to people's phones and browsers.

Every call to `auth.notify` creates a Notification row. Once a minute, `send_pending` pushes
the new ones to each of that person's subscribed devices. It respects quiet hours, and
records a PushDelivery row per notification before sending, so nothing is pushed twice even
if the in-process loop and the cron endpoint run at the same time.

Without VAPID keys, push is off and the app shows "not set up" rather than pretending.

Generate a key pair with:  python -m app.push keys
"""
from __future__ import annotations

import base64
import json
import logging
import sys
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import now
from .engine.quiet import in_quiet_hours
from .models import Notification, NotificationPrefs, PushDelivery, PushSubscription, User

logger = logging.getLogger("plare.push")

# Only notifications this recent are pushed. Older ones (for example from before push was
# set up, or while the server was asleep) stay in the app instead of arriving late.
FRESH = timedelta(minutes=30)
# How long a push service keeps trying to reach an offline device.
TTL_SECONDS = 60 * 60
BATCH = 200


class Gone(Exception):
    """The push service says this subscription no longer exists."""


def configured() -> bool:
    s = get_settings()
    return bool(s.vapid_public_key and s.vapid_private_key)


def generate_keys() -> tuple[str, str]:
    """A new VAPID key pair as (public, private), both base64url without padding."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    raw_private = key.private_numbers().private_value.to_bytes(32, "big")
    raw_public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    return b64(raw_public), b64(raw_private)


def send_one(sub: PushSubscription, payload: dict) -> None:
    """Push one payload to one device. Raises Gone if the device unsubscribed."""
    from pywebpush import WebPushException, webpush

    s = get_settings()
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload), vapid_private_key=s.vapid_private_key,
            vapid_claims={"sub": s.vapid_subject}, ttl=TTL_SECONDS, timeout=10,
        )
    except WebPushException as e:
        if e.response is not None and e.response.status_code in (404, 410):
            raise Gone from e
        raise


def payload_for(n: Notification) -> dict:
    return {"title": n.title, "body": n.body, "link": n.link or "/app", "tag": f"{n.category}-{n.id}"}


def _deliver(db: Session, n: Notification) -> str:
    user = db.get(User, n.user_id)
    subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id == n.user_id)).all()
    if user is None or not subs:
        return "no_device"
    prefs = db.get(NotificationPrefs, n.user_id)
    if prefs and in_quiet_hours(now(), user.timezone, prefs.quiet_start_minute, prefs.quiet_end_minute):
        return "quiet"
    sent = 0
    for sub in subs:
        try:
            send_one(sub, payload_for(n))
            sent += 1
        except Gone:
            db.delete(sub)
        except Exception:
            logger.exception("Push to subscription %s failed", sub.id)
    return "sent" if sent else "failed"


def send_pending(db: Session) -> int:
    """Push every fresh, unread, not-yet-handled notification. Returns how many were sent."""
    if not configured():
        return 0
    handled = select(PushDelivery.notification_id)
    rows = db.scalars(
        select(Notification).where(
            Notification.created_at >= now() - FRESH, Notification.read_at.is_(None), Notification.id.not_in(handled),
        ).order_by(Notification.created_at).limit(BATCH)
    ).all()
    sent = 0
    for n in rows:
        # Claim it first. If another runner already did, skip it.
        db.add(PushDelivery(notification_id=n.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        status = _deliver(db, n)
        db.get(PushDelivery, n.id).status = status
        db.commit()
        sent += status == "sent"
    return sent


def forget_device(db: Session, user_id: str, endpoint: str) -> None:
    db.execute(delete(PushSubscription).where(PushSubscription.user_id == user_id, PushSubscription.endpoint == endpoint))


if __name__ == "__main__":
    if sys.argv[1:] == ["keys"]:
        public, private = generate_keys()
        print(f"VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}")
    else:
        print("Usage: python -m app.push keys")
