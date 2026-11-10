"""Study-hours planner.

Given one person's free time (their calendar's busy blocks already removed),
pick study blocks that hit a weekly target. Greedy and deterministic:

1. Clip free time to waking hours on each local day.
2. Go round-robin over the days, each pass taking the longest remaining free
   chunk in that day (capped at max_block). This spreads hours across the week
   before stacking a second block on any day.
3. Stop when the target is met or nothing usable remains; report the shortfall.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .availability import Interval, clip, daily_windows, merge, subtract


@dataclass
class StudyPlan:
    blocks: list[Interval] = field(default_factory=list)
    planned_minutes: int = 0
    target_minutes: int = 0

    @property
    def shortfall_minutes(self) -> int:
        return max(0, self.target_minutes - self.planned_minutes)


def plan_study_blocks(
    free: list[Interval],
    window_start: datetime,
    window_end: datetime,
    target_minutes: int,
    *,
    tz: str = "UTC",
    day_start_hour: int = 8,
    day_end_hour: int = 23,
    min_block: int = 45,
    max_block: int = 120,
    max_per_day: int = 240,
    break_minutes: int = 15,
) -> StudyPlan:
    plan = StudyPlan(target_minutes=target_minutes)
    if target_minutes <= 0:
        return plan
    days = daily_windows(window_start, window_end, tz, day_start_hour, day_end_hour)
    free = merge(clip(free, window_start, window_end))

    # Free chunks per local day, and minutes already planned on that day.
    per_day: list[list[Interval]] = []
    for d_start, d_end in days:
        chunks = clip(free, d_start, d_end)
        per_day.append([c for c in chunks if c[1] - c[0] >= timedelta(minutes=min_block)])
    used = [0] * len(days)

    progress = True
    while plan.planned_minutes < target_minutes and progress:
        progress = False
        for i, chunks in enumerate(per_day):
            remaining = target_minutes - plan.planned_minutes
            if remaining <= 0:
                break
            room = min(max_block, max_per_day - used[i])
            if not chunks or room < min_block:
                continue
            # Longest chunk first; ties go to the earlier one.
            chunk = max(chunks, key=lambda c: (c[1] - c[0], -c[0].timestamp()))
            length = min(room, int((chunk[1] - chunk[0]).total_seconds() // 60), max(remaining, min_block))
            if length < min_block:
                continue
            block = (chunk[0], chunk[0] + timedelta(minutes=length))
            plan.blocks.append(block)
            plan.planned_minutes += length
            used[i] += length
            # Remove the block plus a break from this day's free time.
            taken = (block[0], block[1] + timedelta(minutes=break_minutes))
            per_day[i] = [
                c for c in subtract(chunks, [taken]) if c[1] - c[0] >= timedelta(minutes=min_block)
            ]
            progress = True

    plan.blocks.sort()
    return plan
