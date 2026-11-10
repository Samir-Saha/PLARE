"use client";
import { useEffect, useState } from "react";
import { api, post, type Session, type Slots } from "@/lib/api";
import { fmtClock, fmtDay, fmtDuration, fmtTime } from "@/lib/format";
import { clearGoogleToken, googleToken, signInWithGoogle, supabase } from "@/lib/supabase";
import { useApp } from "@/components/shell";
import { SlotList } from "@/components/slots";
import { Button, Card, Empty, ListRow, Notice, PageHeader, Skeleton, SummaryCard, SummaryRow, useLoad } from "@/components/ui";

type Overview = { active: Session | null; week_seconds: number; total_seconds: number; history: Session[] };
type Plan = { has_availability: boolean; timezone: string; blocks: { start: string; end: string; minutes: number }[]; planned_minutes: number; target_minutes: number; shortfall_minutes: number };

export default function Study() {
  const { me, org, refresh } = useApp();
  const [target, setTarget] = useState(10);
  const [version, setVersion] = useState(0);
  const overview = useLoad(() => api<Overview>(`/orgs/${org.id}/study`), [org.id]);
  const plan = useLoad(() => api<Plan>(`/orgs/${org.id}/study/plan?target_hours=${target}`), [org.id, target, version]);
  const group = useLoad(() => api<Slots>(`/orgs/${org.id}/study/group-times?duration=120`), [org.id, version]);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  const active = overview.data?.active ?? null;
  // The clock is derived from server timestamps, so a refresh or a sleeping tab never loses time.
  useEffect(() => {
    if (active?.state !== "running") return;
    const first = setTimeout(() => setNowMs(Date.now()), 0);
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active?.state]);
  const elapsed = !active ? 0 : active.state === "running" && nowMs
    ? Math.max(0, Math.floor((nowMs - new Date(active.started_at).getTime()) / 1000) - active.paused_seconds)
    : active.elapsed_seconds;

  const act = (action: string) =>
    post(`/orgs/${org.id}/study/${action}`).then(overview.reload, (e) => setMsg({ tone: "danger", text: e.message }));

  async function syncCalendar() {
    const token = googleToken();
    if (!token) {
      // Ask Google for free/busy access only, then come back here and import.
      await signInWithGoogle({ calendar: true, next: "/app/study?sync=1" }).catch((e) => setMsg({ tone: "danger", text: e.message }));
      return;
    }
    setSyncing(true);
    try {
      const r = await post<{ busy_blocks: number }>("/calendar/sync", { provider_token: token, days: 14 });
      setMsg({ tone: "ok", text: `Calendar imported: ${r.busy_blocks} busy blocks over the next 14 days. Only busy times are stored, never event details.` });
      await refresh();
      setVersion((v) => v + 1);
    } catch (e) {
      clearGoogleToken();
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Couldn't import your calendar." });
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sync") !== "1") return;
    window.history.replaceState(null, "", "/app/study");
    // The Google token lands a moment after the redirect.
    const id = setTimeout(() => googleToken() && syncCalendar(), 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnect() {
    await api("/calendar", { method: "DELETE" });
    clearGoogleToken();
    await refresh();
    setVersion((v) => v + 1);
    setMsg({ tone: "ok", text: "Calendar disconnected and imported busy times deleted." });
  }

  return (
    <>
      <PageHeader title="Study hours" hint={overview.data ? `${fmtDuration(overview.data.week_seconds)} in the last 7 days · ${fmtDuration(overview.data.total_seconds)} total` : undefined} />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}

      {overview.data && (
        <SummaryRow>
          <SummaryCard tone="navy" title="Last 7 days" stat={`${fmtDuration(overview.data.week_seconds)} of a ${target} hour goal`}
            pct={(overview.data.week_seconds / (target * 3600)) * 100} />
          {plan.data?.has_availability ? (
            <SummaryCard tone="mid" title="Planned this week" stat={`${fmtDuration(plan.data.planned_minutes * 60)} of ${fmtDuration(plan.data.target_minutes * 60)} fits your free time`}
              pct={plan.data.target_minutes ? (plan.data.planned_minutes / plan.data.target_minutes) * 100 : 0} />
          ) : (
            <SummaryCard tone="mid" title="Planned this week" stat="Add availability to get a plan" />
          )}
          <SummaryCard tone="light" title="All time" stat={`${fmtDuration(overview.data.total_seconds)} logged`} />
        </SummaryRow>
      )}

      <Card className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{active ? (active.state === "paused" ? "Paused" : "Studying now") : "No session running"}</p>
          <p className="font-display text-5xl font-semibold tabular-nums tracking-[-0.02em]" aria-live="off">{fmtClock(elapsed)}</p>
        </div>
        <div className="flex gap-2">
          {!active && <Button variant="primary" onClick={() => act("start")}>Start studying</Button>}
          {active?.state === "running" && <Button onClick={() => act("pause")}>Pause</Button>}
          {active?.state === "paused" && <Button variant="primary" onClick={() => act("resume")}>Resume</Button>}
          {active && <Button variant="danger" onClick={() => act("end")}>End session</Button>}
        </div>
      </Card>

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.01em]">Your best study times this week</h2>
            <p className="text-sm text-muted">
              {me.calendar_synced_at ? `Built around your Google Calendar (imported ${fmtDay(me.calendar_synced_at, me.timezone)}).` : "Connect Google Calendar and PLARE plans around your classes and commitments."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted">Goal{" "}
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))} className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm text-text">
                {[5, 8, 10, 12, 15, 20].map((h) => <option key={h} value={h}>{h} hours</option>)}
              </select>
            </label>
            {supabase && !me.is_demo && <Button variant={me.calendar_synced_at ? "secondary" : "primary"} busy={syncing} onClick={syncCalendar}>{me.calendar_synced_at ? "Re-import calendar" : "Connect Google Calendar"}</Button>}
            {me.calendar_synced_at && <Button variant="ghost" onClick={disconnect}>Disconnect</Button>}
          </div>
        </div>
        {!supabase && <p className="mb-3 text-sm text-muted">Google Calendar import needs Google sign-in, which isn&apos;t configured on this deployment. Plans use the weekly availability from the Schedule tab.</p>}
        {plan.error && <Notice>{plan.error}</Notice>}
        {!plan.data && !plan.error && <Skeleton />}
        {plan.data && !plan.data.has_availability && (
          <Empty title="No availability to plan around yet">Connect Google Calendar, or mark your free times on the Schedule tab.</Empty>
        )}
        {plan.data?.has_availability && (
          <>
            {plan.data.shortfall_minutes > 0 && (
              <div className="mb-3"><Notice tone="warn">Your free time only fits {fmtDuration(plan.data.planned_minutes * 60)} of the {fmtDuration(plan.data.target_minutes * 60)} goal this week.</Notice></div>
            )}
            <ol className="grid gap-2 sm:grid-cols-2">
              {plan.data.blocks.map((b) => (
                <ListRow key={b.start} bar={b.minutes >= 90 ? "navy" : b.minutes >= 60 ? "mid" : "light"} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{fmtDay(b.start, plan.data!.timezone)}</p>
                    <p className="text-sm text-muted tabular-nums">{fmtTime(b.start, plan.data!.timezone)} to {fmtTime(b.end, plan.data!.timezone)}</p>
                  </div>
                  <span className="font-display text-lg font-semibold tabular-nums">{fmtDuration(b.minutes * 60)}</span>
                </ListRow>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-xl font-semibold tracking-[-0.01em]">Study together</h2>
        <p className="mb-3 text-sm text-muted">Two-hour windows when the most {org.member_label.toLowerCase()}s are free.</p>
        {group.error && <Notice>{group.error}</Notice>}
        {!group.data && !group.error && <Skeleton rows={2} />}
        {group.data && <SlotList slots={group.data} />}
      </section>

      {overview.data && overview.data.history.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-semibold tracking-[-0.01em]">Recent sessions</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
            {overview.data.history.slice(0, 8).map((s) => (
              <li key={s.id} className="flex justify-between gap-3 px-4 py-3 text-sm tabular-nums">
                <span>{fmtDay(s.started_at, me.timezone)}, {fmtTime(s.started_at, me.timezone)}</span>
                <span className="font-medium tabular-nums">{fmtDuration(s.elapsed_seconds)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
