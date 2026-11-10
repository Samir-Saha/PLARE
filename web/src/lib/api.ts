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

export type Org = { id: string; name: string; kind: string; role: "admin" | "lead" | "member"; member_label: string; lead_label: string; is_demo: boolean };
export type Me = { id: string; email: string; name: string; timezone: string; is_demo: boolean; calendar_synced_at: string | null; orgs: Org[] };
export type Assignment = { id: string; title: string; description: string; category: string; priority: string; due_at: string | null; evidence: "any" | "text" | "photo" | "none"; status: "not_started" | "in_progress" | "submitted" | "approved" | "needs_revision"; overdue: boolean; feedback: string };
export type SubmissionRow = { id: string; task_title: string; category: string; user_name: string; text: string; has_file: boolean; file_type: string | null; status: string; feedback: string; created_at: string };
export type SlotOption = { start: string; end: string; count: number; total: number; flexibility_minutes?: number; unavailable: string[] };
export type Slots = { total: number; timezone: string; no_data: string[]; options: SlotOption[] };
export type Session = { id: string; started_at: string; ended_at: string | null; paused_seconds: number; elapsed_seconds: number; state: "running" | "paused" | "ended" };
export type Meeting = { id: string; title: string; location: string; start_at: string; end_at: string; status: string; yes: number; no: number; maybe: number; my_response: string | null };
export type Progress = { total: number; approved: number; pending_review: number; overdue: number; members: { user_id: string; name: string; total: number; approved: number; submitted: number; needs_revision: number; overdue: number }[] };
export type LogEntry = { id: string; user_id: string; user_name: string; kind: string; label: string; detail: string; automatic: boolean; created_by: string | null; created_by_name: string | null; created_at: string };
export type LogSummary = { today: number; total: number; members: { user_id: string; name: string; count: number }[] };
