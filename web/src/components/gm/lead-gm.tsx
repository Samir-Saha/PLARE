"use client";
import { useState } from "react";
import { api, type GmInbox, type GmMessage, type GmSettings } from "@/lib/api";
import { fmtDate, fmtMinute, fmtTime, minutesBetween } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Avatar, Badge, Button, Card, Empty, ListRow, Notice, Page, PageHeader, SectionHeader, Skeleton, StatTile, field, useLoad } from "@/components/ui";

const shiftDay = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** NME / lead view: every GM for a day in one inbox, with late, wrong-code, and missing flags. */
export function LeadGm() {
  const { org } = useApp();
  const [day, setDay] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const inbox = useLoad(() => api<GmInbox>(`/orgs/${org.id}/gm/inbox${day ? `?day=${day}` : ""}`), [org.id, day]);
  const d = inbox.data;
  const member = org.member_label.toLowerCase();
  const shown = d ? (flaggedOnly ? d.messages.filter((m) => m.flags.length) : d.messages) : [];
  const isToday = d ? d.day === d.today : true;

  return (
    <Page>
      <PageHeader title="GM messages"
        hint={d ? `Due ${fmtMinute(d.due_minute)} every day · ${org.member_label}s get a reminder ${d.reminder_minutes} min before` : undefined}
        action={d && (
          <nav aria-label="Day" className="flex items-center gap-1">
            <Button variant="outline" aria-label="Previous day" onClick={() => setDay(shiftDay(d.day, -1))}>←</Button>
            <span className="min-w-36 text-center text-sm font-medium tabular-nums">{isToday ? "Today" : fmtDate(d.day)}</span>
            <Button variant="outline" aria-label="Next day" disabled={isToday} onClick={() => setDay(shiftDay(d.day, 1))}>→</Button>
          </nav>
        )} />

      {inbox.error && <Notice>{inbox.error}</Notice>}
      {!d && !inbox.error && <Skeleton />}

      {d && (
        <>
          {!d.enabled && <div className="mb-4"><Notice tone="warn">GM messages are turned off. Turn them on in Settings below.</Notice></div>}
          <dl className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={`Sent of ${d.counts.members}`} value={d.counts.sent} />
            <StatTile label="On time, right code" value={d.counts.on_time} />
            <StatTile label="Flagged" value={d.counts.flagged} tone={d.counts.flagged ? "danger" : undefined} />
            <StatTile label={d.past_due ? "Missing" : "Not sent yet"} value={d.past_due ? d.counts.missing : d.not_sent.length}
              tone={d.past_due && d.counts.missing ? "danger" : undefined} />
          </dl>

          <CodeCard key={`${d.day}-${d.code ?? ""}`} orgId={org.id} day={d.day} code={d.code} member={member} onSaved={inbox.reload} />

          <section className="mb-10">
            <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">Inbox · {fmtDate(d.day)}</h2>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} className="size-4 accent-accent" />
                Flagged only
              </label>
            </div>
            {d.messages.length === 0 && <Empty title="No GM messages yet">{isToday ? `They show up here as ${member}s send them.` : "Nobody sent one this day."}</Empty>}
            {d.messages.length > 0 && shown.length === 0 && <Empty title="Nothing flagged">Every message this day was on time with the right code word.</Empty>}
            <ul className="space-y-2.5">
              {shown.map((m) => <MessageRow key={m.id} m={m} tz={d.timezone} />)}
            </ul>
          </section>

          {d.not_sent.length > 0 && (
            <section className="mb-10">
              <SectionHeader title={d.past_due ? `Missing (${d.not_sent.length})` : `Not sent yet (${d.not_sent.length})`} />
              <ul className="flex flex-wrap gap-2">
                {d.not_sent.map((p) => (
                  <li key={p.user_id} className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm ${d.past_due ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-surface"}`}>
                    <Avatar name={p.name} className="size-6 text-[9px]" />{p.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <SettingsCard key={`${d.due_minute}-${d.reminder_minutes}-${d.enabled}-${d.timezone}`} orgId={org.id} s={d} member={member} onSaved={inbox.reload} />
        </>
      )}
    </Page>
  );
}

function MessageRow({ m, tz }: { m: GmMessage; tz: string }) {
  const flagged = m.flags.length > 0;
  return (
    <ListRow bar={flagged ? "danger" : "ok"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={m.user_name} className="size-8 text-[10px]" />
          <div className="min-w-0">
            <p className="font-medium">{m.user_name}</p>
            <p className="text-[13px] text-muted tabular-nums">
              {fmtTime(m.submitted_at, tz)}{m.late ? ` · ${minutesBetween(m.due_at, m.submitted_at)} min late` : ""}
            </p>
          </div>
        </div>
        <span className="flex flex-wrap gap-1">
          {!flagged && <Badge tone="ok">On time</Badge>}
          {m.flags.includes("late") && <Badge tone="danger">Late</Badge>}
          {m.flags.includes("wrong_code") && <Badge tone="danger">Wrong code</Badge>}
          {m.code_status === "unset" && <Badge>Code not checked</Badge>}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{m.goal}</p>
      <p className="mt-1.5 text-[13px] text-muted">
        Code word: <span className={`font-mono ${m.code_status === "wrong" ? "text-danger" : "text-text"}`}>{m.code_given}</span>
      </p>
    </ListRow>
  );
}

function CodeCard({ orgId, day, code, member, onSaved }: { orgId: string; day: string; code: string | null; member: string; onSaved: () => void }) {
  const [value, setValue] = useState(code ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return setMsg({ tone: "danger", text: "Enter a code word first." });
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/gm/codes/${day}`, { method: "PUT", body: JSON.stringify({ code: value }) });
      onSaved();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof Error ? err.message : "Couldn't save the code word." });
      setBusy(false);
    }
  }

  return (
    <Card className="mb-10">
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-60 text-sm font-medium">Code word for {fmtDate(day)}
          <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={64} autoComplete="off" spellCheck={false} className={`${field} font-mono`} />
        </label>
        <Button type="submit" variant="primary" busy={busy}>{code ? "Update" : "Post code word"}</Button>
      </form>
      <p className="mt-2 text-[13px] text-muted">
        {code
          ? `${member[0].toUpperCase() + member.slice(1)}s see this in PLARE on ${fmtDate(day)}, not before. Matching ignores capital letters and extra spaces.`
          : `Not posted yet. Posting today's word notifies ${member}s who haven't sent, and messages already sent get rechecked.`}
      </p>
      {msg && <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </Card>
  );
}

function SettingsCard({ orgId, s, member, onSaved }: { orgId: string; s: GmSettings; member: string; onSaved: () => void }) {
  const toClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const [due, setDue] = useState(toClock(s.due_minute));
  const [remind, setRemind] = useState(s.reminder_minutes);
  const [enabled, setEnabled] = useState(s.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : s.timezone;

  async function save(e: React.FormEvent, extra: Record<string, unknown> = {}) {
    e.preventDefault();
    const [h, m] = due.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return setError("Pick a due time.");
    setBusy(true);
    setError("");
    try {
      await api(`/orgs/${orgId}/gm/settings`, { method: "PATCH", body: JSON.stringify({ due_minute: h * 60 + m, reminder_minutes: remind, enabled, ...extra }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save settings.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg font-semibold">Settings</h2>
      <p className="text-sm text-muted">Times are in {s.timezone.replace("_", " ")}. {member[0].toUpperCase() + member.slice(1)}s get an in-app reminder if they haven&apos;t sent one yet.</p>
      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">Due at
          <input type="time" value={due} onChange={(e) => setDue(e.target.value)} required className={field} />
        </label>
        <label className="text-sm font-medium">Reminder
          <select value={remind} onChange={(e) => setRemind(Number(e.target.value))} className={field}>
            {[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} min before</option>)}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-accent" />
          GM messages on
        </label>
        <Button type="submit" variant="primary" busy={busy}>Save</Button>
        {browserTz && browserTz !== s.timezone && (
          <Button type="button" variant="ghost" disabled={busy} onClick={(e) => save(e, { timezone: browserTz })}>Use {browserTz.replace("_", " ")}</Button>
        )}
      </form>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </Card>
  );
}
