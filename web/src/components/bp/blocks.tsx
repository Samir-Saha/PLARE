"use client";
import Link from "next/link";
import { useState } from "react";
import { api, post } from "@/lib/api";
import { BLOCK_KINDS, WEEKDAYS, kindLabel, type BpBlock, type BpBlockIn, type CalendarBusy } from "@/lib/bp";
import { fmtDate, fmtMinute } from "@/lib/format";
import { fromTime } from "@/lib/push";
import { Badge, Button, Card, Dialog, Empty, Notice, Skeleton, field, useLoad, useToast } from "@/components/ui";

export function whenLabel(b: { weekday: number | null; day: string | null; start_minute: number; end_minute: number }) {
  const days = b.weekday != null ? `Every ${WEEKDAYS[b.weekday]}` : fmtDate(b.day!);
  return `${days}, ${fmtMinute(b.start_minute)} to ${b.end_minute === 1440 ? "midnight" : fmtMinute(b.end_minute)}`;
}

/** A pledge's times they can't take a BP photo: list, add by hand, or confirm from Google Calendar. */
export function BlockedTimes() {
  const toast = useToast();
  const blocks = useLoad(() => api<BpBlock[]>("/me/bp/blocks"), []);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  async function remove(b: BpBlock) {
    setError("");
    try {
      await api(`/me/bp/blocks/${b.id}`, { method: "DELETE" });
      toast("Removed");
      blocks.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it.");
    }
  }

  return (
    <section>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">Times you can&apos;t take a photo</h2>
          <p className="text-sm text-muted">Check-ins never open during these, or within 10 minutes of them. Brothers see the type and time, not your notes.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setImporting(true)}>Import from Google Calendar</Button>
          <Button variant="primary" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add a time"}</Button>
        </div>
      </div>
      {adding && <AddBlock onDone={() => { setAdding(false); blocks.reload(); }} />}
      {error && <div className="mb-3"><Notice>{error}</Notice></div>}
      {blocks.error && <Notice>{blocks.error}</Notice>}
      {!blocks.data && !blocks.error && <Skeleton rows={2} />}
      {blocks.data?.length === 0 && !adding && (
        <Empty title="No blocked times yet">Add your classes, interviews, religious services, or anything else where you can&apos;t take a photo.</Empty>
      )}
      {blocks.data && blocks.data.length > 0 && (
        <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
          {blocks.data.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{b.kind_label}</span>
                <span className="text-muted"> · {whenLabel(b)}</span>
                {b.note && <span className="block truncate text-xs text-muted">{b.note}</span>}
              </span>
              <Button variant="ghost" className="min-h-8 shrink-0 px-2 text-xs" onClick={() => remove(b)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <CalendarImport open={importing} onClose={() => setImporting(false)} onSaved={() => { setImporting(false); blocks.reload(); }} />
    </section>
  );
}

function AddBlock({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: "class", repeat: "weekly", weekday: "0", day: "", start: "", end: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const start = fromTime(f.start);
    const end = fromTime(f.end);
    if (start == null || end == null) return setError("Pick a start and an end time.");
    if (end <= start) return setError("The end time has to be after the start time.");
    if (f.repeat === "once" && !f.day) return setError("Pick the date.");
    setBusy(true);
    setError("");
    const block: BpBlockIn = { kind: f.kind, start_minute: start, end_minute: end, note: f.note,
      ...(f.repeat === "weekly" ? { weekday: Number(f.weekday) } : { day: f.day }) };
    try {
      await post("/me/bp/blocks", { blocks: [block] });
      toast("Saved");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save it.");
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">What is it?
          <select value={f.kind} onChange={set("kind")} className={field}>
            {BLOCK_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">How often?
          <select value={f.repeat} onChange={set("repeat")} className={field}>
            <option value="weekly">Every week</option><option value="once">One date</option>
          </select>
        </label>
        {f.repeat === "weekly" ? (
          <label className="text-sm font-medium">Day
            <select value={f.weekday} onChange={set("weekday")} className={field}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        ) : (
          <label className="text-sm font-medium">Date<input type="date" value={f.day} onChange={set("day")} className={field} /></label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">From<input type="time" value={f.start} onChange={set("start")} className={field} /></label>
          <label className="text-sm font-medium">Until<input type="time" value={f.end} onChange={set("end")} className={field} /></label>
        </div>
        <label className="text-sm font-medium sm:col-span-2">Note for yourself (optional, brothers don&apos;t see it)
          <input maxLength={120} value={f.note} onChange={set("note")} className={field} placeholder="CS 2110 lecture" />
        </label>
        {error && <div className="sm:col-span-2"><Notice>{error}</Notice></div>}
        <div className="sm:col-span-2"><Button variant="primary" type="submit" busy={busy}>Save</Button></div>
      </form>
    </Card>
  );
}

type Pick = { checked: boolean; kind: string; weekly: boolean };

/** Confirmation step: imported busy times are only start and end, so the pledge says which ones are real blocks. */
function CalendarImport({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Import from Google Calendar"
      description="PLARE only sees when you're busy, not what the event is. Check the ones where you can't take a photo.">
      <CalendarImportBody onSaved={onSaved} onClose={onClose} />
    </Dialog>
  );
}

function CalendarImportBody({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const toast = useToast();
  const cal = useLoad(() => api<{ connected: boolean; busy: CalendarBusy[] }>("/me/bp/calendar?days=7"), []);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pick = (i: number): Pick => picks[i] ?? { checked: false, kind: "class", weekly: true };
  const update = (i: number, p: Partial<Pick>) => setPicks({ ...picks, [i]: { ...pick(i), ...p } });

  if (cal.error) return <Notice>{cal.error}</Notice>;
  if (!cal.data) return <Skeleton rows={3} />;
  if (!cal.data.connected) {
    return (
      <p className="text-sm text-muted">
        Connect Google Calendar on the <Link href="/app/study" className="font-semibold text-accent underline underline-offset-2" onClick={onClose}>Study hours</Link> page first, then come back here.
      </p>
    );
  }
  const items = cal.data.busy.map((b, i) => ({ b, i })).filter(({ b }) => !b.already_blocked);
  if (items.length === 0) return <p className="text-sm text-muted">Nothing new in the next 7 days. Everything busy is already on your list.</p>;

  async function save() {
    const chosen = items.filter(({ i }) => pick(i).checked).map(({ b, i }): BpBlockIn => ({
      kind: pick(i).kind, start_minute: b.start_minute, end_minute: b.end_minute, source: "calendar",
      ...(pick(i).weekly ? { weekday: b.weekday } : { day: b.day }),
    }));
    if (chosen.length === 0) return setError("Check at least one time, or close this.");
    setBusy(true);
    setError("");
    try {
      await post("/me/bp/blocks", { blocks: chosen });
      toast(`Added ${chosen.length} blocked time${chosen.length === 1 ? "" : "s"}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save them.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ul className="max-h-[50dvh] space-y-2 overflow-y-auto">
        {items.map(({ b, i }) => {
          const p = pick(i);
          return (
            <li key={i} className={`rounded-xl border px-3 py-2.5 text-sm ${p.checked ? "border-accent bg-accent-soft" : "border-line"}`}>
              <label className="flex items-center gap-2.5 font-medium">
                <input type="checkbox" checked={p.checked} onChange={(e) => update(i, { checked: e.target.checked })} className="size-4 accent-accent" />
                {fmtDate(b.day)}, {fmtMinute(b.start_minute)} to {b.end_minute === 1440 ? "midnight" : fmtMinute(b.end_minute)}
              </label>
              {p.checked && (
                <div className="mt-2 flex flex-wrap items-center gap-3 pl-6.5">
                  <select aria-label="What is it?" value={p.kind} onChange={(e) => update(i, { kind: e.target.value })} className={`${field} mt-0 w-auto`}>
                    {BLOCK_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={p.weekly} onChange={(e) => update(i, { weekly: e.target.checked })} className="accent-accent" />
                    Every {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][b.weekday]}
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <Notice>{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={save}>Add checked times</Button>
      </div>
    </div>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  return <Badge>{kindLabel(kind)}</Badge>;
}
