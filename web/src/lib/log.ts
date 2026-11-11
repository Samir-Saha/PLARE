import type { Bar } from "@/components/ui";

/** Log kinds and plain labels. Mirrors api/app/logbook.py KINDS; keep the two in sync. */
export const LOG_KINDS: [string, string][] = [
  ["late_bp", "Late BP post"],
  ["missed_bp", "Missed BP post"],
  ["missed_bp_checkin", "Missed BP check-in"],
  ["late_gm", "Late GM message"],
  ["wrong_code", "Wrong GM code"],
  ["missed_gm", "Missed GM message"],
  ["overdue_task", "Overdue task"],
  ["study_short", "Short on study hours"],
  ["points_short", "Short on points"],
  ["other", "Other"],
];

/** Row bar color by kind: missed/overdue navy, late mid blue, short/code light blue. Never a "danger" color. */
export function logBar(kind: string): Bar {
  if (kind.startsWith("missed") || kind === "overdue_task" || kind === "other") return "navy";
  if (kind.startsWith("late")) return "mid";
  return "light";
}

/** The pledge class lives in Eastern time; log times always display there. */
export const LOG_TZ = "America/New_York";
