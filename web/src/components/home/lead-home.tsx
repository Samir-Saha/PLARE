"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api, type Assignment, type Meeting, type Progress, type Slots, type SubmissionRow } from "@/lib/api";
import type { LogSummary } from "@/lib/api";
import { fmtDay, fmtShortDay, fmtTime, fmtToday } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Badge, Button, Notice, Page, SectionHeader, Skeleton, table, useLoad } from "@/components/ui";
import { IconAlert, IconBars, IconBolt, IconCalendar, IconCheck, IconClock, IconLayers, IconLog, IconPlus, IconTarget, IconUsers } from "@/components/icons";
import { NewTask, TasksSection, type OpenTask } from "./tasks";
import {
  Donut, KpiCard, MiniCalendar, NotificationBell, Panel, PanelEmpty, PanelLink, UpcomingList, dayKey, timeAgo, type CalItem,
} from "./widgets";

type Overview = {
  deadlines: { task_id: string; title: string; category: string; due_at: string; assigned: number; done: number }[];
  overdue: { assignment_id: string; title: string; user_name: string; due_at: string; status: string }[];
  overdue_count: number;
  revisions: { assignment_id: string; title: string; user_name: string; due_at: string | null }[];
  study_seconds_week: number;
  members_studied_week: number;
  member_count: number;
  activity: { kind: "submitted" | "approved" | "needs_revision" | "joined"; at: string; who: string; what: string }[];
};

type Attention = { id: string; kind: "overdue" | "review" | "revision"; title: string; who: string; at: string | null; href?: string };

const pctOf = (n: number, d: number) => (d ? (n / d) * 100 : 0);

/** Lead / admin dashboard. Every number and row comes from the API; empty data gets an empty state, not a fake value. */
export function LeadHome() {
  const { me, org } = useApp();
  const tz = me.timezone;
  const tasks = useLoad(() => api<Assignment[]>(`/orgs/${org.id}/tasks/mine`), [org.id]);
  const open = useLoad(() => api<OpenTask[]>(`/orgs/${org.id}/tasks/open`), [org.id]);
  const queue = useLoad(() => api<SubmissionRow[]>(`/orgs/${org.id}/review`), [org.id]);
  const progress = useLoad(() => api<Progress>(`/orgs/${org.id}/progress`), [org.id]);
  const overview = useLoad(() => api<Overview>(`/orgs/${org.id}/overview`), [org.id]);
  const meetings = useLoad(() => api<Meeting[]>(`/orgs/${org.id}/meetings`), [org.id]);
  const study = useLoad(() => api<Slots>(`/orgs/${org.id}/study/group-times?duration=120`), [org.id]);
  const logSummary = useLoad(() => api<LogSummary>(`/orgs/${org.id}/log/summary`), [org.id]);
  const [creating, setCreating] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());

  const p = progress.data;
  const ov = overview.data;
  const member = org.member_label.toLowerCase();
  const members = p?.members ?? [];
  const onTrack = members.filter((m) => m.overdue === 0).length;
  const today = dayKey(nowMs, tz);
  const reload = () => { tasks.reload(); open.reload(); progress.reload(); overview.reload(); queue.reload(); };

  // Needs attention: overdue work first (oldest due), then submissions waiting (oldest first), then revisions.
  const attention: Attention[] = useMemo(() => [
    ...Object.values((ov?.overdue ?? []).reduce<Record<string, { title: string; due: string; names: string[] }>>((acc, o) => {
      const k = `${o.title}|${o.due_at}`;
      (acc[k] ??= { title: o.title, due: o.due_at, names: [] }).names.push(o.user_name);
      return acc;
    }, {})).map((g) => ({
      id: `o-${g.title}-${g.due}`, kind: "overdue" as const, title: g.title, at: g.due, href: "/app/log",
      who: g.names.length === 1 ? g.names[0] : `${g.names.length} ${member}s: ${g.names.slice(0, 2).join(", ")}${g.names.length > 2 ? ` +${g.names.length - 2}` : ""}`,
    })),
    ...(queue.data ?? []).map((s) => ({ id: `s-${s.id}`, kind: "review" as const, title: s.task_title, who: s.user_name, at: s.created_at, href: "/app/review" })),
    ...(ov?.revisions ?? []).map((r) => ({ id: `r-${r.assignment_id}`, kind: "revision" as const, title: r.title, who: r.user_name, at: r.due_at })),
  ], [ov, queue.data, member]);

  const calItems: CalItem[] = useMemo(() => [
    ...(meetings.data ?? []).filter((m) => m.status !== "cancelled" && new Date(m.end_at).getTime() > nowMs)
      .map((m) => ({ id: `m-${m.id}`, at: m.start_at, title: m.title, kind: "Meeting", href: "/app/schedule" })),
    ...(ov?.deadlines ?? []).map((d) => ({ id: `d-${d.task_id}`, at: d.due_at, title: d.title, kind: `Due · ${d.done}/${d.assigned} in` })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [meetings.data, ov, nowMs]);
  const upcoming = (day ? calItems.filter((i) => dayKey(i.at, tz) === day) : calItems).slice(0, 5);
  const dueToday = (ov?.deadlines ?? []).filter((d) => dayKey(d.due_at, tz) === today).length;

  const best = study.data?.options[0];
  const alternatives = (study.data?.options.length ?? 0) - 1;
  const hours = ov ? ov.study_seconds_week / 3600 : 0;
  const remaining = p ? Math.max(0, p.total - p.approved - p.pending_review) : 0;
  const mostBehind = [...members]
    .sort((a, b) => b.overdue - a.overdue || pctOf(a.approved, a.total) - pctOf(b.approved, b.total))
    .slice(0, 3);
  const logCounts = new Map((logSummary.data?.members ?? []).map((r) => [r.user_id, r.count]));
  const hasOwnTasks = (tasks.data?.length ?? 0) > 0 || (open.data?.length ?? 0) > 0;

  return (
    <Page
      railLabel={`${org.member_label} calendar`}
      rail={
        <div className="space-y-6">
          <section aria-labelledby="cal-title">
            <h2 id="cal-title" className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold"><IconCalendar width={18} height={18} className="text-accent-2" />{org.member_label} calendar</h2>
            <MiniCalendar tz={tz} items={calItems} selected={day} onSelect={setDay} />
          </section>
          <section aria-labelledby="up-title">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="up-title" className="font-display text-[15px] font-semibold">{day ? fmtShortDay(`${day}T12:00:00Z`, "UTC") : "Upcoming"}</h2>
              {day && <button type="button" onClick={() => setDay(null)} className="text-xs font-medium text-accent-2 hover:underline">Show all</button>}
            </div>
            {!meetings.data && !overview.data ? <Skeleton rows={2} /> : (
              <UpcomingList items={upcoming} tz={tz} empty={day ? "Nothing on this day." : "No meetings or deadlines coming up. Propose a meeting from the Calendar tab."} />
            )}
          </section>
          <Link href="/app/schedule" className="flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-accent px-3 text-[13px] font-semibold text-accent transition-colors duration-150 hover:bg-accent-soft">
            <IconUsers width={17} height={17} />Find a time everyone&apos;s free
          </Link>
        </div>
      }
    >
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-bold leading-tight tracking-[-0.01em] sm:text-[30px]">Hello, {me.name.split(" ")[0]}</h1>
          <p className="mt-1 truncate text-sm text-muted">{fmtToday(tz)} · {org.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <Button variant="primary" className="min-h-11 px-4" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
            {creating ? "Close" : <><IconPlus width={17} height={17} />New task</>}
          </Button>
        </div>
      </header>
      {creating && <NewTask orgId={org.id} memberLabel={org.member_label} onDone={() => { setCreating(false); reload(); }} />}

      {progress.error && <div className="mb-4"><Notice>{progress.error}</Notice></div>}
      {!p ? <div className="mb-5"><Skeleton rows={1} /></div> : (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard tone="navy" icon={IconCheck} label="Approvals" value={`${p.approved} / ${p.total}`}
            sub={p.total ? `${Math.round(pctOf(p.approved, p.total))}% approved` : "No tasks assigned yet"}
            pct={p.total ? pctOf(p.approved, p.total) : undefined} href="/app/review" />
          <KpiCard tone="mid" icon={IconLayers} label="Review queue" value={p.pending_review} unit="pending"
            sub={queue.data?.[0] ? `Oldest ${fmtShortDay(queue.data[0].created_at, tz)}` : "Nothing waiting"}
            pct={p.approved + p.pending_review ? pctOf(p.approved, p.approved + p.pending_review) : undefined} href="/app/review" />
          <KpiCard tone="light" icon={IconTarget} label="On track" value={members.length ? `${onTrack} / ${members.length}` : "—"}
            sub={members.length ? `${member}s on track · ${p.overdue} overdue` : `No ${member}s with tasks yet`}
            pct={members.length ? pctOf(onTrack, members.length) : undefined} />
          <KpiCard tone="plain" icon={IconBars} label="Study hours" value={ov ? hours.toFixed(hours >= 10 ? 0 : 1) : "–"} unit="hrs"
            sub={ov ? (ov.member_count ? `${ov.members_studied_week} of ${ov.member_count} studied this week` : `No ${member}s yet`) : "Loading…"}
            pct={ov?.member_count ? pctOf(ov.members_studied_week, ov.member_count) : undefined} href="/app/study" />
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Panel title="Needs attention" icon={IconLayers} action={attention.length > 5 ? <PanelLink href="/app/review">View all</PanelLink> : undefined}>
          {(overview.error || queue.error) && <Notice>{overview.error || queue.error}</Notice>}
          {!ov || !queue.data ? <Skeleton rows={3} /> : attention.length === 0 ? (
            <PanelEmpty icon={IconCheck} title="You're caught up">New submissions and overdue work show up here first.</PanelEmpty>
          ) : (
            <ul className="-mx-1 divide-y divide-line">
              {attention.slice(0, 5).map((a) => (
                <li key={a.id} className="flex min-h-14 items-center gap-3 px-1 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{a.title}</p>
                    <p className="truncate text-xs text-muted">
                      {a.who}{a.at ? ` · ${a.kind === "review" ? "sent" : "due"} ${fmtShortDay(a.at, tz)}` : ""}
                    </p>
                  </div>
                  <Badge tone={a.kind === "overdue" ? "danger" : a.kind === "revision" ? "warn" : "accent"}>
                    {a.kind === "overdue" ? "Overdue" : a.kind === "revision" ? "Revising" : "To review"}
                  </Badge>
                  {a.href && (
                    <Link href={a.href} className="hidden min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold transition-colors duration-150 hover:bg-raised sm:inline-flex">
                      {a.kind === "review" ? "Review" : "Log"}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Today at a glance" icon={IconCalendar}>
          {!p || !ov ? <Skeleton rows={2} /> : (
            <dl className="grid grid-cols-2 gap-2.5">
              {[
                { label: "Due today", value: dueToday, icon: IconClock },
                { label: "Overdue", value: ov.overdue_count, icon: IconAlert, danger: ov.overdue_count > 0 },
                { label: "To review", value: p.pending_review, icon: IconLayers },
                { label: "New log entries", value: logSummary.data?.today ?? 0, icon: IconLog, danger: (logSummary.data?.today ?? 0) > 0 },
              ].map((t) => (
                <div key={t.label} className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-3">
                  <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg bg-surface ${t.danger ? "text-danger" : "text-accent-2"}`}><t.icon width={16} height={16} /></span>
                  <div className="min-w-0">
                    <dd className={`font-display text-lg font-bold leading-tight tabular-nums ${t.danger ? "text-danger" : ""}`}>{t.value}</dd>
                    <dt className="truncate text-xs text-muted">{t.label}</dt>
                  </div>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>

      {/* Best shared study window, from the real group availability engine. */}
      <section aria-label="Best group study time" className="mb-5 flex flex-wrap items-center gap-4 rounded-xl bg-accent px-5 py-4 text-accent-fg">
        <span aria-hidden className="hidden size-11 shrink-0 place-items-center rounded-lg bg-accent-fg/10 sm:grid"><IconBars width={22} height={22} /></span>
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-accent-muted">Best group study time</p>
          {study.error ? <p className="mt-1 text-sm">{study.error}</p> : !study.data ? <p className="mt-1 text-sm text-on-accent-muted">Finding a time…</p> : best ? (
            <>
              <p className="mt-0.5 font-display text-lg font-semibold">{fmtDay(best.start, study.data.timezone)}, {fmtTime(best.start, study.data.timezone)}</p>
              <p className="text-[13px] text-on-accent-muted tabular-nums">
                {best.count} of {best.total} {member}s free · 2 hours{alternatives > 0 ? ` · ${alternatives} other ${alternatives === 1 ? "option" : "options"}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="mt-0.5 font-display text-lg font-semibold">No shared 2-hour window yet</p>
              <p className="text-[13px] text-on-accent-muted">Ask {member}s to mark their free time or connect Google Calendar.</p>
            </>
          )}
        </div>
        <Link href={best ? "/app/study" : "/app/schedule"} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-fg px-4 text-sm font-semibold text-accent transition-opacity duration-150 hover:opacity-90">
          <IconCalendar width={16} height={16} />{best ? "Plan study session" : "Add availability"}
        </Link>
      </section>

      <div className="mb-8 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title="Task progress" icon={IconBars}>
          {!p ? <Skeleton rows={2} /> : p.total === 0 ? (
            <PanelEmpty icon={IconBars} title="No tasks yet">Create a task and every {member} gets it. Progress shows up here.</PanelEmpty>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <Donut center={`${Math.round(pctOf(p.approved, p.total))}%`} sub={`${p.approved} / ${p.total} tasks`}
                segments={[{ value: p.approved, className: "stroke-accent" }, { value: p.pending_review, className: "stroke-accent-2" }, { value: remaining, className: "stroke-accent-3" }]} />
              <ul className="min-w-0 flex-1 basis-40 space-y-2 text-sm">
                {[["Approved", p.approved, "bg-accent"], ["In review", p.pending_review, "bg-accent-2"], ["Remaining", remaining, "bg-accent-3"]].map(([l, v, c]) => (
                  <li key={l as string} className="flex items-center gap-2.5 border-b border-line pb-2 last:border-b-0">
                    <span aria-hidden className={`size-2.5 rounded-full ${c}`} />
                    <span className="flex-1 text-muted">{l}</span>
                    <span className="font-semibold tabular-nums">{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Recent activity" icon={IconBolt} action={ov?.activity.length ? <PanelLink href="/app/log">View log</PanelLink> : undefined}>
          {!ov ? <Skeleton rows={3} /> : ov.activity.length === 0 ? (
            <PanelEmpty icon={IconBolt} title="No activity yet">Submissions, reviews, and new members show up here.</PanelEmpty>
          ) : (
            <ul className="-mx-1 divide-y divide-line">
              {ov.activity.slice(0, 5).map((e, i) => (
                <li key={i} className="flex items-start gap-3 px-1 py-2.5">
                  <span aria-hidden className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${e.kind === "needs_revision" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"}`}>
                    {e.kind === "joined" ? <IconUsers width={14} height={14} /> : e.kind === "submitted" ? <IconLayers width={14} height={14} /> : <IconCheck width={14} height={14} />}
                  </span>
                  <p className="min-w-0 flex-1 text-[13px] leading-snug">
                    <span className="font-semibold">{e.who}</span>{" "}
                    {e.kind === "submitted" ? "submitted" : e.kind === "approved" ? "approved" : e.kind === "needs_revision" ? "requested changes on" : `joined ${org.name}`}{" "}
                    {e.what && <span className="text-muted">{e.what}</span>}
                  </p>
                  <span className="shrink-0 text-xs text-muted tabular-nums">{timeAgo(e.at, nowMs)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {p && members.length > 0 && (
        <section aria-labelledby="most-behind" className="mb-8">
          <SectionHeader id="most-behind" title="Most behind" href="/app/review" linkLabel="Full class" />
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th scope="col" className={table.th}>{org.member_label}</th>
                  <th scope="col" className={table.th}>Approved</th>
                  <th scope="col" className={table.th}>In review</th>
                  <th scope="col" className={table.th}>Revise</th>
                  <th scope="col" className={table.th}>Overdue</th>
                  {logSummary.data && <th scope="col" className={table.th}>Log</th>}
                </tr>
              </thead>
              <tbody className={table.body}>
                {mostBehind.map((m) => (
                  <tr key={m.user_id}>
                    <th scope="row" className={`${table.cell} text-left font-semibold`}>{m.name}</th>
                    <td className={table.cell}>{m.approved} / {m.total}</td>
                    <td className={table.cell}>{m.submitted}</td>
                    <td className={`${table.cell} ${m.needs_revision ? "text-warn" : ""}`}>{m.needs_revision}</td>
                    <td className={`${table.cell} ${m.overdue ? "text-danger" : ""}`}>{m.overdue}</td>
                    {logSummary.data && <td className={table.cell}><Link href="/app/log" className="underline-offset-2 hover:underline">{logCounts.get(m.user_id) ?? 0}</Link></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasOwnTasks && <TasksSection tasks={tasks} open={open} tz={tz} isLead memberLabel={org.member_label} onChange={reload} />}
    </Page>
  );
}
