"""Deadline back-planner and owner suggestions.

Pure functions, no database.

plan_work: earliest-deadline-first scheduling. Tasks are taken in order of due
date; each one is placed into the earliest free time before its deadline, in
blocks of min_block..max_block minutes with a break after each block. Anything
that can't fit before its deadline is reported as at risk, with the minutes
that are missing. Earliest-deadline-first is the classic rule for this: if any
order meets every deadline with the time available, this one does.

suggest_owners: ranks people for one task by spare time before its deadline,
meaning free minutes minus minutes already committed to other open work due by
then. People with no availability at all are listed last and never marked as
fitting.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .availability import Interval, clip, merge, subtract


@dataclass(frozen=True)
class WorkItem:
    id: str
    due: datetime
    minutes: int


@dataclass
class Session:
    task_id: str
    start: datetime
    end: datetime

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


@dataclass
class WorkPlan:
    sessions: list[Session] = field(default_factory=list)
    at_risk: dict[str, int] = field(default_factory=dict)  # task id -> minutes that don't fit


def plan_work(
    free: list[Interval],
    items: list[WorkItem],
    start: datetime,
    *,
    min_block: int = 30,
    max_block: int = 120,
    break_minutes: int = 10,
) -> WorkPlan:
    plan = WorkPlan()
    remaining_free = merge([(max(s, start), e) for s, e in free if e > start])

    for item in sorted(items, key=lambda i: (i.due, i.id)):
        left = item.minutes
        if item.due <= start:
            plan.at_risk[item.id] = left
            continue
        while left > 0:
            placed = False
            for chunk_start, chunk_end in clip(remaining_free, start, item.due):
                length = int((chunk_end - chunk_start).total_seconds() // 60)
                block = min(left, max_block, length)
                # A short task may use a short block; otherwise respect the minimum.
                if block < min(min_block, left):
                    continue
                session = Session(item.id, chunk_start, chunk_start + timedelta(minutes=block))
                plan.sessions.append(session)
                left -= block
                remaining_free = subtract(
                    remaining_free, [(session.start, session.end + timedelta(minutes=break_minutes))]
                )
                placed = True
                break
            if not placed:
                break
        if left > 0:
            plan.at_risk[item.id] = left

    plan.sessions.sort(key=lambda s: s.start)
    return plan


@dataclass
class OwnerOption:
    user: str
    free_minutes: int
    committed_minutes: int
    has_availability: bool

    @property
    def spare_minutes(self) -> int:
        return self.free_minutes - self.committed_minutes


def suggest_owners(
    candidates: dict[str, tuple[list[Interval] | None, int]],
    start: datetime,
    due: datetime,
    estimate_minutes: int,
) -> list[tuple[OwnerOption, bool]]:
    """Rank candidates for a task. Each value is (free intervals or None, committed minutes).

    Returns (option, fits) pairs, best first. `fits` means the person's spare
    time before the deadline covers the estimate.
    """
    options = []
    for user, (free, committed) in candidates.items():
        minutes = 0
        if free:
            minutes = int(sum((e - s).total_seconds() for s, e in clip(merge(free), start, due)) // 60)
        options.append(OwnerOption(user, minutes, committed, free is not None))
    options.sort(key=lambda o: (not o.has_availability, -o.spare_minutes, o.committed_minutes, o.user))
    return [(o, o.has_availability and o.spare_minutes >= estimate_minutes) for o in options]
