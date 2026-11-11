import { supabase } from "./supabase";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const DEMO_KEY = "plare.demo_user";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const demoUser = {
  get: () => (typeof window === "undefined" ? null : localStorage.getItem(DEMO_KEY)),
  set: (email: string) => localStorage.setItem(DEMO_KEY, email),
  clear: () => localStorage.removeItem(DEMO_KEY),
};

async function authHeaders(): Promise<Record<string, string>> {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return { Authorization: `Bearer ${data.session.access_token}` };
  }
  const demo = demoUser.get();
  return demo ? { "X-Demo-User": demo } : {};
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(await authHeaders()) };
  if (init.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    let message = `Something went wrong (${res.status}).`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = "Check the form and try again.";
    } catch {}
    throw new ApiError(res.status, message);
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** Private files need the auth header, so they're fetched as blobs, never linked directly. */
export async function fileUrl(path: string): Promise<string> {
  return URL.createObjectURL(await (await request(path)).blob());
}

export async function signOut() {
  demoUser.clear();
  if (supabase) await supabase.auth.signOut();
}

export type Org = { id: string; name: string; kind: string; role: "admin" | "lead" | "member"; member_label: string; lead_label: string; is_demo: boolean; title?: string | null };
export type Me = { id: string; email: string; name: string; timezone: string; is_demo: boolean; calendar_synced_at: string | null; orgs: Org[] };
export type Evidence = "any" | "text" | "photo" | "camera" | "none";
/** Automatic checks on a submission. The AI score is a hint for the reviewer, never a verdict. */
export type SubmissionCheck = {
  captured_in_app: boolean; captured_at: string | null;
  ai_status: "skipped" | "not_configured" | "too_short" | "pending" | "done" | "error";
  ai_score: number | null; ai_label: string | null; ai_error: string; ai_checked_at: string | null;
};
export type Assignment = { id: string; title: string; description: string; category: string; priority: string; due_at: string | null; evidence: Evidence; status: "not_started" | "in_progress" | "submitted" | "approved" | "needs_revision"; overdue: boolean; feedback: string; ai_check_on: boolean; check: SubmissionCheck | null };
export type SubmissionRow = SubmissionCheck & { id: string; task_title: string; category: string; user_name: string; text: string; has_file: boolean; file_type: string | null; status: string; feedback: string; created_at: string; evidence: Evidence };
export type SlotOption = { start: string; end: string; count: number; total: number; flexibility_minutes?: number; unavailable: string[] };
export type Slots = { total: number; timezone: string; no_data: string[]; options: SlotOption[] };
export type Session = { id: string; started_at: string; ended_at: string | null; paused_seconds: number; elapsed_seconds: number; state: "running" | "paused" | "ended" };
export type Meeting = { id: string; title: string; location: string; start_at: string; end_at: string; status: string; yes: number; no: number; maybe: number; my_response: string | null };
export type Progress = { total: number; approved: number; pending_review: number; overdue: number; members: { user_id: string; name: string; total: number; approved: number; submitted: number; needs_revision: number; overdue: number }[] };
export type GmSettings = { enabled: boolean; due_minute: number; reminder_minutes: number; timezone: string; day: string; due_at: string; reminder_at: string };
export type GmFlag = "late" | "wrong_code";
export type GmMessage = { id: string; user_id: string; user_name: string; day: string; goal: string; submitted_at: string; due_at: string; late: boolean; code_status: "ok" | "wrong" | "unset"; flags: GmFlag[]; code_given?: string };
export type GmMine = GmSettings & { today: GmMessage | null; history: GmMessage[]; code: string | null };
export type GmInbox = GmSettings & {
  today: string; code: string | null; past_due: boolean; messages: GmMessage[]; not_sent: { user_id: string; name: string }[];
  counts: { members: number; sent: number; on_time: number; flagged: number; missing: number };
};
export type AppNotification = { id: string; category: string; title: string; body: string; link: string; read: boolean; created_at: string };
export type LogEntry = { id: string; user_id: string; user_name: string; kind: string; label: string; detail: string; automatic: boolean; created_by: string | null; created_by_name: string | null; created_at: string };
export type LogSummary = { today: number; total: number; members: { user_id: string; name: string; count: number }[] };
export type Excuse = {
  id: string; user_id: string; user_name: string; kind: string; kind_label: string; start_day: string; end_day: string;
  reason: string; reason_label: string; note: string; has_file: boolean; file_type: string | null; late: boolean;
  status: "pending" | "approved" | "denied"; reply: string; reviewer_name: string | null; created_at: string; reviewed_at: string | null;
};
export type ExcuseSummary = { pending: number; members: { user_id: string; name: string; pending: number; approved: number; denied: number }[] };

export type HourStatus = "waiting" | "open" | "short" | "on_track" | "counted" | "incomplete";
export type RoomHour = { index: number; start: string; end: string; status: HourStatus; ping_at: string | null; closes_at: string | null; count: number; confirmed: { user_id: string; name: string; checkin_id: string | null; at: string }[] };
export type RoomPerson = { user_id: string; name: string; role: "admin" | "lead" | "member"; studying: boolean; here_now: boolean };
export type RoomMessage = { id: string; user_id: string; name: string; body: string; created_at: string };
export type StudyRoom = {
  id: string; title: string; started_at: string; ended_at: string | null; started_by_name: string; quorum: number; window_minutes: number; server_now: string; can_end: boolean;
  me: { role: "admin" | "lead" | "member"; studying: boolean; can_join: boolean; hours_counted: number };
  people: RoomPerson[]; hours: RoomHour[]; open_ping: { id: string; hour_index: number; closes_at: string; i_confirmed: boolean } | null; messages: RoomMessage[];
};
export type GroupStudySettings = { quorum: number; window_minutes: number; member_count: number; customized: boolean };
export type GroupStudyHistory = {
  my_hours: number;
  sessions: { id: string; title: string; started_at: string; ended_at: string; quorum: number; hours_counted: number; hours_total: number; my_hours: number }[];
  members: { user_id: string; name: string; hours: number }[] | null;
};
