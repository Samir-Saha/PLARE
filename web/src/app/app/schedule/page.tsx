"use client";
import { useEffect, useRef, useState } from "react";
import { api, post, type SlotOption, type Slots } from "@/lib/api";
import { fmtDay, fmtRange, fmtTime } from "@/lib/format";
import { useApp } from "@/components/shell";
import { SlotList } from "@/components/slots";
import { Button, Card, Empty, Notice, PageHeader, Skeleton, useLoad } from "@/components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FIRST = 8 * 60; // grid covers 8:00 AM to midnight in 30-minute cells
const ROWS = 32;
type Rule = { weekday: number; start_minute: number; end_minute: number };
type Meeting = { id: string; title: string; location: string; start_at: string; end_at: string; status: string; yes: number; no: number; maybe: number; my_response: string | null };

const label = (row: number) => {
  const m = FIRST + row * 30;
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}${m % 60 ? ":30" : ""} ${h < 12 ? "AM" : "PM"}`;
};

function toCells(rules: Rule[]): Set<string> {
  const cells = new Set<string>();
  for (const r of rules)
    for (let row = 0; row < ROWS; row++) {
      const m = FIRST + row * 30;
      if (m >= r.start_minute && m + 30 <= r.end_minute) cells.add(`${r.weekday}-${row}`);
    }
  return cells;
}

function toRules(cells: Set<string>): Rule[] {
  const rules: Rule[] = [];
  for (let d = 0; d < 7; d++) {
    let start: number | null = null;
    for (let row = 0; row <= ROWS; row++) {
      const on = row < ROWS && cells.has(`${d}-${row}`);
      if (on && start === null) start = row;
      if (!on && start !== null) {
        rules.push({ weekday: d, start_minute: FIRST + start * 30, end_minute: FIRST + row * 30 });
        start = null;
      }
    }
  }
  return rules;
}

export default function Schedule() {
  const { me, org, isLead } = useApp();
  const [cells, setCells] = useState<Set<string> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const paint = useRef<boolean | null>(null);
  const [duration, setDuration] = useState(60);
  const [version, setVersion] = useState(0);
  const slots = useLoad(() => api<Slots>(`/orgs/${org.id}/best-times?duration=${duration}&days=7`), [org.id, duration, version]);
  const meetings = useLoad(() => api<Meeting[]>(`/orgs/${org.id}/meetings`), [org.id]);

  useEffect(() => {
    api<{ rules: Rule[] }>("/availability/me").then((a) => setCells(toCells(a.rules)), (e) => setMsg({ tone: "danger", text: e.message }));
    const stop = () => (paint.current = null);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const apply = (key: string, on: boolean) => {
    setCells((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    setDirty(true);
    setMsg(null);
  };

  async function save() {
    if (!cells) return;
    setSaving(true);
    try {
      await api("/availability/me", { method: "PUT", body: JSON.stringify({ rules: toRules(cells) }) });
      setDirty(false);
      setMsg({ tone: "ok", text: "Availability saved. Best times are updated." });
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  async function propose(o: SlotOption) {
    const title = window.prompt("What's the meeting called?", "Group meeting");
    if (!title?.trim()) return;
    const end = new Date(new Date(o.start).getTime() + duration * 60000).toISOString();
    try {
      await post(`/orgs/${org.id}/meetings`, { title: title.trim(), start_at: o.start, end_at: end });
      meetings.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Couldn't propose the meeting." });
    }
  }

  // Upcoming meetings for the right rail, grouped by day in the viewer's timezone.
  const byDay: [string, Meeting[]][] = [];
  for (const m of meetings.data ?? []) {
    const day = fmtDay(m.start_at, me.timezone);
    const last = byDay[byDay.length - 1];
    if (last && last[0] === day) last[1].push(m);
    else byDay.push([day, [m]]);
  }

  return (
    <>
      <PageHeader title="Schedule" hint={`Times shown in ${me.timezone.replace("_", " ")}`} />

      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="lg:col-start-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-[-0.01em]">Best times for {org.name}</h2>
          <label className="text-sm text-muted">
            Length{" "}
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm text-text">
              {[30, 60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>
          </label>
        </div>
        {slots.error && <Notice>{slots.error}</Notice>}
        {!slots.data && !slots.error && <Skeleton />}
        {slots.data && <SlotList slots={slots.data} action={isLead ? (o) => <Button onClick={() => propose(o)}>Propose meeting</Button> : undefined} />}
      </section>

      <aside aria-labelledby="meetings-heading" className="rounded-[18px] bg-raised p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <h2 id="meetings-heading" className="mb-4 text-xl font-semibold tracking-[-0.01em]">Meetings</h2>
        {meetings.error && <Notice>{meetings.error}</Notice>}
        {!meetings.data && !meetings.error && <Skeleton rows={2} />}
        {meetings.data?.length === 0 && <Empty title="No meetings yet">{isLead ? "Pick a time and propose one." : "Proposed meetings show up here for you to RSVP."}</Empty>}
        <div className="space-y-6">
          {byDay.map(([day, list]) => (
            <section key={day}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{day}</h3>
              <ul className="space-y-4">
                {list.map((m) => (
                  <li key={m.id} className="flex gap-3">
                    <time dateTime={m.start_at} className="w-16 shrink-0 pt-4 text-sm font-semibold tabular-nums">{fmtTime(m.start_at, me.timezone)}</time>
                    <div className={`min-w-0 flex-1 border-l-[3px] pl-3 ${m.status === "confirmed" ? "border-accent" : "border-accent-3"}`}>
                      <p className="text-xs font-medium capitalize text-muted">{m.status} meeting</p>
                      <p className="font-medium leading-snug">{m.title}</p>
                      <p className="mt-0.5 text-xs text-muted tabular-nums">
                        <span className="sr-only">{fmtRange(m.start_at, m.end_at, me.timezone)}. </span>
                        Until {fmtTime(m.end_at, me.timezone)} · {m.yes} going, {m.maybe} maybe, {m.no} can&apos;t
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={`RSVP for ${m.title}`}>
                        {(["yes", "maybe", "no"] as const).map((r) => (
                          <Button key={r} variant={m.my_response === r ? "primary" : "secondary"} aria-pressed={m.my_response === r}
                            className="min-h-9! px-3! text-xs"
                            onClick={() => post(`/meetings/${m.id}/rsvp`, { response: r }).then(meetings.reload)}>
                            {{ yes: "Going", maybe: "Maybe", no: "Can't" }[r]}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>

      <section className="min-w-0 lg:col-start-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.01em]">Your weekly availability</h2>
            <p className="text-sm text-muted">Tap or drag over the times you&apos;re usually free. Calendar busy time is removed automatically.</p>
          </div>
          <Button variant="primary" onClick={save} busy={saving} disabled={!dirty}>Save availability</Button>
        </div>
        {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        {!cells ? <Skeleton /> : (
          <Card className="overflow-x-auto p-2 sm:p-3">
            <div className="grid min-w-[520px] select-none grid-cols-[3.5rem_repeat(7,1fr)] gap-px text-xs">
              <div />
              {DAYS.map((d) => <div key={d} className="pb-1 text-center font-medium text-muted">{d}</div>)}
              {Array.from({ length: ROWS }, (_, row) => (
                <div key={row} className="contents">
                  <div className="pr-1 text-right text-[10px] leading-5 text-muted">{row % 2 === 0 ? label(row) : ""}</div>
                  {DAYS.map((d, day) => {
                    const key = `${day}-${row}`;
                    const on = cells.has(key);
                    return (
                      <button key={key} type="button" aria-pressed={on} aria-label={`${d} ${label(row)}`}
                        onPointerDown={() => { paint.current = !on; apply(key, !on); }}
                        onPointerEnter={() => paint.current !== null && apply(key, paint.current)}
                        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), apply(key, !on))}
                        className={`h-5 rounded-[3px] ${on ? "bg-accent" : "bg-raised hover:bg-accent-soft"}`} />
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>
      </div>
    </>
  );
}
