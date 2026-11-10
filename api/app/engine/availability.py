"""Group availability engine.

Pure functions, no database or network. Everything is timezone-aware UTC
internally; a tz name is only used to apply "reasonable hours" per local day.

Method: the window is cut into fixed steps (15 min by default). Each step gets
a bitmask of who is free for the whole step. A meeting of N steps starting at
step i can be attended by the AND of masks i..i+N-1. Consecutive start steps
with the same attendee set are merged into one option, then options are ranked
by attendance, then by how much slack the option has, then by how soon it is.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

Interval = tuple[datetime, datetime]
UTC = timezone.utc


def merge(intervals: list[Interval]) -> list[Interval]:
    """Sort and merge overlapping or touching intervals."""
    out: list[Interval] = []
    for start, end in sorted(i for i in intervals if i[1] > i[0]):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def subtract(base: list[Interval], busy: list[Interval]) -> list[Interval]:
    """Return the parts of `base` not covered by `busy`."""
    busy = merge(busy)
    out: list[Interval] = []
    for start, end in merge(base):
        cursor = start
        for b_start, b_end in busy:
            if b_end <= cursor:
                continue
            if b_start >= end:
                break
            if b_start > cursor:
                out.append((cursor, b_start))
            cursor = max(cursor, b_end)
        if cursor < end:
            out.append((cursor, end))
    return out


def clip(intervals: list[Interval], start: datetime, end: datetime) -> list[Interval]:
    return [(max(s, start), min(e, end)) for s, e in intervals if e > start and s < end]


def daily_windows(
    start: datetime, end: datetime, tz: str, day_start_hour: int, day_end_hour: int
) -> list[Interval]:
    """Local [day_start_hour, day_end_hour) on every local day touching the window, in UTC."""
    zone = ZoneInfo(tz)
    out: list[Interval] = []
    day = start.astimezone(zone).date() - timedelta(days=1)
    last = end.astimezone(zone).date()
    while day <= last:
        lo = datetime(day.year, day.month, day.day, tzinfo=zone) + timedelta(hours=day_start_hour)
        hi = datetime(day.year, day.month, day.day, tzinfo=zone) + timedelta(hours=day_end_hour)
        out.append((lo.astimezone(UTC), hi.astimezone(UTC)))
        day += timedelta(days=1)
    return clip(out, start, end)


@dataclass
class SlotOption:
    start: datetime          # earliest possible start
    end: datetime            # latest possible end (start of last fit + duration)
    available: list[str]
    unavailable: list[str]
    total: int
    flexibility_minutes: int = 0  # how far the start can slide and keep the same attendees

    @property
    def count(self) -> int:
        return len(self.available)


@dataclass
class RankResult:
    options: list[SlotOption] = field(default_factory=list)
    no_data: list[str] = field(default_factory=list)  # members who never gave availability
    total: int = 0


def rank_group_slots(
    member_free: dict[str, list[Interval] | None],
    window_start: datetime,
    window_end: datetime,
    duration_minutes: int,
    *,
    step_minutes: int = 15,
    tz: str = "UTC",
    day_start_hour: int = 8,
    day_end_hour: int = 23,
    min_attendance: int = 1,
    limit: int = 10,
) -> RankResult:
    """Rank meeting options for a group.

    `member_free[user]` is that member's free intervals, or None when the
    member has provided no availability at all. A None member is never counted
    as available and is reported in `no_data`.
    """
    if duration_minutes <= 0 or duration_minutes % step_minutes:
        raise ValueError("duration must be a positive multiple of the step")
    if window_end <= window_start:
        raise ValueError("window_end must be after window_start")

    members = sorted(member_free)
    result = RankResult(total=len(members), no_data=[m for m in members if member_free[m] is None])
    step = timedelta(minutes=step_minutes)

    # Align the first slot up to a step boundary.
    epoch = datetime(2000, 1, 1, tzinfo=UTC)
    offset = (window_start - epoch) % step
    first = window_start if not offset else window_start + (step - offset)
    n_slots = int((window_end - first) / step)
    if n_slots <= 0:
        return result

    def span(intervals: list[Interval]) -> list[tuple[int, int]]:
        """Slot index ranges [lo, hi) fully covered by each interval."""
        spans = []
        for s, e in merge(clip(intervals, first, first + n_slots * step)):
            lo = -((first - s) // step)          # ceil((s - first) / step)
            hi = (e - first) // step             # floor((e - first) / step)
            if hi > lo:
                spans.append((max(lo, 0), min(hi, n_slots)))
        return spans

    masks = [0] * n_slots
    for bit, member in enumerate(members):
        free = member_free[member]
        if not free:
            continue
        for lo, hi in span(free):
            for i in range(lo, hi):
                masks[i] |= 1 << bit

    allowed = [False] * n_slots
    for lo, hi in span(daily_windows(window_start, window_end, tz, day_start_hour, day_end_hour)):
        for i in range(lo, hi):
            allowed[i] = True

    need = duration_minutes // step_minutes
    runs: list[tuple[int, int, int]] = []  # (first_start, last_start, mask)
    for i in range(n_slots - need + 1):
        mask = -1
        ok = True
        for j in range(i, i + need):
            if not allowed[j]:
                ok = False
                break
            mask &= masks[j]
        if not ok or mask <= 0 or bin(mask).count("1") < min_attendance:
            continue
        if runs and runs[-1][1] == i - 1 and runs[-1][2] == mask:
            runs[-1] = (runs[-1][0], i, mask)
        else:
            runs.append((i, i, mask))

    options = []
    for lo, hi, mask in runs:
        available = [m for bit, m in enumerate(members) if mask >> bit & 1]
        options.append(
            SlotOption(
                start=first + lo * step,
                end=first + hi * step + timedelta(minutes=duration_minutes),
                available=available,
                unavailable=[m for m in members if m not in available],
                total=len(members),
                flexibility_minutes=(hi - lo) * step_minutes,
            )
        )
    options.sort(key=lambda o: (-o.count, -o.flexibility_minutes, o.start))
    result.options = options[:limit]
    return result
