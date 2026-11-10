"use client";
import { useEffect, useRef, useState } from "react";
import { api, post, type Meeting, type SlotOption, type Slots } from "@/lib/api";
import { fmtRange, fmtTime } from "@/lib/format";
import { useApp } from "@/components/shell";
import { SlotList } from "@/components/slots";
import { Button, Card, Dialog, Notice, Page, PageHeader, Skeleton, field, useLoad, useToast } from "@/components/ui";
import { CalendarRail, meetingItems } from "@/components/home/calendar-rail";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FIRST = 8 * 60; // grid covers 8:00 AM to midnight in 30-minute cells
const ROWS = 32;
type Rule = { weekday: number; start_minute: number; end_minute: number };

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
  const toast = useToast();
  const [proposing, setProposing] = useState<SlotOption | null>(null);
  const [meetingTitle, setMeetingTitle] = useState("Group meeting");
  const [proposeError, setProposeError] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);
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

  async function propose(e: React.FormEvent) {
    e.preventDefault();
    if (!proposing) return;
    if (!meetingTitle.trim()) return setProposeError("Give the meeting a name.");
    const end = new Date(new Date(proposing.start).getTime() + duration * 60000).toISOString();
    setProposeBusy(true);
    try {
      await post(`/orgs/${org.id}/meetings`, { title: meetingTitle.trim(), start_at: proposing.start, end_at: end });
      meetings.reload();
      toast(`Proposed ${meetingTitle.trim()}. Everyone can RSVP now.`);
      setProposing(null);
    } catch (err) {
      setProposeError(err instanceof Error ? err.message : "Couldn't propose the meeting.");
    } finally {
      setProposeBusy(false);
    }
  }

  async function rsvp(id: string, response: "yes" | "maybe" | "no") {
    try {
      await post(`/meetings/${id}/rsvp`, { response });
      meetings.reload();
      toast(response === "yes" ? "You're going" : response === "maybe" ? "Marked as maybe" : "Marked as can't make it");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save your RSVP.", "danger");
    }
  }

  return (
    <Page
      railLabel="Meetings"
      rail={
        <CalendarRail
          title="Meetings"
          tz={me.timezone}
          loading={!meetings.data && !meetings.error}
          error={meetings.error}
          emptyText={isLead ? "No meetings yet. Pick a time and propose one." : "Proposed meetings show up here for you to RSVP."}
          items={meetingItems(meetings.data ?? [], (m) => (
            <>
              <p className="mt-0.5 text-xs text-muted tabular-nums">
                <span className="sr-only">{fmtRange(m.start_at, m.end_at, me.timezone)}. </span>
                Until {fmtTime(m.end_at, me.timezone)} · {m.maybe} maybe, {m.no} can&apos;t
              </p>
              <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={`RSVP for ${m.title}`}>
                {(["yes", "maybe", "no"] as const).map((r) => (
                  <Button key={r} variant={m.my_response === r ? "primary" : "outline"} aria-pressed={m.my_response === r}
                    className="min-h-10! rounded-lg! px-3! text-xs sm:min-h-8! sm:px-2.5!"
                    onClick={() => rsvp(m.id, r)}>
                    {{ yes: "Going", maybe: "Maybe", no: "Can't" }[r]}
                  </Button>
                ))}
              </div>
            </>
          ))}
        />
      }
    >
      <PageHeader title="Calendar" hint={`Times shown in ${me.timezone.replace("_", " ")}`} />

      <section className="mb-10">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">Best times for {org.name}</h2>
          <label className="text-sm text-muted">
            Length{" "}
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm text-text">
              {[30, 60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>
          </label>
        </div>
        {slots.error && <Notice>{slots.error}</Notice>}
        {!slots.data && !slots.error && <Skeleton />}
        {slots.data && <SlotList slots={slots.data} action={isLead ? (o) => <Button onClick={() => { setProposing(o); setMeetingTitle("Group meeting"); setProposeError(""); }}>Propose meeting</Button> : undefined} />}
      </section>

      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">Your weekly availability</h2>
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
      <Dialog open={!!proposing} onClose={() => setProposing(null)} title="Propose a meeting"
        description={proposing ? `${fmtRange(proposing.start, new Date(new Date(proposing.start).getTime() + duration * 60000).toISOString(), me.timezone)} · ${proposing.count}/${proposing.total} free` : undefined}>
        <form onSubmit={propose} className="space-y-4" noValidate>
          <label className="block text-sm font-medium">
            Meeting name
            <input autoFocus value={meetingTitle} onChange={(e) => { setMeetingTitle(e.target.value); setProposeError(""); }} maxLength={200} aria-invalid={!!proposeError} className={field} />
          </label>
          {proposeError && <Notice>{proposeError}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setProposing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" busy={proposeBusy}>Propose meeting</Button>
          </div>
        </form>
      </Dialog>
    </Page>
  );
}
