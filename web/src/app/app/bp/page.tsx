"use client";
import { useEffect, useRef, useState } from "react";
import { api, fileUrl, type BpCheckin, type BpGrid, type BpMine, type BpTile } from "@/lib/api";
import { fmtDate, fmtMinute, fmtTime, minutesBetween } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Badge, Button, Card, Empty, ListRow, Notice, Page, PageHeader, SectionHeader, Skeleton, field, useLoad, useToast } from "@/components/ui";

/** BP check-in: leads get the day's grid; members take today's photo. */
export default function Bp() {
  const { isLead } = useApp();
  return isLead ? <LeadBp /> : <MemberBp />;
}

function MemberBp() {
  const { org } = useApp();
  const bp = useLoad(() => api<BpMine>(`/orgs/${org.id}/bp/me`), [org.id]);
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());
  const d = bp.data;
  const pastDue = d ? now > new Date(d.due_at).getTime() : false;

  async function send(file: File) {
    if (!/^image\/(jpeg|png)$/.test(file.type)) return setError("Take the photo again. Only JPEG or PNG photos work.");
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("caption", caption);
      await api(`/orgs/${org.id}/bp`, { method: "POST", body: form });
      setCaption("");
      bp.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your BP. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Page>
      <PageHeader title="BP check-in"
        hint={d ? `${fmtDate(d.day)} · due ${fmtMinute(d.due_minute)} (${d.timezone.replace("_", " ")})` : undefined} />
      {bp.error && <Notice>{bp.error}</Notice>}
      {!d && !bp.error && <Skeleton rows={2} />}
      {d && !d.enabled && <Empty title="BP check-ins are off">Your brothers turned BP check-ins off for this group.</Empty>}

      {d?.enabled && d.today && (
        <Card className="mb-10 max-w-xl">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold">Today&apos;s BP is in</h2>
              <p className="text-sm text-muted tabular-nums">Received at {fmtTime(d.today.submitted_at, d.timezone)}</p>
            </div>
            <Status s={d.today.status} />
          </div>
          <Photo id={d.today.id} alt="Your BP for today" />
          {d.today.late && <p className="mt-3 text-sm text-muted">Sent {minutesBetween(d.today.due_at, d.today.submitted_at)} min after the deadline.</p>}
        </Card>
      )}

      {d?.enabled && !d.today && (
        <Card className="mb-10 max-w-xl">
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-semibold">Take today&apos;s BP</h2>
              <p className="text-sm text-muted">The photo is taken here and timed by the server, so the time can&apos;t be changed. One per day.</p>
            </div>
            {pastDue && <Notice tone="warn">It&apos;s past {fmtMinute(d.due_minute)}. You can still send it, but it will be marked late.</Notice>}
            <label className="block text-sm font-medium">Caption (optional)
              <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={280}
                placeholder="Who you're with and where" className={field} />
            </label>
            {/* The camera opens only from this button press. */}
            <input ref={input} type="file" accept="image/jpeg,image/png" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); }} />
            {error && <Notice>{error}</Notice>}
            <Button variant="primary" busy={busy} onClick={() => input.current?.click()}>Take photo</Button>
          </div>
        </Card>
      )}

      {d && d.history.filter((h) => h.day !== d.day).length > 0 && (
        <section>
          <SectionHeader title="Past two weeks" />
          <ul className="space-y-2.5">
            {d.history.filter((h) => h.day !== d.day).map((c) => (
              <ListRow key={c.id} bar={c.late ? "danger" : "ok"} end={<Status s={c.status} />}>
                <p className="text-[15px] font-semibold leading-snug">{fmtDate(c.day)}</p>
                <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">Received {fmtTime(c.submitted_at, d.timezone)}{c.caption && ` · ${c.caption}`}</p>
              </ListRow>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}

function LeadBp() {
  const { org } = useApp();
  const [day, setDay] = useState("");
  const grid = useLoad(() => api<BpGrid>(`/orgs/${org.id}/bp/grid${day ? `?day=${day}` : ""}`), [org.id, day]);
  const g = grid.data;
  return (
    <Page>
      <PageHeader title="BP check-ins"
        hint={g ? `${fmtDate(g.day)} · due ${fmtMinute(g.due_minute)}` : undefined}
        action={g && (
          <input type="date" aria-label="Day" value={day || g.day} max={g.today}
            onChange={(e) => setDay(e.target.value)} className={`${field} mt-0 w-auto`} />
        )} />
      {grid.error && <Notice>{grid.error}</Notice>}
      {!g && !grid.error && <Skeleton rows={3} />}
      {g && (
        <>
          <p className="mb-4 text-sm text-muted tabular-nums">
            {g.counts.on_time} on time · {g.counts.late} late · {g.counts.missing} missing
            {!g.past_due && ` · ${g.counts.pending} not in yet`}
          </p>
          {g.tiles.length === 0
            ? <Empty title="No members yet">Invite your members and their BPs will show up here.</Empty>
            : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {g.tiles.map((t) => <Tile key={t.user_id} t={t} tz={g.timezone} />)}
              </ul>
            )}
          <Deadline key={g.due_minute} orgId={org.id} dueMinute={g.due_minute} tz={g.timezone} onSaved={grid.reload} />
        </>
      )}
    </Page>
  );
}

function Tile({ t, tz }: { t: BpTile; tz: string }) {
  return (
    <li className={`overflow-hidden rounded-2xl border bg-surface ${t.status === "late" || t.status === "missing" ? "border-danger" : "border-line"}`}>
      {t.checkin
        ? <Photo id={t.checkin.id} alt={`${t.name}'s BP`} square />
        : <div className="flex aspect-square items-center justify-center bg-raised text-sm text-muted">{t.status === "missing" ? "No photo" : "Not in yet"}</div>}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{t.name}</p>
          <Status s={t.status} />
        </div>
        {t.checkin && <p className="mt-0.5 text-xs text-muted tabular-nums">{fmtTime(t.checkin.submitted_at, tz)}</p>}
        {t.checkin?.caption && <p className="mt-1 line-clamp-2 text-xs text-muted">{t.checkin.caption}</p>}
      </div>
    </li>
  );
}

/** Photos are private, so they're fetched with auth as blobs, never linked directly. */
function Photo({ id, alt, square }: { id: string; alt: string; square?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    fileUrl(`/bp/${id}/photo`).then((u) => { url = u; if (live) setSrc(u); }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  const cls = square ? "aspect-square w-full object-cover" : "mt-3 max-h-96 w-full rounded-xl object-cover";
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className={cls} /> : <div className={`${cls} bg-raised`} />;
}

function Status({ s }: { s: BpCheckin["status"] | BpTile["status"] }) {
  if (s === "on_time") return <Badge tone="ok">On time</Badge>;
  if (s === "late") return <Badge tone="danger">Late</Badge>;
  if (s === "missing") return <Badge tone="danger">Missing</Badge>;
  return <Badge>Waiting</Badge>;
}

/** Leads set the daily BP deadline (in the group's timezone). Late and missing flags follow it. */
function Deadline({ orgId, dueMinute, tz, onSaved }: { orgId: string; dueMinute: number; tz: string; onSaved: () => void }) {
  const toast = useToast();
  const [due, setDue] = useState(`${String(Math.floor(dueMinute / 60)).padStart(2, "0")}:${String(dueMinute % 60).padStart(2, "0")}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const [h, m] = due.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return setError("Pick a deadline time.");
    setBusy(true);
    setError("");
    try {
      await api(`/orgs/${orgId}/bp/settings`, { method: "PATCH", body: JSON.stringify({ due_minute: h * 60 + m }) });
      toast(`BP deadline set to ${fmtMinute(h * 60 + m)}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the deadline. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-8 max-w-xl">
      <h2 className="font-display text-[20px] font-extrabold">Daily deadline</h2>
      <p className="mt-1 text-sm text-muted">Photos sent after this time are marked late. Times are in {tz.replace("_", " ")}.</p>
      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">Due at
          <input type="time" value={due} onChange={(e) => setDue(e.target.value)} required className={`${field} w-auto`} />
        </label>
        <Button type="submit" variant="primary" busy={busy}>Save deadline</Button>
      </form>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </Card>
  );
}
