"use client";
import { useState } from "react";
import { api, post, type GmMessage, type GmMine } from "@/lib/api";
import { fmtDate, fmtMinute, fmtTime, minutesBetween } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Badge, Button, Card, Empty, ListRow, Notice, Page, PageHeader, SectionHeader, Skeleton, field, useLoad } from "@/components/ui";

/** Pledge view: send today's goal and code word, see whether it counted, and look back two weeks. */
export function MemberGm() {
  const { org } = useApp();
  const gm = useLoad(() => api<GmMine>(`/orgs/${org.id}/gm/me`), [org.id]);
  const [goal, setGoal] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());

  const d = gm.data;
  const pastDue = d ? now > new Date(d.due_at).getTime() : false;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim()) return setError("Write your goal for today.");
    if (!code.trim()) return setError("Enter the code word your NME gave you.");
    setBusy(true);
    setError("");
    try {
      await post(`/orgs/${org.id}/gm`, { goal, code });
      setGoal("");
      setCode("");
      window.dispatchEvent(new Event("plare:notifications"));
      gm.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your GM message. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader title="GM message"
        hint={d ? `${fmtDate(d.day)} · due ${fmtMinute(d.due_minute)}, reminder at ${fmtTime(d.reminder_at, d.timezone)} (${d.timezone.replace("_", " ")})` : undefined} />

      {gm.error && <Notice>{gm.error}</Notice>}
      {!d && !gm.error && <Skeleton rows={2} />}

      {d && !d.enabled && <Empty title="GM messages are off">Your NME turned GM messages off for this group.</Empty>}

      {d?.enabled && !d.today && (
        <section aria-label="Today's code word" className="mb-6 max-w-xl rounded-[18px] bg-accent px-5 py-4 text-accent-fg">
          <p className="text-[13px] text-on-accent-muted">Today&apos;s code word</p>
          {d.code
            ? <p className="mt-1 font-mono text-2xl font-semibold tracking-wide">{d.code}</p>
            : <p className="mt-1 text-[15px]">Not posted yet. Your NME posts it here, and you&apos;ll get a notification when it&apos;s up.</p>}
        </section>
      )}

      {d?.enabled && d.today && <Sent m={d.today} tz={d.timezone} />}

      {d?.enabled && !d.today && (
        <Card className="mb-10 max-w-xl">
          <form onSubmit={send} className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-semibold">Send today&apos;s GM</h2>
              <p className="text-sm text-muted">Your goal for the day and today&apos;s code word, typed exactly. You can send one per day, so check it before you send.</p>
            </div>
            {pastDue && <Notice tone="warn">It&apos;s past {fmtMinute(d.due_minute)}. You can still send it, but it will be marked late.</Notice>}
            <label className="block text-sm font-medium">Goal for today
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} maxLength={1000} required
                placeholder="e.g. Finish the stats problem set and go to office hours." className={field} />
            </label>
            <label className="block text-sm font-medium">Code word
              <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={64} required autoComplete="off"
                autoCapitalize="none" spellCheck={false} className={field} />
            </label>
            {error && <Notice>{error}</Notice>}
            <Button type="submit" variant="primary" busy={busy}>Send GM</Button>
          </form>
        </Card>
      )}

      {d && d.history.filter((h) => h.day !== d.day).length > 0 && (
        <section>
          <SectionHeader title="Past two weeks" />
          <ul className="space-y-2.5">
            {d.history.filter((h) => h.day !== d.day).map((m) => (
              <ListRow key={m.id} bar={m.flags.length ? "danger" : "ok"} end={<Status m={m} />}>
                <p className="text-[15px] font-semibold leading-snug">{fmtDate(m.day)}</p>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">Sent {fmtTime(m.submitted_at, d.timezone)} · {m.goal}</p>
              </ListRow>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}

function Sent({ m, tz }: { m: GmMessage; tz: string }) {
  return (
    <Card className="mb-10 max-w-xl">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold">Today&apos;s GM is in</h2>
          <p className="text-sm text-muted tabular-nums">Sent at {fmtTime(m.submitted_at, tz)}</p>
        </div>
        <Status m={m} />
      </div>
      <p className="mt-3 whitespace-pre-wrap rounded-xl bg-raised p-3 text-sm">{m.goal}</p>
      <p className="mt-3 text-sm text-muted">
        {m.code_status === "ok" && "Code word matched."}
        {m.code_status === "wrong" && "The code word didn't match today's. Your NME will see it flagged."}
        {m.code_status === "unset" && "Your NME hadn't posted today's code word yet. It will be checked once they do."}
        {m.late && ` Sent ${minutesBetween(m.due_at, m.submitted_at)} min after the deadline.`}
      </p>
    </Card>
  );
}

function Status({ m }: { m: GmMessage }) {
  if (!m.flags.length) return <Badge tone="ok">On time</Badge>;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {m.flags.includes("late") && <Badge tone="danger">Late</Badge>}
      {m.flags.includes("wrong_code") && <Badge tone="danger">Wrong code</Badge>}
    </span>
  );
}
