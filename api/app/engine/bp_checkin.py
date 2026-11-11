"""Random BP check-ins: when to ask a pledge for a photo in business professional.

Pure functions, no database. The rules:

1. Brothers pick the days and the local window (for example weekdays, 9 AM to 5 PM), how
   many check-ins per day, and how long each stays open.
2. Each pledge lists times they can't take a photo: class, an interview, a religious
   service, work, a medical appointment. Weekly or on one date.
3. A check-in never opens during a blocked time, or within BUFFER of one, and it closes
   before the next blocked time starts. Brothers decide whether class counts as blocked.
4. Within the allowed time, each check-in starts at a uniformly random second, at least
   MIN_GAP apart from the others that day.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

BUFFER = timedelta(minutes=10)
MIN_GAP = timedelta(minutes=60)
# Don't open a check-in in the next few minutes, so planning never lands in the past.
LEAD_TIME = timedelta(minutes=5)

BLOCK_KINDS = {
    "class": "Class",
    "interview": "Interview",
    "religious": "Religious service",
    "work": "Work",
    "medical": "Medical",
    "other": "Other",
}


@dataclass(frozen=True)
class BlockRule:
    """A time someone can't take a photo, in their local time. Weekly (weekday) or one date (day)."""

    kind: str
    start_minute: int
    end_minute: int
    weekday: int | None = None  # 0 = Monday
    day: date | None = None


@dataclass(frozen=True)
class Span:
    start: datetime
    end: datetime


def _local(day: date, minute: int, tz: str) -> datetime:
    """UTC moment for `minute` minutes after local midnight on `day` (24:00 is the next midnight)."""
    if minute >= 1440:
        day, minute = day + timedelta(days=1), minute - 1440
    return datetime.combine(day, time(minute // 60, minute % 60), tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)


def window(day: date, tz: str, start_minute: int, end_minute: int) -> Span:
    return Span(_local(day, start_minute, tz), _local(day, end_minute, tz))


def blocks_on(day: date, tz: str, rules: list[BlockRule], class_blocks: bool = True) -> list[Span]:
    """The blocked spans on one local day, in UTC, merged and sorted. Class is skipped if brothers allow it."""
    spans = []
    for r in rules:
        if r.kind == "class" and not class_blocks:
            continue
        if (r.weekday is not None and r.weekday == day.weekday()) or (r.day is not None and r.day == day):
            spans.append(Span(_local(day, r.start_minute, tz), _local(day, r.end_minute, tz)))
    return merge(spans)


def merge(spans: list[Span]) -> list[Span]:
    out: list[Span] = []
    for s in sorted(spans, key=lambda s: s.start):
        if out and s.start <= out[-1].end:
            out[-1] = Span(out[-1].start, max(out[-1].end, s.end))
        else:
            out.append(s)
    return out


def allowed_starts(win: Span, blocked: list[Span], open_for: timedelta, earliest: datetime | None = None) -> list[Span]:
    """Ranges of start times where a check-in fits: inside the window, never in or near a block,
    and closing before the next block (and the window's end)."""
    start = max(win.start, earliest) if earliest else win.start
    cursor, out = start, []
    padded = [Span(b.start - BUFFER, b.end + BUFFER) for b in blocked]
    for b in merge(padded) + [Span(win.end, win.end)]:
        gap_end = min(b.start, win.end)
        if gap_end - cursor >= open_for:
            out.append(Span(cursor, gap_end - open_for))
        cursor = max(cursor, b.end)
        if cursor >= win.end:
            break
    return out


def pick_times(ranges: list[Span], count: int, rng: random.Random, min_gap: timedelta = MIN_GAP,
               attempts: int = 200) -> list[datetime]:
    """Up to `count` random start times from `ranges`, at least `min_gap` apart, to the second.

    Each second of allowed time is equally likely. Returns fewer if they don't fit.
    """
    total = sum(int((r.end - r.start).total_seconds()) + 1 for r in ranges)
    if total <= 0:
        return []
    chosen: list[datetime] = []
    for _ in range(attempts):
        if len(chosen) == count:
            break
        k = rng.randrange(total)
        for r in ranges:
            length = int((r.end - r.start).total_seconds()) + 1
            if k < length:
                t = r.start + timedelta(seconds=k)
                break
            k -= length
        if all(abs(t - c) >= min_gap for c in chosen):
            chosen.append(t)
    return sorted(chosen)


def plan(day: date, tz: str, win_start: int, win_end: int, rules: list[BlockRule], class_blocks: bool,
         count: int, open_for: timedelta, rng: random.Random, at: datetime) -> list[datetime]:
    """Everything above in one call: the start times of a pledge's check-ins for `day`."""
    if at.tzinfo is None:
        raise ValueError("naive datetime rejected")
    ranges = allowed_starts(window(day, tz, win_start, win_end), blocks_on(day, tz, rules, class_blocks),
                            open_for, earliest=at + LEAD_TIME)
    return pick_times(ranges, count, rng)


def blocked_minutes_per_week(rules: list[BlockRule]) -> dict[str, int]:
    """Weekly blocked minutes by kind, from weekly rules only (one-off dates are listed separately)."""
    out: dict[str, int] = {}
    for r in rules:
        if r.weekday is not None:
            out[r.kind] = out.get(r.kind, 0) + (r.end_minute - r.start_minute)
    return out
