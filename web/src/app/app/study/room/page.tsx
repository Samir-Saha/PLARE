"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, fileUrl, post, type GroupStudyHistory, type GroupStudySettings, type RoomHour, type StudyRoom } from "@/lib/api";
import { fmtClock, fmtDay, fmtTime } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Avatar, Badge, Button, Card, Dialog, Empty, Notice, Page, PageHeader, Skeleton, field, table, useLoad, useToast } from "@/components/ui";

const POLL_MS = 5000;

type RoomState = { settings: GroupStudySettings; session: StudyRoom | null };

const STATUS: Record<RoomHour["status"], { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "danger" }> = {
  waiting: { label: "Check-in coming", tone: "neutral" },
  open: { label: "Check-in open", tone: "warn" },
  on_track: { label: "On track", tone: "accent" },
  counted: { label: "Counted", tone: "ok" },
  short: { label: "Didn't count", tone: "danger" },
  incomplete: { label: "Ended early", tone: "neutral" },
};

export default function StudyRoomPage() {
  const { me, org, isLead } = useApp();
  const toast = useToast();
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [skew, setSkew] = useState(0); // server clock minus this device's clock, in ms
  const [nowMs, setNowMs] = useState(0);

  const apply = useCallback((s: StudyRoom | null, settings?: GroupStudySettings) => {
    setState((cur) => ({ settings: settings ?? cur?.settings ?? { quorum: 0, window_minutes: 0, member_count: 0, customized: false }, session: s }));
    if (s) setSkew(new Date(s.server_now).getTime() - Date.now());
  }, []);

  const load = useCallback(
    () => api<RoomState>(`/orgs/${org.id}/group-study/room`).then((r) => { apply(r.session, r.settings); setError(""); },
      (e) => setError(e instanceof Error ? e.message : "Couldn't load the room.")),
    [org.id, apply],
  );

  // Live room: poll while the page is open. Polling is also what marks you "here now".
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const session = state?.session ?? null;
  // Before the first clock tick, fall back to the server's own timestamp.
  const serverNow = nowMs ? nowMs + skew : session ? new Date(session.server_now).getTime() : 0;
  const ping = session?.open_ping ?? null;
  const needsCheckIn = !!(ping && session?.me.studying && !ping.i_confirmed);

  // Alert when a check-in opens: tab title always, a system notification only if the user turned alerts on.
  const alerted = useRef<string | null>(null);
  useEffect(() => {
    if (!needsCheckIn || !ping) {
      document.title = "Study room · PLARE";
      return;
    }
    document.title = "Check in now · Study room";
    if (alerted.current === ping.id) return;
    alerted.current = ping.id;
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      new Notification("Study check-in", { body: `Send a photo in the next ${session?.window_minutes} minutes.`, tag: ping.id });
    }
  }, [needsCheckIn, ping, session?.window_minutes]);

  async function run(fn: () => Promise<StudyRoom>, done?: string) {
    try {
      apply(await fn());
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong.", "danger");
      load();
    }
  }

  if (error && !state) return <Page><PageHeader title="Group study room" /><Notice>{error}</Notice></Page>;
  if (!state) return <Page><PageHeader title="Group study room" /><Skeleton /></Page>;

  return (
    <Page>
      <PageHeader
        title="Group study room"
        hint={session ? `${session.title} · started by ${session.started_by_name} at ${fmtTime(session.started_at, me.timezone)}` : "No group session running"}
        action={<Link href="/app/study" className="text-sm font-medium text-accent underline underline-offset-2">Back to Study hours</Link>}
      />
      {error && <div className="mb-4"><Notice tone="warn">Connection trouble: {error} Retrying.</Notice></div>}

      {!session ? (
        <NoSession settings={state.settings} isLead={isLead} memberLabel={org.member_label}
          onStart={(title) => run(() => post<StudyRoom>(`/orgs/${org.id}/group-study/room`, { title }), "Group session started")}
          onSettings={(s) => setState((cur) => cur && { ...cur, settings: s })} />
      ) : (
        <>
          {needsCheckIn && ping && (
            <CheckInCard pingId={ping.id} secondsLeft={Math.max(0, Math.floor((new Date(ping.closes_at).getTime() - serverNow) / 1000))}
              onDone={(s) => { apply(s); toast("Checked in for this hour"); }} />
          )}
          {ping?.i_confirmed && session.me.studying && (
            <div className="mb-4"><Notice tone="ok">You&apos;re checked in for this hour.</Notice></div>
          )}

          <SessionCard session={session} serverNow={serverNow} memberLabel={org.member_label}
            onJoin={() => run(() => post<StudyRoom>(`/group-study/${session.id}/join`), "You joined the session")}
            onLeave={() => run(() => post<StudyRoom>(`/group-study/${session.id}/leave`), "You left the session")}
            onEnd={() => run(() => post<StudyRoom>(`/group-study/${session.id}/end`), "Session ended")} />

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-8">
              <Hours session={session} tz={me.timezone} memberLabel={org.member_label} />
              <Chat session={session} meId={me.id} tz={me.timezone} onSent={load} />
            </div>
            <People session={session} memberLabel={org.member_label} />
          </div>
        </>
      )}

      <History orgId={org.id} isLead={isLead} tz={me.timezone} memberLabel={org.member_label} refreshKey={session?.ended_at ?? session?.id ?? "none"} />
    </Page>
  );
}

function Rules({ quorum, window, memberLabel }: { quorum: number; window: number; memberLabel: string }) {
  const m = memberLabel.toLowerCase();
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
      <li>Once an hour, at a random time, everyone studying gets a check-in. You have {window} minutes to send a photo.</li>
      <li>The hour counts only if at least {quorum} {m}s check in and the session runs the full hour.</li>
      <li>When it counts, each {m} who checked in gets the hour. Missing the check-in means you don&apos;t.</li>
      <li>Your camera only opens when you press &quot;Take photo&quot;.</li>
    </ul>
  );
}

function NoSession({ settings, isLead, memberLabel, onStart, onSettings }: {
  settings: GroupStudySettings; isLead: boolean; memberLabel: string; onStart: (title: string) => Promise<void>; onSettings: (s: GroupStudySettings) => void;
}) {
  const [title, setTitle] = useState("Group study");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-display text-lg font-semibold">Start a group session</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Everyone in the group gets a notice. {memberLabel}s join to study; others can drop in to watch and chat.</p>
        <Rules quorum={settings.quorum} window={settings.window_minutes} memberLabel={memberLabel} />
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onStart(title); setBusy(false); }}>
          <label className="min-w-0 flex-1 text-sm font-medium">Session name
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required className={field} />
          </label>
          <Button variant="primary" type="submit" busy={busy}>Start group session</Button>
        </form>
      </Card>
      {isLead && <SettingsCard settings={settings} memberLabel={memberLabel} onSaved={onSettings} />}
    </div>
  );
}

function SettingsCard({ settings, memberLabel, onSaved }: { settings: GroupStudySettings; memberLabel: string; onSaved: (s: GroupStudySettings) => void }) {
  const { org } = useApp();
  const toast = useToast();
  const [quorum, setQuorum] = useState(settings.quorum);
  const [window, setWindow] = useState(settings.window_minutes);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await api<GroupStudySettings>(`/orgs/${org.id}/group-study/settings`, { method: "PUT", body: JSON.stringify({ quorum, window_minutes: window }) }));
      toast("Check-in rules saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save.", "danger");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <h2 className="font-display text-lg font-semibold">Check-in rules</h2>
      <p className="mt-1 text-sm text-muted">Applies to sessions started after you save. This group has {settings.member_count} {memberLabel.toLowerCase()}s.</p>
      <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">Check-ins needed for an hour to count
          <input type="number" min={1} max={Math.max(1, settings.member_count)} value={quorum} onChange={(e) => setQuorum(Number(e.target.value))} className={`${field} w-28`} />
        </label>
        <label className="text-sm font-medium">Minutes to respond
          <input type="number" min={3} max={30} value={window} onChange={(e) => setWindow(Number(e.target.value))} className={`${field} w-28`} />
        </label>
        <Button type="submit" busy={busy}>Save rules</Button>
      </form>
    </Card>
  );
}

function CheckInCard({ pingId, secondsLeft, onDone }: { pingId: string; secondsLeft: number; onDone: (s: StudyRoom) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function send(file: File) {
    setBusy(true);
    setErr("");
    try {
      const form = new FormData();
      form.append("photo", file);
      onDone(await api<StudyRoom>(`/group-study/pings/${pingId}/checkin`, { method: "POST", body: form }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send the photo. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <section aria-live="assertive" className="mb-4 rounded-2xl border border-warn bg-warn-soft p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-warn">Check-in open</h2>
          <p className="text-sm text-text">Take a photo of yourself studying. <span className="font-semibold tabular-nums">{fmtClock(secondsLeft).slice(3)}</span> left.</p>
        </div>
        {/* The camera opens only from this button press. `capture` asks phones for the front camera. */}
        <input ref={input} type="file" accept="image/jpeg,image/png" capture="user" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); }} />
        <Button variant="primary" busy={busy} onClick={() => input.current?.click()}>Take photo</Button>
      </div>
      {err && <div className="mt-3"><Notice>{err}</Notice></div>}
    </section>
  );
}

function AlertsButton() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    const id = setTimeout(() => setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission), 0);
    return () => clearTimeout(id);
  }, []);
  if (perm === "unsupported" || perm === "granted") return null;
  if (perm === "denied") return <p className="text-xs text-muted">Alerts are blocked in this browser&apos;s settings. Keep this tab open to see check-ins.</p>;
  return <Button variant="outline" onClick={() => Notification.requestPermission().then(setPerm)}>Alert me when a check-in opens</Button>;
}

function SessionCard({ session, serverNow, memberLabel, onJoin, onLeave, onEnd }: {
  session: StudyRoom; serverNow: number; memberLabel: string; onJoin: () => void; onLeave: () => void; onEnd: () => void;
}) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const elapsed = Math.max(0, Math.floor((serverNow - new Date(session.started_at).getTime()) / 1000));
  const studying = session.people.filter((p) => p.studying).length;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{studying} {memberLabel.toLowerCase()}{studying === 1 ? "" : "s"} studying · {session.quorum} check-ins needed each hour</p>
          <p className="font-display text-5xl font-semibold tabular-nums tracking-[-0.02em]">{fmtClock(elapsed)}</p>
          {session.me.role === "member" && (
            <p className="mt-1 text-sm text-muted">Hours counted for you this session: <span className="font-semibold text-text tabular-nums">{session.me.hours_counted}</span></p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session.me.can_join && !session.me.studying && <Button variant="primary" onClick={onJoin}>Join to study</Button>}
          {session.me.studying && <Button onClick={onLeave}>Leave</Button>}
          {session.can_end && <Button variant="danger" onClick={() => setConfirmEnd(true)}>End session</Button>}
        </div>
      </div>
      {session.me.studying && <div className="mt-4 flex flex-wrap items-center gap-3"><AlertsButton /><p className="text-xs text-muted">Keep this page open. Check-ins show up here.</p></div>}
      {session.me.role !== "member" && <p className="mt-3 text-sm text-muted">You&apos;re dropping in. You can watch check-ins and chat; only {memberLabel.toLowerCase()}s check in.</p>}
      <Dialog open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End this session for everyone?"
        description="The current hour won't count if it hasn't finished. Hours already counted stay counted.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Keep going</Button>
          <Button variant="danger" onClick={() => { setConfirmEnd(false); onEnd(); }}>End session</Button>
        </div>
      </Dialog>
    </Card>
  );
}

function Hours({ session, tz, memberLabel }: { session: StudyRoom; tz: string; memberLabel: string }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-[-0.01em]">Hours</h2>
      <ol className="space-y-2">
        {[...session.hours].reverse().map((h) => (
          <li key={h.index} className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium tabular-nums">Hour {h.index + 1} <span className="font-normal text-muted">· {fmtTime(h.start, tz)} to {fmtTime(h.end, tz)}</span></p>
              <Badge tone={STATUS[h.status].tone}>{STATUS[h.status].label}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted tabular-nums">
              {h.status === "waiting"
                ? "The check-in time is random and stays hidden until it opens."
                : `${h.count} of ${session.quorum} check-ins${h.ping_at ? ` · opened ${fmtTime(h.ping_at, tz)}` : ""}`}
            </p>
            {h.status !== "waiting" && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${h.count} of ${session.quorum} check-ins`}>
                  <div className={`h-full rounded-full ${h.count >= session.quorum ? "bg-ok" : "bg-accent"}`} style={{ width: `${Math.min(100, (h.count / Math.max(1, session.quorum)) * 100)}%` }} />
                </div>
                {h.confirmed.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {h.confirmed.map((c) => <CheckinChip key={c.user_id} name={c.name} checkinId={c.checkin_id} />)}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {session.hours.length === 0 && <Empty title="No hours yet">The first check-in is scheduled when the session starts.</Empty>}
      <p className="mt-2 text-xs text-muted">Photos are visible only to {memberLabel.toLowerCase()}s studying in this session and to leads.</p>
    </section>
  );
}

function CheckinChip({ name, checkinId }: { name: string; checkinId: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!checkinId) return;
    let url: string | null = null;
    let live = true;
    fileUrl(`/study-checkins/${checkinId}/photo`).then((u) => { url = u; if (live) setSrc(u); }, () => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [checkinId]);
  const first = name.split(" ")[0];
  if (!checkinId) {
    return <li className="flex items-center gap-1.5 rounded-full bg-ok-soft py-1 pl-1 pr-2.5 text-xs font-medium text-ok"><Avatar name={name} className="size-6 text-[10px]" />{first}</li>;
  }
  return (
    <li>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-full bg-ok-soft py-1 pl-1 pr-2.5 text-xs font-medium text-ok" aria-label={`See ${name}'s check-in photo`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private blob URL, not optimizable */}
        {src ? <img src={src} alt="" className="size-6 rounded-full object-cover" /> : <Avatar name={name} className="size-6 text-[10px]" />}
        {first}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${name}'s check-in`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private blob URL, not optimizable */}
        {src ? <img src={src} alt={`${name} studying`} className="w-full rounded-xl" /> : <Skeleton rows={1} />}
      </Dialog>
    </li>
  );
}

function People({ session, memberLabel }: { session: StudyRoom; memberLabel: string }) {
  const studying = session.people.filter((p) => p.studying);
  const watching = session.people.filter((p) => !p.studying && p.here_now);
  const row = (p: StudyRoom["people"][number]) => (
    <li key={p.user_id} className="flex items-center gap-2.5 py-1.5 text-sm">
      <span className="relative">
        <Avatar name={p.name} className="size-8 text-[11px]" />
        <span aria-hidden className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${p.here_now ? "bg-ok" : "bg-line"}`} />
      </span>
      <span className="min-w-0 flex-1 truncate">{p.name}</span>
      <span className="text-xs text-muted">{p.here_now ? "here now" : "away"}</span>
    </li>
  );
  return (
    <aside aria-label="People in the room" className="space-y-6">
      <section>
        <h2 className="mb-2 font-display text-base font-semibold">Studying ({studying.length})</h2>
        {studying.length ? <ul>{studying.map(row)}</ul> : <p className="text-sm text-muted">No {memberLabel.toLowerCase()}s have joined yet.</p>}
      </section>
      <section>
        <h2 className="mb-2 font-display text-base font-semibold">Dropped in ({watching.length})</h2>
        {watching.length ? <ul>{watching.map(row)}</ul> : <p className="text-sm text-muted">Nobody else is watching right now.</p>}
      </section>
    </aside>
  );
}

function Chat({ session, meId, tz, onSent }: { session: StudyRoom; meId: string; tz: string; onSent: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const last = session.messages.at(-1)?.id;
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [last]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await post(`/group-study/${session.id}/messages`, { body: text });
      setText("");
      onSent();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send.", "danger");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-[-0.01em]">Room chat</h2>
      <div className="rounded-xl border border-line bg-surface">
        <ol ref={list} aria-live="polite" className="max-h-80 space-y-3 overflow-y-auto p-4">
          {session.messages.length === 0 && <li className="text-sm text-muted">No messages yet. Say hi or ask a question.</li>}
          {session.messages.map((m) => (
            <li key={m.id} className="text-sm">
              <span className={`font-semibold ${m.user_id === meId ? "text-accent" : ""}`}>{m.user_id === meId ? "You" : m.name}</span>
              <span className="ml-2 text-xs text-muted tabular-nums">{fmtTime(m.created_at, tz)}</span>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ol>
        <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
          <label className="sr-only" htmlFor="room-msg">Message</label>
          <input id="room-msg" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message the room"
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-text" />
          <Button type="submit" busy={busy} disabled={!text.trim()}>Send</Button>
        </form>
      </div>
    </section>
  );
}

function History({ orgId, isLead, tz, memberLabel, refreshKey }: { orgId: string; isLead: boolean; tz: string; memberLabel: string; refreshKey: string }) {
  const h = useLoad(() => api<GroupStudyHistory>(`/orgs/${orgId}/group-study/history`), [orgId, refreshKey]);
  if (!h.data) return h.error ? <div className="mt-10"><Notice>{h.error}</Notice></div> : null;
  const { sessions, members, my_hours } = h.data;
  return (
    <section className="mt-10 space-y-8">
      {!isLead && <p className="text-sm text-muted">Group hours counted for you so far: <span className="font-semibold text-text tabular-nums">{my_hours}</span></p>}
      {members && (
        <div>
          <h2 className="mb-3 font-display text-lg font-semibold tracking-[-0.01em]">Group hours by {memberLabel.toLowerCase()}</h2>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className={table.table}>
              <thead className={table.head}><tr><th className={table.th}>Name</th><th className={`${table.th} text-right`}>Hours counted</th></tr></thead>
              <tbody className={table.body}>
                {members.map((m) => <tr key={m.user_id}><td className={table.cell}>{m.name}</td><td className={`${table.cell} text-right font-medium`}>{m.hours}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {sessions.length > 0 && (
        <div>
          <h2 className="mb-3 font-display text-lg font-semibold tracking-[-0.01em]">Past sessions</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-3 px-4 py-3 text-sm tabular-nums">
                <span>{s.title} · {fmtDay(s.started_at, tz)}, {fmtTime(s.started_at, tz)}</span>
                <span className="text-muted">{s.hours_counted} of {s.hours_total} hours counted{!isLead && ` · ${s.my_hours} for you`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
