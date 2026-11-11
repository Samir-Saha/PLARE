"use client";
import { useState } from "react";
import { api, post } from "@/lib/api";
import { fmtDay, fmtDuration, fmtTime } from "@/lib/format";
import { Badge, Button, Card, Notice, useLoad } from "./ui";

type Plan = {
  has_availability: boolean;
  timezone: string;
  sessions: { assignment_id: string; title: string; start: string; end: string; minutes: number }[];
  at_risk: { assignment_id: string; title: string; due_at: string; missing_minutes: number; overdue: boolean }[];
};

/** Work sessions placed before each deadline, earliest deadline first. */
export function MyPlan({ orgId, version }: { orgId: string; version: number }) {
  const plan = useLoad(() => api<Plan>(`/orgs/${orgId}/plan/mine`), [orgId, version]);
  const p = plan.data;
  if (plan.error) return <Notice>{plan.error}</Notice>;
  if (!p) return null;
  if (!p.has_availability)
    return (
      <Card className="mb-5">
        <p className="font-medium">Get a plan for your deadlines</p>
        <p className="text-sm text-muted">Add your free times on the Schedule tab, or connect Google Calendar on the Study tab, and PLARE will schedule your work before each due date.</p>
      </Card>
    );
  if (p.sessions.length === 0 && p.at_risk.length === 0) return null;

  // Group sessions by local day.
  const days = new Map<string, Plan["sessions"]>();
  for (const s of p.sessions) {
    const key = fmtDay(s.start, p.timezone);
    days.set(key, [...(days.get(key) ?? []), s]);
  }

  return (
    <Card className="mb-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Your plan</h2>
        <p className="text-xs text-muted">Scheduled in your free time, earliest deadline first</p>
      </div>
      {p.at_risk.map((r) => (
        <div key={r.assignment_id} className="mb-2">
          {r.overdue ? (
            <Notice>{r.title} is overdue. Submit it as soon as you can.</Notice>
          ) : (
            <Notice tone="warn">
              {r.title}: {fmtDuration(r.missing_minutes * 60)} doesn&apos;t fit before it&apos;s due {fmtDay(r.due_at, p.timezone)}, {fmtTime(r.due_at, p.timezone)}. Free up time or ask for an extension.
            </Notice>
          )}
        </div>
      ))}
      <ol className="space-y-3">
        {[...days.entries()].slice(0, 5).map(([day, sessions]) => (
          <li key={day}>
            <p className="text-xs font-medium text-muted">{day}</p>
            <ul className="mt-1 space-y-1">
              {sessions.map((s) => (
                <li key={s.start} className="flex items-center justify-between gap-3 rounded-lg bg-raised px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{s.title}</span>
                  <span className="shrink-0 tabular-nums text-muted">{fmtTime(s.start, p.timezone)} to {fmtTime(s.end, p.timezone)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Card>
  );
}

type Suggestion = {
  estimate_minutes: number;
  options: { user_id: string; name: string; spare_minutes: number; committed_minutes: number; has_availability: boolean; fits: boolean }[];
};

/** For leads: who has the most spare time before this task's deadline. */
export function SuggestOwner({ taskId, onAssigned }: { taskId: string; onAssigned: () => void }) {
  const suggestion = useLoad(() => api<Suggestion>(`/tasks/${taskId}/suggest-owners`), [taskId]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const data = suggestion.data;

  if (suggestion.error) return <div className="mt-3"><Notice>{suggestion.error}</Notice></div>;
  if (!data) return <p className="mt-3 text-sm text-muted">Finding who has time…</p>;

  async function assign(userId: string) {
    setBusy(userId);
    try {
      await post(`/tasks/${taskId}/assign`, { user_id: userId });
      onAssigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't assign.");
      setBusy("");
    }
  }

  return (
    <div className="mt-3 w-full border-t border-line pt-3">
      <p className="mb-2 text-xs text-muted">Ranked by spare time before the deadline. Needs about {fmtDuration(data.estimate_minutes * 60)}.</p>
      {error && <div className="mb-2"><Notice>{error}</Notice></div>}
      <ul className="space-y-1">
        {data.options.slice(0, 5).map((o) => (
          <li key={o.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="font-medium">{o.name}</span>
              {o.fits ? <Badge tone="ok">Has time</Badge> : <Badge tone={o.has_availability ? "warn" : "neutral"}>{o.has_availability ? "Tight" : "No availability"}</Badge>}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-muted">
                {o.has_availability ? `${fmtDuration(Math.max(0, o.spare_minutes) * 60)} spare` : "—"} · {fmtDuration(o.committed_minutes * 60)} assigned
              </span>
              <Button busy={busy === o.user_id} disabled={!!busy} onClick={() => assign(o.user_id)}>Assign</Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
