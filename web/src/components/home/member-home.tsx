"use client";
import { useState } from "react";
import { api, type Assignment, type Meeting, type Session } from "@/lib/api";
import { fmtDuration, fmtShortDay, fmtTime, fmtToday } from "@/lib/format";
import { useApp } from "@/components/shell";
import { ButtonLink, CheckLink, CheckMark, ListRow, Notice, Page, Progress, SectionHeader, Skeleton, useLoad } from "@/components/ui";
import { CalendarRail, RailFooterLink, meetingItems, type RailItem } from "./calendar-rail";
import { TasksSection, type OpenTask } from "./tasks";

type StudyOverview = { active: Session | null; week_seconds: number; total_seconds: number; history: Session[] };

const DAY_MS = 864e5;

/** Member / pledge home: the pledge-home layout, filled from existing endpoints only. */
export function MemberHome() {
  const { me, org } = useApp();
  const [now] = useState(() => Date.now());
  const tasks = useLoad(() => api<Assignment[]>(`/orgs/${org.id}/tasks/mine`), [org.id]);
  const open = useLoad(() => api<OpenTask[]>(`/orgs/${org.id}/tasks/open`), [org.id]);
  const meetings = useLoad(() => api<Meeting[]>(`/orgs/${org.id}/meetings`), [org.id]);
  const study = useLoad(() => api<StudyOverview>(`/orgs/${org.id}/study`), [org.id]);

  const all = tasks.data ?? [];
  const done = all.filter((t) => t.status === "approved").length;
  const pending = all.filter((t) => t.status === "submitted").length;
  const todo = all.filter((t) => ["not_started", "in_progress", "needs_revision"].includes(t.status));
  const overdueCount = todo.filter((t) => t.overdue).length;
  const nextDue = todo.filter((t) => t.due_at && new Date(t.due_at).getTime() > now).sort((a, b) => a.due_at!.localeCompare(b.due_at!))[0];
  const daysLeft = nextDue ? Math.ceil((new Date(nextDue.due_at!).getTime() - now) / DAY_MS) : null;
  const nextMeeting = (meetings.data ?? []).filter((m) => new Date(m.end_at).getTime() > now).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const s = study.data;

  const deadlines: RailItem[] = todo
    .filter((t) => t.due_at && new Date(t.due_at).getTime() > now)
    .map((t) => ({ id: t.id, at: t.due_at!, kind: "Deadline", title: t.title, tone: "light" }));

  return (
    <Page
      railOnMobile={false}
      railLabel="Calendar"
      rail={
        <CalendarRail title="Calendar" tz={me.timezone} items={[...meetingItems(meetings.data ?? []), ...deadlines]}
          loading={!meetings.data && !meetings.error} error={meetings.error}
          footer={<RailFooterLink href="/app/schedule">Mark when you&apos;re free</RailFooterLink>} />
      }
    >
      {/* TODO(notifications): the mockup's bell with an unread dot needs the notification center, which isn't built yet. */}
      <header className="mb-6">
        <p className="text-[15px] text-muted">{fmtToday(me.timezone)}</p>
        <h1 className="mt-0.5 font-display text-[30px] font-bold leading-tight tracking-[-0.01em] sm:text-[32px]">Hey, {me.name.split(" ")[0]}</h1>
      </header>

      {tasks.error && <div className="mb-4"><Notice>{tasks.error}</Notice></div>}
      {!tasks.data && !tasks.error && <div className="mb-8"><Skeleton rows={1} /></div>}
      {tasks.data && (
        <section aria-label="Requirements progress" className="mb-8 rounded-[22px] bg-accent px-5 pb-6 pt-5 text-accent-fg sm:max-w-xl">
          <div className="flex items-center justify-between gap-3 text-[13px] text-on-accent-muted">
            <span>Approved{nextDue ? ` · next due ${fmtShortDay(nextDue.due_at!, me.timezone)}` : ""}</span>
            {overdueCount > 0
              ? <span className="tabular-nums">{overdueCount} overdue</span>
              : daysLeft !== null && <span className="tabular-nums">{daysLeft <= 1 ? "Due within a day" : `${daysLeft} days left`}</span>}
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <p className="font-display">
              <span className="text-[44px] font-bold leading-none">{done}</span>
              <span className="ml-2 text-xl text-on-accent-muted">/ {all.length}</span>
            </p>
            {pending > 0 && <span className="mb-1 rounded-full bg-accent-fg/15 px-3.5 py-1.5 text-[13px] font-medium tabular-nums">+{pending} pending</span>}
          </div>
          <div className="mt-5">
            <Progress value={all.length ? (done / all.length) * 100 : 0} label="Requirements approved" track="bg-on-accent-muted/30" fill="bg-accent-fg" className="h-1.5" />
          </div>
        </section>
      )}

      <section aria-labelledby="up-next" className="mb-8">
        <SectionHeader id="up-next" title="Today" />
        <ul className="space-y-2.5">
          <ListRow bar="mid" end={<ButtonLink href="/app/study" className="min-h-10 px-5">{s?.active ? "Resume" : "Join"}</ButtonLink>}>
            <p className="text-[15px] font-semibold leading-snug">Study hours</p>
            <p className="mt-0.5 text-[13px] text-muted tabular-nums">
              {s ? `${fmtDuration(s.week_seconds)} this week${s.active ? ` · session ${s.active.state === "paused" ? "paused" : "running"}` : ""}` : study.error || "Loading…"}
            </p>
          </ListRow>
          {nextMeeting && (
            <ListRow bar="light" end={nextMeeting.my_response === "yes"
              ? <CheckMark label="You're going" />
              : <CheckLink href="/app/schedule" label={`RSVP for ${nextMeeting.title}`} />}>
              <p className="text-[15px] font-semibold leading-snug">{nextMeeting.title}</p>
              <p className="mt-0.5 text-[13px] text-muted">
                {fmtShortDay(nextMeeting.start_at, me.timezone)}, {fmtTime(nextMeeting.start_at, me.timezone)}
                {nextMeeting.location ? ` · ${nextMeeting.location}` : ""} · {nextMeeting.my_response === "yes" ? "you're going" : "RSVP on Calendar"}
              </p>
            </ListRow>
          )}
        </ul>
      </section>

      <div className="mb-8">
        <TasksSection tasks={tasks} open={open} tz={me.timezone} isLead={false} memberLabel={org.member_label} />
      </div>

      <section aria-labelledby="fry-log">
        <SectionHeader id="fry-log" title="My fry log" />
        {/* TODO(fry-log): no fry log data or API yet. Same row styling as the mockup, with an honest empty state instead of made-up entries. */}
        <ul>
          <ListRow bar={null} end={<span className="rounded-md bg-raised px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Soon</span>}>
            <p className="text-[15px] font-semibold leading-snug">Nothing logged</p>
            <p className="mt-0.5 text-[13px] text-muted">Late or missed requirements will show up here once the fry log is built.</p>
          </ListRow>
        </ul>
      </section>
    </Page>
  );
}
