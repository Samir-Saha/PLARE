"""Group study sessions: random hourly photo check-ins and the quorum rule.

Rules, all pure functions (no database):

1. A session is split into hours from its start time. Hour k runs from
   start + k hours to start + (k + 1) hours.
2. Each hour gets one check-in ping at a random moment, far enough inside the
   hour that the response window closes before the hour ends.
3. A member confirms by sending a photo while the ping is open.
4. The hour counts only if at least `quorum` members confirmed AND the session
   was still running when the hour ended. When it counts, each member who
   confirmed gets credit for that hour. Members who missed the ping don't.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta

HOUR = timedelta(hours=1)
# Never ping in the first or last few minutes of an hour.
EDGE = timedelta(minutes=5)


def ping_offset(window_minutes: int, rng: random.Random) -> timedelta:
    """Random offset from the hour's start for its ping, to the second.

    The ping opens no earlier than 5 minutes into the hour and its window closes
    no later than 5 minutes before the hour ends.
    """
    latest = HOUR - EDGE - timedelta(minutes=window_minutes)
    if latest < EDGE:
        raise ValueError("window_minutes is too long to fit inside an hour")
    span = int((latest - EDGE).total_seconds())
    return EDGE + timedelta(seconds=rng.randint(0, span))


def hours_started(started_at: datetime, until: datetime) -> int:
    """How many hours of the session have begun by `until` (hour 0 begins at the start)."""
    if until < started_at:
        return 0
    return int((until - started_at) // HOUR) + 1


@dataclass
class Hour:
    index: int
    start: datetime
    ping_at: datetime
    closes_at: datetime
    confirmed: set[str] = field(default_factory=set)  # member user ids with a photo for this ping

    @property
    def end(self) -> datetime:
        return self.start + HOUR


# waiting:    ping hasn't opened yet (its time stays hidden from clients)
# open:       ping is open; members can send a photo
# short:      ping closed with fewer than `quorum` confirmations; nobody gets the hour
# on_track:   quorum met, hour still running; counts once the hour finishes
# counted:    quorum met and the session ran the full hour; confirmers get credit
# incomplete: the session ended before this hour could finish
STATUSES = ("waiting", "open", "short", "on_track", "counted", "incomplete")


def hour_status(hour: Hour, quorum: int, now: datetime, ended_at: datetime | None) -> str:
    ended_early = ended_at is not None and ended_at < hour.end
    if ended_early and ended_at < hour.closes_at:
        return "incomplete"
    if now < hour.ping_at:
        return "waiting"
    if now < hour.closes_at:
        return "open"
    if len(hour.confirmed) < quorum:
        return "short"
    if ended_early:
        return "incomplete"
    if now < hour.end:
        return "on_track"
    return "counted"


def credited_hours(hours: list[Hour], quorum: int, now: datetime, ended_at: datetime | None) -> dict[str, int]:
    """Hours of credit per member: one for each counted hour they confirmed."""
    credit: dict[str, int] = {}
    for h in hours:
        if hour_status(h, quorum, now, ended_at) == "counted":
            for user_id in h.confirmed:
                credit[user_id] = credit.get(user_id, 0) + 1
    return credit
