from __future__ import annotations

import enum
import secrets
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, EnumStr, UTCDateTime, now


def uid() -> str:
    return uuid.uuid4().hex


class Role(str, enum.Enum):
    admin = "admin"
    lead = "lead"      # brother / PM / team lead
    member = "member"  # pledge / teammate


class TaskStatus(str, enum.Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    submitted = "submitted"
    approved = "approved"
    needs_revision = "needs_revision"


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    auth_id: Mapped[str | None] = mapped_column(String(64), unique=True)  # Supabase user id
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(String(64), default="America/New_York")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    calendar_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(32), default="pledge_class")
    member_label: Mapped[str] = mapped_column(String(32), default="Pledge")
    lead_label: Mapped[str] = mapped_column(String(32), default="Brother / PM")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("org_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[Role] = mapped_column(EnumStr(16), default=Role.member)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    user: Mapped[User] = relationship()
    org: Mapped[Organization] = relationship()


class Invitation(Base):
    __tablename__ = "invitations"
    code: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: secrets.token_urlsafe(9))
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    role: Mapped[Role] = mapped_column(EnumStr(16), default=Role.member)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(48), default="General")
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)
    estimate_minutes: Mapped[int | None] = mapped_column(Integer)
    # any | text | photo | camera (photo taken live in the app, no file picker) | none
    evidence: Mapped[str] = mapped_column(String(16), default="any")
    claimable: Mapped[bool] = mapped_column(Boolean, default=False)   # open task anyone can claim
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (UniqueConstraint("task_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[TaskStatus] = mapped_column(EnumStr(20), default=TaskStatus.not_started)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now, onupdate=now)
    task: Mapped[Task] = relationship()
    user: Mapped[User] = relationship()


class Submission(Base):
    __tablename__ = "submissions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text, default="")
    file_path: Mapped[str | None] = mapped_column(String(255))   # private storage key, never a public URL
    file_type: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | needs_revision
    feedback: Mapped[str] = mapped_column(Text, default="")
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    assignment: Mapped[Assignment] = relationship()


class AvailabilityRule(Base):
    """Recurring weekly free time a person typed in, in their own timezone."""

    __tablename__ = "availability_rules"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int] = mapped_column(Integer)       # 0 = Monday
    start_minute: Mapped[int] = mapped_column(Integer)  # minutes after local midnight
    end_minute: Mapped[int] = mapped_column(Integer)


class BusyBlock(Base):
    """Busy time imported from Google Calendar free/busy. No event details are stored."""

    __tablename__ = "busy_blocks"
    __table_args__ = (Index("ix_busy_user_start", "user_id", "start_at"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    start_at: Mapped[datetime] = mapped_column(UTCDateTime)
    end_at: Mapped[datetime] = mapped_column(UTCDateTime)


class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(String(255), default="")
    start_at: Mapped[datetime] = mapped_column(UTCDateTime)
    end_at: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(16), default="proposed")  # proposed|confirmed|cancelled|completed
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class MeetingResponse(Base):
    __tablename__ = "meeting_responses"
    __table_args__ = (UniqueConstraint("meeting_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    response: Mapped[str] = mapped_column(String(8))  # yes | no | maybe


class StudySession(Base):
    __tablename__ = "study_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    paused_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    paused_seconds: Mapped[int] = mapped_column(Integer, default=0)

    def elapsed_seconds(self, at: datetime | None = None) -> int:
        """Elapsed study time from timestamps only, so a refresh never loses time."""
        end = self.ended_at or self.paused_at or at or now()
        return max(0, int((end - self.started_at).total_seconds()) - self.paused_seconds)


class GmSettings(Base):
    """A group's good-morning message rules. Days and the due time are in `timezone`."""

    __tablename__ = "gm_settings"
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    due_minute: Mapped[int] = mapped_column(Integer, default=6 * 60)  # minutes after local midnight
    reminder_minutes: Mapped[int] = mapped_column(Integer, default=10)
    timezone: Mapped[str] = mapped_column(String(64), default="America/New_York")


class GmCode(Base):
    """The code word for one day. Only leads can read it; members hear it in person."""

    __tablename__ = "gm_codes"
    __table_args__ = (UniqueConstraint("org_id", "day"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    day: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD in the group's timezone
    code: Mapped[str] = mapped_column(String(64))
    set_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now, onupdate=now)


class GmMessage(Base):
    __tablename__ = "gm_messages"
    __table_args__ = (UniqueConstraint("org_id", "user_id", "day"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[str] = mapped_column(String(10))
    goal: Mapped[str] = mapped_column(Text)
    code_given: Mapped[str] = mapped_column(String(64))
    due_at: Mapped[datetime] = mapped_column(UTCDateTime)  # deadline when it was sent, so later edits don't rewrite history
    submitted_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    user: Mapped[User] = relationship()


class GmReminder(Base):
    """One row per reminder sent, so a person never gets the same day's reminder twice."""

    __tablename__ = "gm_reminders"
    __table_args__ = (UniqueConstraint("org_id", "user_id", "day"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    day: Mapped[str] = mapped_column(String(10))
    sent_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(255), default="")
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class LogEntry(Base):
    """One recorded fact about a pledge's requirement: late, missed, or short.

    Facts only. Nothing here or in the UI attaches a penalty or consequence.
    `source_key` (unique per org) lets automatic producers re-run without duplicating entries.
    """

    __tablename__ = "log_entries"
    __table_args__ = (
        UniqueConstraint("org_id", "source_key", name="uq_log_org_source"),
        Index("ix_log_org_user_created", "org_id", "user_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))  # the pledge
    kind: Mapped[str] = mapped_column(String(32))
    detail: Mapped[str] = mapped_column(Text, default="")
    automatic: Mapped[bool] = mapped_column(Boolean, default=False)
    source_key: Mapped[str | None] = mapped_column(String(128))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class MemberTitle(Base):
    """Optional position shown under a person's name in one group (e.g. "NME", "VP of Finance").

    A separate table, not a column on memberships, because the app has no migrations.
    """

    __tablename__ = "member_titles"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_member_title"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(80))


class Excuse(Base):
    """A pledge's request to be excused from a requirement on one or more days.

    Days are YYYY-MM-DD in the group's local timezone. Only an approved excuse counts;
    other features check it with `app.excuses.is_excused` before flagging someone.
    """

    __tablename__ = "excuses"
    __table_args__ = (Index("ix_excuse_org_user", "org_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))    # see excuses.KINDS
    start_day: Mapped[str] = mapped_column(String(10))
    end_day: Mapped[str] = mapped_column(String(10))
    reason: Mapped[str] = mapped_column(String(16))  # see excuses.REASONS
    note: Mapped[str] = mapped_column(Text, default="")
    file_path: Mapped[str | None] = mapped_column(String(255))  # private storage key, never a public URL
    file_type: Mapped[str | None] = mapped_column(String(64))
    late: Mapped[bool] = mapped_column(Boolean, default=False)  # requested after the first day it covers
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | approved | denied
    reply: Mapped[str] = mapped_column(Text, default="")
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    user: Mapped[User] = relationship(foreign_keys=[user_id])


class GroupStudySettings(Base):
    """Per-group rules for group study sessions. Only leads can change them."""

    __tablename__ = "group_study_settings"
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    quorum: Mapped[int] = mapped_column(Integer, default=7)          # confirmations needed for an hour to count
    window_minutes: Mapped[int] = mapped_column(Integer, default=10)  # how long a check-in ping stays open
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now, onupdate=now)


class GroupStudySession(Base):
    """A shared study room. At most one is running per group at a time.

    `quorum` and `window_minutes` are copied from the group's settings when the
    session starts, so changing settings mid-session never changes its rules.
    """

    __tablename__ = "group_study_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="Group study")
    started_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    quorum: Mapped[int] = mapped_column(Integer)
    window_minutes: Mapped[int] = mapped_column(Integer)
    starter: Mapped[User] = relationship()


class GroupStudyParticipant(Base):
    """Someone in the room. Members join to study; anyone viewing updates `last_seen_at`."""

    __tablename__ = "group_study_participants"
    __table_args__ = (UniqueConstraint("session_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("group_study_sessions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    joined_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # None: only dropped in to watch
    left_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    user: Mapped[User] = relationship()


class StudyPing(Base):
    """The random check-in moment for one hour of a session. Its time stays hidden until it opens."""

    __tablename__ = "study_pings"
    __table_args__ = (UniqueConstraint("session_id", "hour_index"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("group_study_sessions.id", ondelete="CASCADE"), index=True)
    hour_index: Mapped[int] = mapped_column(Integer)
    ping_at: Mapped[datetime] = mapped_column(UTCDateTime)
    closes_at: Mapped[datetime] = mapped_column(UTCDateTime)
    notified: Mapped[bool] = mapped_column(Boolean, default=False)


class StudyCheckIn(Base):
    """A member's photo answering a ping. The file is private storage, never a public URL."""

    __tablename__ = "study_checkins"
    __table_args__ = (UniqueConstraint("ping_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    ping_id: Mapped[str] = mapped_column(ForeignKey("study_pings.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("group_study_sessions.id", ondelete="CASCADE"), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    file_path: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    user: Mapped[User] = relationship()


class RoomMessage(Base):
    __tablename__ = "room_messages"
    __table_args__ = (Index("ix_room_msg_session_created", "session_id", "created_at"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("group_study_sessions.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    user: Mapped[User] = relationship()


class CaptureToken(Base):
    """Issued when someone presses "Take photo" for a camera-only task. One use, short-lived.

    It ties the photo to a moment the server chose, so a camera-only submission has to arrive
    within minutes of the in-app camera being used.
    """

    __tablename__ = "capture_tokens"
    token: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: secrets.token_urlsafe(24))
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class SubmissionCheck(Base):
    """Automatic checks on a submission: in-app camera capture and the AI-writing score.

    A separate table (not new columns on submissions) so existing databases pick it up
    through create_all without a migration.
    """

    __tablename__ = "submission_checks"
    submission_id: Mapped[str] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), primary_key=True)
    captured_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # set only for in-app camera photos
    # skipped (nothing to check) | not_configured | too_short | pending | done | error
    ai_status: Mapped[str] = mapped_column(String(16), default="skipped")
    ai_score: Mapped[float | None] = mapped_column(Float)        # 0..1, the detector's chance the text is AI-written
    ai_label: Mapped[str | None] = mapped_column(String(16))     # detector's class: human | mixed | ai
    ai_error: Mapped[str] = mapped_column(Text, default="")
    ai_checked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class PushSubscription(Base):
    """One browser or installed app that agreed to receive push notifications."""

    __tablename__ = "push_subscriptions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1024), unique=True)  # the push service URL for this device
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    device: Mapped[str] = mapped_column(String(120), default="")      # a label like "iPhone" for the settings list
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class NotificationPrefs(Base):
    """Per-person push settings. Quiet hours are minutes after local midnight; None means off."""

    __tablename__ = "notification_prefs"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    quiet_start_minute: Mapped[int | None] = mapped_column(Integer)
    quiet_end_minute: Mapped[int | None] = mapped_column(Integer)


class PushDelivery(Base):
    """One row per notification the push sender has handled, so nothing is pushed twice."""

    __tablename__ = "push_deliveries"
    notification_id: Mapped[str] = mapped_column(ForeignKey("notifications.id", ondelete="CASCADE"), primary_key=True)
    # sending | sent | failed | quiet (held back by quiet hours) | no_device
    status: Mapped[str] = mapped_column(String(16), default="sending")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class BpSettings(Base):
    """A group's random BP check-in rules. Off until a brother turns it on."""

    __tablename__ = "bp_settings"
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    weekdays: Mapped[str] = mapped_column(String(16), default="0,1,2,3,4")  # 0 = Monday, comma-separated
    window_start_minute: Mapped[int] = mapped_column(Integer, default=9 * 60)
    window_end_minute: Mapped[int] = mapped_column(Integer, default=17 * 60)
    checks_per_day: Mapped[int] = mapped_column(Integer, default=1)
    response_minutes: Mapped[int] = mapped_column(Integer, default=15)
    # True: class counts as a time pledges can't take photos. Brothers can allow check-ins during class.
    class_blocks: Mapped[bool] = mapped_column(Boolean, default=True)
    timezone: Mapped[str] = mapped_column(String(64), default="America/New_York")
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now, onupdate=now)


class BpBlock(Base):
    """A time someone can't take a BP photo. Weekly (weekday) or on one date (day), in their timezone.

    Brothers see the kind and times. The note is private to the person who wrote it.
    """

    __tablename__ = "bp_blocks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # see engine.bp_checkin.BLOCK_KINDS
    weekday: Mapped[int | None] = mapped_column(Integer)
    day: Mapped[str | None] = mapped_column(String(10))  # YYYY-MM-DD
    start_minute: Mapped[int] = mapped_column(Integer)
    end_minute: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(120), default="")
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | calendar
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class BpDayPlan(Base):
    """Marks that a pledge's check-ins for a day were planned, so planning runs once (or again after
    their blocks change)."""

    __tablename__ = "bp_day_plans"
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    planned: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class BpPing(Base):
    """One random check-in. Its time stays hidden until it opens. The pledge answers with a photo
    taken in the app or says they can't right now, with a reason."""

    __tablename__ = "bp_pings"
    __table_args__ = (Index("ix_bp_ping_org_day", "org_id", "day"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[str] = mapped_column(String(10))
    ping_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    closes_at: Mapped[datetime] = mapped_column(UTCDateTime)
    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    response: Mapped[str | None] = mapped_column(String(16))  # photo | declined
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    decline_reason: Mapped[str] = mapped_column(String(300), default="")
    file_path: Mapped[str | None] = mapped_column(String(255))
    file_type: Mapped[str | None] = mapped_column(String(64))
    missed_logged: Mapped[bool] = mapped_column(Boolean, default=False)
    user: Mapped[User] = relationship()
