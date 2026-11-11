"use client";
import { useState } from "react";
import { api, type Assignment, type GmMine, type LogEntry, type Meeting, type Session } from "@/lib/api";
import { LOG_TZ } from "@/lib/log";
import { fmtDuration, fmtMinute, fmtShortDay, fmtTime, fmtToday } from "@/lib/format";
import { useApp } from "@/components/shell";
import { ButtonLink, CheckLink, CheckMark, Empty, ListRow, Notice, Page, Progress, SectionHeader, Skeleton, useLoad } from "@/components/ui";
import { CalendarRail, RailFooterLink, meetingItems, type RailItem } from "./calendar-rail";
import { TasksSection, type OpenTask } from "./tasks";
import { MyPlan } from "@/components/plan";

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
  const gm = useLoad(() => api<GmMine>(`/orgs/${org.id}/gm/me`), [org.id]);
  const [planVersion, setPlanVersion] = useState(0);
  const log = useLoad(() => api<LogEntry[]>(`/orgs/${org.id}/log`), [org.id]);

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
      <header className="mb-7">
        <span aria-hidden className="mb-3 block h-1 w-8 rounded-full bg-gold" />
        <h1 className="font-display text-[34px] font-extrabold sm:text-[44px]">Hey, {me.name.split(" ")[0]}</h1>
        <p className="mt-2 text-base font-medium text-muted">{fmtToday(me.timezone)}</p>
      </header>

      {tasks.error && <div className="mb-4"><Notice>{tasks.error}</Notice></div>}
      {!tasks.data && !tasks.error && <div className="mb-8"><Skeleton rows={1} /></div>}
      {tasks.data && (
        <section aria-label="Requirements progress" className="mb-8 rounded-2xl bg-accent px-5 pb-6 pt-5 text-accent-fg sm:max-w-xl">
          <div className="flex items-center justify-between gap-3 text-[14px] text-on-accent-muted">
            <span>Approved{nextDue ? ` · next due ${fmtShortDay(nextDue.due_at!, me.timezone)}` : ""}</span>
            {overdueCount > 0
              ? <span className="tabular-nums">{overdueCount} overdue</span>
              : daysLeft !== null && <span className="tabular-nums">{daysLeft <= 1 ? "Due within a day" : `${daysLeft} days left`}</span>}
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <p className="font-display">
              <span className="text-[64px] font-extrabold leading-none tabular-nums">{done}</span>
              <span className="ml-2 text-xl text-on-accent-muted">/ {all.length}</span>
            </p>
            {pending > 0 && <span className="mb-1 rounded-full bg-accent-fg/15 px-3.5 py-1.5 text-[14px] font-medium tabular-nums">+{pending} pending</span>}
          </div>
          <div className="mt-5">
            <Progress value={all.length ? (done / all.length) * 100 : 0} label="Requirements approved" track="bg-on-accent-muted/30" fill="bg-gold" className="h-1.5" />
          </div>
        </section>
      )}

      <section aria-labelledby="up-next" className="mb-8">
        <SectionHeader id="up-next" title="Today" />
        <ul className="space-y-2.5">
          {gm.data?.enabled && (
            <ListRow bar={gm.data.today ? (gm.data.today.flags.length ? "danger" : "ok") : now > new Date(gm.data.due_at).getTime() ? "danger" : "navy"}
              end={gm.data.today ? <CheckMark label="GM sent" /> : <ButtonLink href="/app/gm" variant="primary" className="min-h-10 px-5">Send</ButtonLink>}>
              <p className="text-[15px] font-semibold leading-snug">GM message</p>
              <p className="mt-0.5 text-[13px] text-muted tabular-nums">
                {gm.data.today
                  ? `Sent ${fmtTime(gm.data.today.submitted_at, gm.data.timezone)}${gm.data.today.flags.includes("late") ? " · late" : ""}${gm.data.today.flags.includes("wrong_code") ? " · code didn't match" : ""}`
                  : now > new Date(gm.data.due_at).getTime()
                    ? `Was due ${fmtMinute(gm.data.due_minute)}. Send it now; it will be marked late.`
                    : `Due ${fmtMinute(gm.data.due_minute)} · your goal for today and the code word`}
              </p>
            </ListRow>
          )}
          <ListRow bar="mid" end={<ButtonLink href="/app/study" className="min-h-10 px-5">{s?.active ? "Resume" : "Join"}</ButtonLink>}>
            <p className="text-[15px] font-semibold leading-snug">Study hours</p>
            <p className="mt-0.5 text-[14px] text-muted tabular-nums">
              {s ? `${fmtDuration(s.week_seconds)} this week${s.active ? ` · session ${s.active.state === "paused" ? "paused" : "running"}` : ""}` : study.error || "Loading…"}
            </p>
          </ListRow>
          {nextMeeting && (
            <ListRow bar="light" end={nextMeeting.my_response === "yes"
              ? <CheckMark label="You're going" />
              : <CheckLink href="/app/schedule" label={`RSVP for ${nextMeeting.title}`} />}>
              <p className="text-[15px] font-semibold leading-snug">{nextMeeting.title}</p>
              <p className="mt-0.5 text-[14px] text-muted">
                {fmtShortDay(nextMeeting.start_at, me.timezone)}, {fmtTime(nextMeeting.start_at, me.timezone)}
                {nextMeeting.location ? ` · ${nextMeeting.location}` : ""} · {nextMeeting.my_response === "yes" ? "you're going" : "RSVP on Calendar"}
              </p>
            </ListRow>
          )}
        </ul>
      </section>

      <MyPlan orgId={org.id} version={planVersion} />

      <div className="mb-8">
        <TasksSection tasks={tasks} open={open} tz={me.timezone} isLead={false} memberLabel={org.member_label} onChange={() => setPlanVersion((v) => v + 1)} />
      </div>

      <section aria-labelledby="my-log">
        <SectionHeader id="my-log" title="My log" href="/app/log" linkLabel={log.data?.length ? `See all ${log.data.length}` : undefined} />
        {log.error && <Notice>{log.error}</Notice>}
        {!log.data && !log.error && <Skeleton rows={1} />}
        {log.data?.length === 0 && <Empty title="Nothing logged. Keep it that way." />}
        <ul className="space-y-2.5">
          {log.data?.slice(0, 2).map((e) => (
            <ListRow key={e.id} bar={null} end={
              <span className="rounded-md bg-raised px-2.5 py-1 text-xs font-semibold text-muted">{e.automatic ? "Auto" : "Added"}</span>
            }>
              <p className="text-[15px] font-semibold leading-snug">{e.label}</p>
              <p className="mt-0.5 truncate text-[14px] text-muted tabular-nums">{fmtShortDay(e.created_at, LOG_TZ)} · {e.detail}</p>
            </ListRow>
          ))}
        </ul>
      </section>
    </Page>
  );
}
