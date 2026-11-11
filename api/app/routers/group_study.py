"""Group study room: shared sessions, random hourly photo check-ins, and a live room with chat.

How a session works:
- Anyone in the group starts the room (one at a time per group). Pledges join to study;
  brothers drop in to watch and chat.
- At the start of each hour the server picks a random check-in time for that hour and keeps
  it hidden until it opens. While it's open, joined pledges send a photo. The camera only
  opens when the pledge presses the button in the app.
- The hour counts only if at least `quorum` pledges confirmed and the session ran the full
  hour. Each pledge who confirmed gets that hour; the rules live in `engine/group_study.py`.
- Pings are created lazily whenever anyone loads the room, so there's no background job.
  A room nobody has looked at for 15 minutes ends on its own.
"""
from __future__ import annotations

import random
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import LEADS, audit, current_user, membership, notify
from ..config import get_settings
from ..db import get_db, now
from ..engine.group_study import Hour, credited_hours, hour_status, hours_started, ping_offset
from ..models import (
    GroupStudyParticipant, GroupStudySession, GroupStudySettings, Membership, Role, RoomMessage,
    StudyCheckIn, StudyPing, User, uid,
)

router = APIRouter()

DEFAULT_QUORUM = 7
DEFAULT_WINDOW = 10
IDLE_END = timedelta(minutes=15)   # room ends after this long with nobody looking at it
HERE_NOW = timedelta(seconds=30)   # "here now" if their room page polled this recently
PHOTO_TYPES = {"image/jpeg": (b"\xff\xd8\xff", ".jpg"), "image/png": (b"\x89PNG\r\n\x1a\n", ".png")}
_rng = random.SystemRandom()


class StartIn(BaseModel):
    title: str = Field("Group study", min_length=1, max_length=120)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=500)


class SettingsIn(BaseModel):
    quorum: int = Field(ge=1, le=200)
    window_minutes: int = Field(ge=3, le=30)


# ---------- helpers ----------

def _member_count(db: Session, org_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(Membership).where(Membership.org_id == org_id, Membership.role == Role.member.value)
    ) or 0


def _settings(db: Session, org_id: str) -> dict:
    row = db.get(GroupStudySettings, org_id)
    members = _member_count(db, org_id)
    if row:
        quorum, window = row.quorum, row.window_minutes
    else:
        # A small group can't reach 7, so the default never asks for more pledges than exist.
        quorum, window = max(1, min(DEFAULT_QUORUM, members)), DEFAULT_WINDOW
    return {"quorum": quorum, "window_minutes": window, "member_count": members, "customized": row is not None}


def _active(db: Session, org_id: str) -> GroupStudySession | None:
    return db.scalar(
        select(GroupStudySession).where(GroupStudySession.org_id == org_id, GroupStudySession.ended_at.is_(None))
    )


def _participants(db: Session, s: GroupStudySession) -> list[GroupStudyParticipant]:
    return list(db.scalars(select(GroupStudyParticipant).where(GroupStudyParticipant.session_id == s.id)).all())


def _studying(p: GroupStudyParticipant) -> bool:
    return p.joined_at is not None and p.left_at is None


def _refresh(db: Session, s: GroupStudySession) -> None:
    """Bring a running session up to date: end it if abandoned, create due pings, send ping notices."""
    if s.ended_at:
        return
    t = now()
    people = _participants(db, s)
    last_seen = max([p.last_seen_at for p in people], default=s.started_at)
    if t - last_seen > IDLE_END:
        s.ended_at = max(last_seen, s.started_at)
        db.commit()
        return

    have = set(db.scalars(select(StudyPing.hour_index).where(StudyPing.session_id == s.id)).all())
    for index in range(hours_started(s.started_at, t)):
        if index in have:
            continue
        ping_at = s.started_at + timedelta(hours=index) + ping_offset(s.window_minutes, _rng)
        try:
            with db.begin_nested():  # two people loading at once: the second insert just loses
                db.add(StudyPing(session_id=s.id, hour_index=index, ping_at=ping_at,
                                 closes_at=ping_at + timedelta(minutes=s.window_minutes)))
                db.flush()
        except IntegrityError:
            pass

    for ping in db.scalars(select(StudyPing).where(
        StudyPing.session_id == s.id, StudyPing.notified.is_(False), StudyPing.ping_at <= t,
    )).all():
        ping.notified = True
        if t < ping.closes_at:
            for p in people:
                if _studying(p):
                    notify(db, p.user_id, s.org_id, "study_ping", "Study check-in: send a photo now",
                           body=f"You have {s.window_minutes} minutes.", link="/app/study/room")
    db.commit()


def _hours(db: Session, s: GroupStudySession) -> tuple[list[StudyPing], list[Hour], dict[str, list[StudyCheckIn]]]:
    pings = list(db.scalars(select(StudyPing).where(StudyPing.session_id == s.id).order_by(StudyPing.hour_index)).all())
    by_ping: dict[str, list[StudyCheckIn]] = {p.id: [] for p in pings}
    for c in db.scalars(select(StudyCheckIn).where(StudyCheckIn.session_id == s.id).order_by(StudyCheckIn.created_at)):
        by_ping.setdefault(c.ping_id, []).append(c)
    hours = [
        Hour(p.hour_index, s.started_at + timedelta(hours=p.hour_index), p.ping_at, p.closes_at,
             {c.user_id for c in by_ping[p.id]})
        for p in pings
    ]
    return pings, hours, by_ping


def _load_session(db: Session, user: User, session_id: str) -> tuple[GroupStudySession, Membership]:
    s = db.get(GroupStudySession, session_id)
    if s is None:
        raise HTTPException(404, "Study room not found")
    return s, membership(db, user, s.org_id)


def _require_running(s: GroupStudySession) -> None:
    if s.ended_at is not None:
        raise HTTPException(409, "This study session has ended. Start a new one from the Study page.")


def _room(db: Session, s: GroupStudySession, user: User, m: Membership) -> dict:
    t = now()
    is_lead = Role(m.role) in LEADS
    people = _participants(db, s)
    mine = next((p for p in people if p.user_id == user.id), None)
    roles = {r.user_id: Role(r.role).value for r in db.scalars(select(Membership).where(Membership.org_id == s.org_id))}
    # Photos are visible to leads and to pledges studying in this session, nobody else.
    can_see_photos = is_lead or (mine is not None and mine.joined_at is not None)

    pings, hours, by_ping = _hours(db, s)
    hour_rows, open_ping = [], None
    for ping, h in zip(pings, hours):
        status = hour_status(h, s.quorum, t, s.ended_at)
        revealed = status != "waiting"
        hour_rows.append({
            "index": h.index, "start": h.start, "end": h.end, "status": status,
            "ping_at": ping.ping_at if revealed else None,
            "closes_at": ping.closes_at if revealed else None,
            "count": len(h.confirmed),
            "confirmed": [
                {"user_id": c.user_id, "name": c.user.name, "checkin_id": c.id if can_see_photos else None,
                 "at": c.created_at}
                for c in by_ping[ping.id]
            ] if revealed else [],
        })
        if status == "open":
            open_ping = {"id": ping.id, "hour_index": h.index, "closes_at": ping.closes_at,
                         "i_confirmed": user.id in h.confirmed}

    messages = list(db.scalars(
        select(RoomMessage).where(RoomMessage.session_id == s.id).order_by(RoomMessage.created_at.desc()).limit(50)
    ).all())[::-1]
    credit = credited_hours(hours, s.quorum, t, s.ended_at)
    return {
        "id": s.id, "title": s.title, "started_at": s.started_at, "ended_at": s.ended_at,
        "started_by_name": s.starter.name, "quorum": s.quorum, "window_minutes": s.window_minutes,
        "server_now": t,
        "can_end": s.ended_at is None and (is_lead or s.started_by == user.id),
        "me": {
            "role": Role(m.role).value,
            "studying": bool(mine and _studying(mine)),
            "can_join": Role(m.role) == Role.member and s.ended_at is None,
            "hours_counted": credit.get(user.id, 0),
        },
        "people": sorted(
            [{"user_id": p.user_id, "name": p.user.name, "role": roles.get(p.user_id, "member"),
              "studying": _studying(p), "here_now": t - p.last_seen_at <= HERE_NOW}
             for p in people if p.user_id in roles],
            key=lambda p: (not p["studying"], p["role"] != "member", p["name"].lower()),
        ),
        "hours": hour_rows,
        "open_ping": open_ping,
        "messages": [{"id": x.id, "user_id": x.user_id, "name": x.user.name, "body": x.body,
                      "created_at": x.created_at} for x in messages],
    }


def _seen(db: Session, s: GroupStudySession, user: User) -> GroupStudyParticipant:
    p = db.scalar(select(GroupStudyParticipant).where(
        GroupStudyParticipant.session_id == s.id, GroupStudyParticipant.user_id == user.id))
    if p is None:
        p = GroupStudyParticipant(session_id=s.id, user_id=user.id)
        db.add(p)
    p.last_seen_at = now()
    return p


# ---------- routes ----------

@router.get("/orgs/{org_id}/group-study/settings")
def get_settings_route(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id)
    return _settings(db, org_id)


@router.put("/orgs/{org_id}/group-study/settings")
def put_settings(org_id: str, body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, user, org_id, *LEADS)
    members = _member_count(db, org_id)
    if body.quorum > max(members, 1):
        raise HTTPException(422, f"This group has {members} members, so the check-in minimum can be at most {max(members, 1)}.")
    row = db.get(GroupStudySettings, org_id) or GroupStudySettings(org_id=org_id)
    row.quorum, row.window_minutes = body.quorum, body.window_minutes
    db.add(row)
    audit(db, org_id, user, "group_study.settings", f"quorum={body.quorum} window={body.window_minutes}")
    db.commit()
    return _settings(db, org_id)


@router.get("/orgs/{org_id}/group-study/room")
def get_room(org_id: str, watch: bool = True, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The live room. Polled every few seconds by the room page, which marks the caller as here now.

    `watch=false` peeks at the room (for a link elsewhere in the app) without showing up in it.
    """
    m = membership(db, user, org_id)
    s = _active(db, org_id)
    if s:
        _refresh(db, s)
        if s.ended_at is None and watch:
            _seen(db, s, user)
            db.commit()
    s = _active(db, org_id)
    return {"settings": _settings(db, org_id), "session": _room(db, s, user, m) if s else None}


@router.post("/orgs/{org_id}/group-study/room", status_code=201)
def start_room(org_id: str, body: StartIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = membership(db, user, org_id)
    existing = _active(db, org_id)
    if existing:
        _refresh(db, existing)
        if existing.ended_at is None:
            raise HTTPException(409, "A group study session is already running. Join it instead.")
    cfg = _settings(db, org_id)
    s = GroupStudySession(org_id=org_id, title=(body.title.strip() if body else "Group study") or "Group study",
                          started_by=user.id, quorum=cfg["quorum"], window_minutes=cfg["window_minutes"])
    db.add(s)
    db.flush()
    p = _seen(db, s, user)
    if Role(m.role) == Role.member:
        p.joined_at = now()  # a pledge who opens the room is studying in it
    for other in db.scalars(select(Membership).where(Membership.org_id == org_id, Membership.user_id != user.id)):
        notify(db, other.user_id, org_id, "study_room", f"{user.name} started {s.title}",
               body="Join the study room to get credit for this session.", link="/app/study/room")
    db.commit()
    _refresh(db, s)  # schedule hour 0's check-in right away
    return _room(db, s, user, m)


@router.post("/group-study/{session_id}/join")
def join(session_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, m = _load_session(db, user, session_id)
    _refresh(db, s)
    _require_running(s)
    if Role(m.role) != Role.member:
        raise HTTPException(403, "Only pledges join to study. You can still watch and chat in the room.")
    p = _seen(db, s, user)
    if not _studying(p):
        p.joined_at, p.left_at = now(), None
    db.commit()
    return _room(db, s, user, m)


@router.post("/group-study/{session_id}/leave")
def leave(session_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, m = _load_session(db, user, session_id)
    _require_running(s)
    p = _seen(db, s, user)
    if _studying(p):
        p.left_at = now()
    db.commit()
    return _room(db, s, user, m)


@router.post("/group-study/{session_id}/end")
def end(session_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, m = _load_session(db, user, session_id)
    _require_running(s)
    if s.started_by != user.id and Role(m.role) not in LEADS:
        raise HTTPException(403, "Only the person who started this session or a lead can end it.")
    s.ended_at = now()
    for p in _participants(db, s):
        if _studying(p):
            p.left_at = s.ended_at
    audit(db, s.org_id, user, "group_study.end", s.id)
    db.commit()
    return _room(db, s, user, m)


@router.post("/group-study/{session_id}/messages", status_code=201)
def post_message(session_id: str, body: MessageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, m = _load_session(db, user, session_id)
    _require_running(s)
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "Type a message first.")
    _seen(db, s, user)
    db.add(RoomMessage(session_id=s.id, user_id=user.id, body=text))
    db.commit()
    return {"ok": True}


@router.post("/group-study/pings/{ping_id}/checkin", status_code=201)
async def check_in(ping_id: str, photo: UploadFile = File(...), user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    ping = db.get(StudyPing, ping_id)
    if ping is None:
        raise HTTPException(404, "Check-in not found")
    s, m = _load_session(db, user, ping.session_id)
    _require_running(s)
    if Role(m.role) != Role.member:
        raise HTTPException(403, "Only pledges check in.")
    p = db.scalar(select(GroupStudyParticipant).where(
        GroupStudyParticipant.session_id == s.id, GroupStudyParticipant.user_id == user.id))
    if p is None or not _studying(p):
        raise HTTPException(409, "Join the study session before checking in.")
    t = now()
    if t < ping.ping_at:
        raise HTTPException(404, "Check-in not found")  # don't reveal an upcoming ping
    if t >= ping.closes_at:
        raise HTTPException(409, "This check-in closed. Watch for the next one.")
    if db.scalar(select(StudyCheckIn).where(StudyCheckIn.ping_id == ping.id, StudyCheckIn.user_id == user.id)):
        raise HTTPException(409, "You already checked in for this hour.")

    cfg = get_settings()
    data = await photo.read(cfg.max_upload_bytes + 1)
    if len(data) > cfg.max_upload_bytes:
        raise HTTPException(413, f"Photo is larger than {cfg.max_upload_bytes // (1024 * 1024)} MB. Take a smaller one.")
    file_type = next((mime for mime, (sig, _) in PHOTO_TYPES.items() if data.startswith(sig)), None)
    if file_type is None:
        raise HTTPException(415, "Send a JPEG or PNG photo.")
    file_path = f"{s.org_id}/study/{uid()}{PHOTO_TYPES[file_type][1]}"
    target = Path(cfg.upload_dir) / file_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)

    p.last_seen_at = t
    db.add(StudyCheckIn(ping_id=ping.id, session_id=s.id, org_id=s.org_id, user_id=user.id,
                        file_path=file_path, file_type=file_type))
    try:
        db.commit()
    except IntegrityError:  # double-tap: keep the first photo
        db.rollback()
        target.unlink(missing_ok=True)
        raise HTTPException(409, "You already checked in for this hour.")
    return _room(db, s, user, m)


@router.get("/study-checkins/{checkin_id}/photo")
def checkin_photo(checkin_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Private: the pledge who took it, the group's leads, and pledges who studied in that session."""
    c = db.get(StudyCheckIn, checkin_id)
    if c is None:
        raise HTTPException(404, "Photo not found")
    m = membership(db, user, c.org_id)
    if c.user_id != user.id and Role(m.role) not in LEADS:
        p = db.scalar(select(GroupStudyParticipant).where(
            GroupStudyParticipant.session_id == c.session_id, GroupStudyParticipant.user_id == user.id))
        if p is None or p.joined_at is None:
            raise HTTPException(404, "Photo not found")
    path = Path(get_settings().upload_dir) / c.file_path
    if not path.is_file():
        raise HTTPException(404, "Photo not found")
    return FileResponse(path, media_type=c.file_type, headers={"Cache-Control": "private, no-store"})


@router.get("/orgs/{org_id}/group-study/history")
def history(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Past sessions and counted group hours. Leads also get every pledge's total."""
    m = membership(db, user, org_id)
    is_lead = Role(m.role) in LEADS
    active = _active(db, org_id)
    if active:
        _refresh(db, active)
    t = now()
    sessions = db.scalars(
        select(GroupStudySession).where(GroupStudySession.org_id == org_id).order_by(GroupStudySession.started_at.desc())
    ).all()
    totals: dict[str, int] = {}
    rows = []
    for s in sessions:
        _, hours, _ = _hours(db, s)
        credit = credited_hours(hours, s.quorum, t, s.ended_at)
        for u, n in credit.items():
            totals[u] = totals.get(u, 0) + n
        if s.ended_at and len(rows) < 20:
            rows.append({
                "id": s.id, "title": s.title, "started_at": s.started_at, "ended_at": s.ended_at,
                "quorum": s.quorum,
                "hours_counted": sum(hour_status(h, s.quorum, t, s.ended_at) == "counted" for h in hours),
                "hours_total": len(hours),
                "my_hours": credit.get(user.id, 0),
            })
    members = None
    if is_lead:
        people = db.scalars(select(Membership).where(Membership.org_id == org_id, Membership.role == Role.member.value)).all()
        members = sorted(({"user_id": p.user_id, "name": p.user.name, "hours": totals.get(p.user_id, 0)} for p in people),
                         key=lambda r: (-r["hours"], r["name"].lower()))
    return {"my_hours": totals.get(user.id, 0), "sessions": rows, "members": members}
