/** Types and labels for random BP check-ins. Mirrors api/app/routers/bp.py and engine/bp_checkin.py. */

export const BLOCK_KINDS: [string, string][] = [
  ["class", "Class"], ["interview", "Interview"], ["religious", "Religious service"],
  ["work", "Work"], ["medical", "Medical"], ["other", "Other"],
];
export const kindLabel = (k: string) => BLOCK_KINDS.find(([v]) => v === k)?.[1] ?? k;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type BpSettings = {
  enabled: boolean; weekdays: number[]; window_start_minute: number; window_end_minute: number;
  checks_per_day: number; response_minutes: number; class_blocks: boolean; timezone: string;
};
export type BpBlock = {
  id: string; kind: string; kind_label: string; weekday: number | null; day: string | null;
  start_minute: number; end_minute: number; source: "manual" | "calendar"; created_at: string; recent: boolean; note?: string;
};
export type BpBlockIn = { kind: string; weekday?: number | null; day?: string | null; start_minute: number; end_minute: number; note?: string; source?: "manual" | "calendar" };
export type CalendarBusy = { day: string; weekday: number; start_minute: number; end_minute: number; already_blocked: boolean };
export type BpPing = {
  id: string; day: string; ping_at: string; closes_at: string; responded_at: string | null; decline_reason: string; has_photo: boolean;
  response: null | "photo" | "declined" | "missed" | "not_sent";
};
export type BpMine = { settings: BpSettings; open: BpPing | null; today: { planned: number; still_to_come: number; photos: number }; history: BpPing[] };
export type BpToday = {
  day: string; settings: BpSettings;
  members: { user_id: string; name: string; planned: number; photos: number; declined: number; missed: number; open_now: boolean }[];
  recent: (BpPing & { user_id: string; name: string })[];
};
export type BpGroupBlocks = { user_id: string; name: string; blocks: BpBlock[]; weekly_minutes: Record<string, number>; recent: number }[];

export const RESPONSE_LABEL: Record<string, string> = {
  photo: "Photo sent", declined: "Couldn't right now", missed: "Missed", not_sent: "Not sent (server was offline)",
};
