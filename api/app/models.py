from __future__ import annotations

import enum
import secrets
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
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
    evidence: Mapped[str] = mapped_column(String(16), default="any")  # any | text | photo | none
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
