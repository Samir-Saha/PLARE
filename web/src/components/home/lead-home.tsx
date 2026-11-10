"use client";
import Link from "next/link";
import { useState } from "react";
import { api, type Assignment, type Meeting, type Progress, type Slots, type SubmissionRow } from "@/lib/api";
import type { LogSummary } from "@/lib/api";
import { fmtDay, fmtShortDay, fmtTime, fmtToday } from "@/lib/format";
import { useApp } from "@/components/shell";
import {
  Button, CheckLink, Empty, ListRow, Notice, Page, PageHeader, SectionHeader, Skeleton, StatTile, SummaryCard, SummaryRow, barFor, table, useLoad,
} from "@/components/ui";
import { CalendarRail, RailFooterLink, meetingItems, type RailItem } from "./calendar-rail";
import { NewTask, TasksSection, type OpenTask } from "./tasks";

const pctOf = (n: number, d: number) => (d ? (n / d) * 100 : 0);

/** Lead / admin home: the NME dashboard layout, filled from existing endpoints only. */
export function LeadHome() {
  const { me, org } = useApp();
  const tasks = useLoad(() => api<Assignment[]>(`/orgs/${org.id}/tasks/mine`), [org.id]);
  const open = useLoad(() => api<OpenTask[]>(`/orgs/${org.id}/tasks/open`), [org.id]);
  const queue = useLoad(() => api<SubmissionRow[]>(`/orgs/${org.id}/review`), [org.id]);
  const progress = useLoad(() => api<Progress>(`/orgs/${org.id}/progress`), [org.id]);
  const meetings = useLoad(() => api<Meeting[]>(`/orgs/${org.id}/meetings`), [org.id]);
  const study = useLoad(() => api<Slots>(`/orgs/${org.id}/study/group-times?duration=120`), [org.id]);
  const logSummary = useLoad(() => api<LogSummary>(`/orgs/${org.id}/log/summary`), [org.id]);
  const logCounts = new Map((logSummary.data?.members ?? []).map((r) => [r.user_id, r.count]));
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());

  const p = progress.data;
  const member = org.member_label.toLowerCase();
  const members = p?.members ?? [];
  const onTrack = members.filter((m) => m.overdue === 0);
  const behind = members.filter((m) => m.overdue > 0);
  const submitters = [...new Set((queue.data ?? []).map((s) => s.user_name))];
  const reviewed = p ? pctOf(p.approved, p.approved + p.pending_review) : 0;
  // Most behind: most overdue first, then lowest share approved.
  const mostBehind = [...members]
    .sort((a, b) => b.overdue - a.overdue || pctOf(a.approved, a.total) - pctOf(b.approved, b.total))
    .slice(0, 3);
  const avgApproved = members.length ? members.reduce((t, m) => t + pctOf(m.approved, m.total), 0) / members.length : 0;
  const best = study.data?.options[0];

  const deadlines: RailItem[] = (tasks.data ?? [])
    .filter((t) => t.due_at && t.status !== "approved" && new Date(t.due_at).getTime() > now)
    .map((t) => ({ id: t.id, at: t.due_at!, kind: "Deadline", title: t.title, tone: "light" }));
  // Suggested group study windows from the existing study planner, shown like the mockup's study sessions.
  const studyItems: RailItem[] = (study.data?.options ?? []).slice(0, 3).map((o) => ({
    id: `study-${o.start}`, at: o.start, kind: `Study · ${o.count}/${o.total} free`, title: "Suggested group study", tone: "mid",
  }));
  const hasOwnTasks = (tasks.data?.length ?? 0) > 0 || (open.data?.length ?? 0) > 0;

  return (
    <Page
      railLabel={`${org.member_label} calendar`}
      rail={
        <CalendarRail
          title={`${org.member_label} calendar`}
          tz={me.timezone}
          items={[...meetingItems(meetings.data ?? []), ...deadlines, ...studyItems]}
          loading={!meetings.data && !meetings.error}
          error={meetings.error}
          emptyText="No meetings yet. Propose one from the Calendar tab."
          footer={<RailFooterLink href="/app/schedule">Find a time everyone&apos;s free</RailFooterLink>}
        />
      }
    >
      {/* TODO(search): the mockup's search button has no search feature behind it yet. */}
      <PageHeader
        title={`Hello, ${me.name.split(" ")[0]}`}
        hint={`${fmtToday(me.timezone)}${p ? ` · ${p.pending_review} waiting for review` : ""}`}
        action={<Button variant="primary" className="min-h-11 px-5" onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New task"}</Button>}
      />
      {creating && <NewTask orgId={org.id} memberLabel={org.member_label} onDone={() => { setCreating(false); tasks.reload(); open.reload(); progress.reload(); }} />}

      {progress.error && <div className="mb-4"><Notice>{progress.error}</Notice></div>}
      {!p && !progress.error && <div className="mb-9"><Skeleton rows={1} /></div>}
      {p && (
        <SummaryRow>
          <SummaryCard tone="navy" title="Approvals" people={members.map((m) => m.name)} meta={`${members.length} ${member}s`}
            stat={`${p.approved} of ${p.total} approved · ${behind.length} ${member}s behind`}
            pct={pctOf(p.approved, p.total)} foot={`${Math.round(pctOf(p.approved, p.total))}% approved`} />
          <SummaryCard tone="mid" title="Review queue" people={submitters} meta="Right now"
            stat={`${p.pending_review} waiting${queue.data?.[0] ? ` · oldest ${fmtShortDay(queue.data[0].created_at, me.timezone)}` : ""}`}
            pct={reviewed} foot={`${Math.round(reviewed)}% of submissions reviewed`} />
          <SummaryCard tone="light" title="On track" people={onTrack.map((m) => m.name)} meta={fmtShortDay(new Date(now).toISOString(), me.timezone)}
            stat={`${onTrack.length} on track · ${behind.length} behind · ${p.overdue} overdue`}
            pct={pctOf(onTrack.length, members.length)} foot={`${Math.round(pctOf(onTrack.length, members.length))}% on track`} />
        </SummaryRow>
      )}

      <div className="mb-9 grid gap-x-7 gap-y-9 lg:grid-cols-2">
        <section aria-labelledby="needs-review">
          <SectionHeader id="needs-review" title="Needs review" href="/app/review" linkLabel={queue.data?.length ? `See all ${queue.data.length}` : undefined} />
          {queue.error && <Notice>{queue.error}</Notice>}
          {!queue.data && !queue.error && <Skeleton />}
          {queue.data?.length === 0 && <Empty title="You're caught up">New submissions land here the moment they come in.</Empty>}
          <ul className="space-y-2.5">
            {queue.data?.slice(0, 3).map((s) => (
              <ListRow key={s.id} bar={barFor(s.category)} end={<CheckLink href="/app/review" label={`Review ${s.user_name}'s ${s.task_title}`} />}>
                <p className="truncate text-sm font-semibold">{s.task_title}</p>
                <p className="mt-0.5 truncate text-xs text-muted">{s.user_name} · {s.category} · {fmtShortDay(s.created_at, me.timezone)}</p>
              </ListRow>
            ))}
          </ul>
        </section>

        <section aria-labelledby="today">
          <SectionHeader id="today" title="Today" />
          {p ? (
            <dl className="mb-3.5 grid grid-cols-2 gap-3">
              <StatTile label="Approved" value={`${p.approved}/${p.total}`} />
              <StatTile label="Overdue" value={p.overdue} tone={p.overdue ? "danger" : undefined} />
              <StatTile label="To review" value={p.pending_review} />
              <StatTile label="New log entries today" value={logSummary.data?.today ?? "–"} tone={logSummary.data?.today ? "danger" : undefined} />
            </dl>
          ) : <div className="mb-3.5"><Skeleton rows={1} /></div>}

          {/* The mockup's "live study room" has no backing feature; this card shows the best real group study window instead. */}
          <div className="rounded-[18px] bg-accent px-5 py-5 text-accent-fg">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-on-accent-muted">
              <span aria-hidden className="size-2 rounded-full bg-accent-3" />Best group study time
            </p>
            {study.error ? <p className="mt-2 text-sm text-on-accent-muted">{study.error}</p> : !study.data ? (
              <p className="mt-2 text-sm text-on-accent-muted">Loading…</p>
            ) : best ? (
              <>
                <p className="mt-2 font-display text-lg font-semibold">{fmtDay(best.start, study.data.timezone)}, {fmtTime(best.start, study.data.timezone)}</p>
                <p className="mt-0.5 text-[13px] text-on-accent-muted tabular-nums">{best.count} of {best.total} {member}s free · 2 hours</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-on-accent-muted">No shared 2-hour window yet. Ask people to add availability.</p>
            )}
            <Link href="/app/study" className="mt-4 inline-flex min-h-11 items-center rounded-[10px] bg-accent-fg px-5 text-sm font-semibold text-accent">Plan study</Link>
          </div>
        </section>
      </div>

      {p && members.length > 0 && (
        <section aria-labelledby="most-behind" className="mb-9">
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
                    <td className={`${table.cell} ${pctOf(m.approved, m.total) < avgApproved ? "text-danger" : ""}`}>{m.approved} / {m.total}</td>
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

      {hasOwnTasks && <TasksSection tasks={tasks} open={open} tz={me.timezone} isLead memberLabel={org.member_label} />}
    </Page>
  );
}
