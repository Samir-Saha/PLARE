"use client";
import { useMemo, useState } from "react";
import { useApp } from "@/components/shell";
import { Badge, Button, Card, Dialog, Empty, ListRow, Notice, Page, PageHeader, SectionHeader, Skeleton, field, useLoad, useToast } from "@/components/ui";
import { IconChevronLeft, IconChevronRight, IconPlus } from "@/components/icons";
import { fmtRange } from "@/lib/format";
import { ApiError } from "@/lib/api";
import {
  RSVP_LABEL, createEvent, dayKey, deleteEvent, listEvents, listMembers, setRsvp,
  type CalEvent, type OrgMember,
} from "@/lib/events";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Green once enough people are going, amber while still waiting on RSVPs. */
const chipTone = (e: CalEvent) => (e.confirmed ? "border-ok bg-ok-soft text-ok" : "border-warn bg-warn-soft text-warn");

function monthCells(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.");

export default function EventsPage() {
  const { me, org, isLead } = useApp();
  const tz = me.timezone;
  const toast = useToast();
  const events = useLoad(() => listEvents(org.id), [org.id]);
  const members = useLoad(() => listMembers(org.id), [org.id]);
  const todayKey = dayKey(new Date().toISOString(), tz);
  const [cursor, setCursor] = useState(() => ({ y: Number(todayKey.slice(0, 4)), m: Number(todayKey.slice(5, 7)) - 1 }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const list = events.data ?? [];
  const selected = list.find((e) => e.id === openId) ?? null;
  const cells = useMemo(() => monthCells(cursor.y, cursor.m), [cursor]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events.data ?? []) {
      const k = dayKey(e.start_at, tz);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [events.data, tz]);
  const upcoming = list.filter((e) => new Date(e.end_at).getTime() >= nowMs).slice(0, 8);
  const shift = (n: number) => setCursor(({ y, m }) => { const d = new Date(Date.UTC(y, m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cursor.y, cursor.m, 1)));

  return (
    <Page>
      <PageHeader title="Events" hint="Invite people, collect RSVPs. An event turns green once enough are going."
        action={<Button variant="primary" onClick={() => setCreating(true)}><IconPlus width={16} height={16} />New event</Button>} />
      {events.error && <Notice>{events.error}</Notice>}
      {!events.data && !events.error ? <Skeleton rows={4} /> : (
        <>
          <Card className="p-3 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{monthLabel}</h2>
              <div className="flex items-center gap-1">
                <Button variant="ghost" aria-label="Previous month" className="px-2" onClick={() => shift(-1)}><IconChevronLeft width={18} height={18} /></Button>
                <Button variant="ghost" onClick={() => setCursor({ y: Number(todayKey.slice(0, 4)), m: Number(todayKey.slice(5, 7)) - 1 })}>Today</Button>
                <Button variant="ghost" aria-label="Next month" className="px-2" onClick={() => shift(1)}><IconChevronRight width={18} height={18} /></Button>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted">
              <span className="flex items-center gap-1.5"><i className="size-3 rounded border border-ok bg-ok-soft" />Confirmed</span>
              <span className="flex items-center gap-1.5"><i className="size-3 rounded border border-warn bg-warn-soft" />Waiting on RSVPs</span>
            </div>
            <div role="grid" aria-label={monthLabel} className="grid grid-cols-7 overflow-hidden rounded-[14px] border border-line text-sm">
              {WEEKDAYS.map((d) => <div key={d} className="border-b border-line bg-raised py-2 text-center text-xs font-medium text-muted">{d}</div>)}
              {cells.map((k) => {
                const inMonth = Number(k.slice(5, 7)) - 1 === cursor.m;
                const items = byDay.get(k) ?? [];
                return (
                  <div key={k} className={`min-h-[84px] border-b border-r border-line p-1 ${inMonth ? "" : "bg-raised/60 text-muted"}`}>
                    <div className={`mb-0.5 text-xs tabular-nums ${k === todayKey ? "font-bold text-accent" : ""}`}>{Number(k.slice(8))}</div>
                    <div className="space-y-0.5">
                      {items.slice(0, 3).map((e) => (
                        <button key={e.id} type="button" onClick={() => setOpenId(e.id)}
                          className={`block w-full truncate rounded border px-1 py-px text-left text-[11px] font-medium ${chipTone(e)}`}>
                          {e.title}
                        </button>
                      ))}
                      {items.length > 3 && <p className="px-1 text-[11px] text-muted">+{items.length - 3} more</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <SectionHeader title="Upcoming" className="mt-9" />
          {upcoming.length === 0 ? <Empty title="Nothing scheduled">Create an event and invite people.</Empty> : (
            <ul className="space-y-2.5">
              {upcoming.map((e) => (
                <ListRow key={e.id} bar={null}
                  end={<Button variant="outline" onClick={() => setOpenId(e.id)}>{e.my_response && e.my_response !== "invited" ? RSVP_LABEL[e.my_response] : e.my_response ? "RSVP" : "View"}</Button>}>
                  <p className="truncate font-medium">{e.title}</p>
                  <p className="truncate text-sm text-muted">{fmtRange(e.start_at, e.end_at, tz)}</p>
                  <div className="mt-1.5"><Badge tone={e.confirmed ? "ok" : "warn"}>{e.confirmed ? "Confirmed" : `${e.going}/${e.required_rsvps} going`}</Badge></div>
                </ListRow>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog open={!!selected} onClose={() => setOpenId(null)} title={selected?.title ?? ""} description={selected ? fmtRange(selected.start_at, selected.end_at, tz) : undefined}>
        {selected && (
          <EventDetail key={selected.id} ev={selected} canDelete={isLead || selected.created_by === me.id}
            onChanged={() => events.reload()} onDeleted={() => { setOpenId(null); events.reload(); toast("Event deleted"); }} />
        )}
      </Dialog>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New event" description="The people you invite can RSVP.">
        <CreateForm orgId={org.id} members={members.data ?? []} meId={me.id}
          onDone={() => { setCreating(false); events.reload(); toast("Event created"); }} />
      </Dialog>
    </Page>
  );
}

function EventDetail({ ev, canDelete, onChanged, onDeleted }: { ev: CalEvent; canDelete: boolean; onChanged: () => void; onDeleted: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function answer(r: "yes" | "no" | "maybe") {
    setBusy(true); setError("");
    try { await setRsvp(ev.id, r); onChanged(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    try { await deleteEvent(ev.id); onDeleted(); } catch (e) { setError(errText(e)); }
  }
  return (
    <div className="space-y-4">
      <p className={`rounded-xl border px-3 py-2 text-sm font-medium ${chipTone(ev)}`}>
        {ev.confirmed ? `Confirmed: ${ev.going} going` : `${ev.going} of ${ev.required_rsvps} needed are going. ${ev.needed} more to confirm.`}
      </p>
      {ev.location && <p className="text-sm">{ev.location}</p>}
      {ev.description && <p className="whitespace-pre-wrap text-sm text-muted">{ev.description}</p>}
      {ev.my_response ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Your RSVP">
          {(["yes", "maybe", "no"] as const).map((r) => (
            <Button key={r} variant={ev.my_response === r ? "primary" : "outline"} busy={busy} onClick={() => answer(r)}>{RSVP_LABEL[r]}</Button>
          ))}
        </div>
      ) : <p className="text-sm text-muted">You weren&apos;t invited to this event.</p>}
      {error && <Notice>{error}</Notice>}
      <ul className="divide-y divide-line rounded-[14px] border border-line text-sm">
        {ev.guests.map((g) => (
          <li key={g.user_id} className="flex items-center justify-between px-3 py-2">
            <span>{g.name}</span>
            <Badge tone={g.response === "yes" ? "ok" : g.response === "no" ? "danger" : g.response === "maybe" ? "warn" : "neutral"}>{RSVP_LABEL[g.response]}</Badge>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Created by {ev.created_by_name}</p>
      {canDelete && <Button variant="danger" onClick={remove}>Delete event</Button>}
    </div>
  );
}

function CreateForm({ orgId, members, meId, onDone }: { orgId: string; members: OrgMember[]; meId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [required, setRequired] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const others = members.filter((m) => m.user_id !== meId);
  const invited = picked.size + 1; // you're always on the guest list

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim() || !start || !end) return setError("Add a title, a start time, and an end time.");
    if (new Date(end) <= new Date(start)) return setError("The end has to be after the start.");
    if (required > invited) return setError(`You need ${required} RSVPs but only ${invited} ${invited === 1 ? "person is" : "people are"} invited.`);
    setBusy(true);
    try {
      await createEvent(orgId, {
        title: title.trim(), location, description, required_rsvps: required, guest_ids: [...picked],
        start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(),
      });
      onDone();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">Title<input className={field} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="block text-sm font-medium">Location (optional)<input className={field} value={location} maxLength={255} onChange={(e) => setLocation(e.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Starts<input type="datetime-local" className={field} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="block text-sm font-medium">Ends<input type="datetime-local" className={field} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <label className="block text-sm font-medium">Notes (optional)<textarea className={field} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="block text-sm font-medium">
        RSVPs needed to confirm
        <input type="number" min={1} max={Math.max(1, invited)} className={field} value={required} onChange={(e) => setRequired(Math.max(1, Number(e.target.value) || 1))} />
      </label>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-medium">Invite people ({invited} including you)</legend>
        <button type="button" className="mb-1 text-xs font-medium text-accent underline underline-offset-2"
          onClick={() => setPicked(picked.size === others.length ? new Set() : new Set(others.map((m) => m.user_id)))}>
          {picked.size === others.length ? "Clear all" : "Select all"}
        </button>
        <div className="max-h-44 overflow-y-auto">
          {others.map((m) => (
            <label key={m.user_id} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={picked.has(m.user_id)} onChange={() => toggle(m.user_id)} />{m.name}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <Notice>{error}</Notice>}
      <Button type="submit" variant="primary" busy={busy} className="w-full">Create event</Button>
    </form>
  );
}
