"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, post } from "@/lib/api";
import { RESPONSE_LABEL, WEEKDAYS, type BpMine, type BpPing } from "@/lib/bp";
import { fmtClock, fmtMinute, fmtShortDay, fmtTime } from "@/lib/format";
import { CameraCapture, type Capture } from "@/components/camera";
import { useApp } from "@/components/shell";
import { Badge, Button, Card, ListRow, Notice, Skeleton, field, useLoad, useToast } from "@/components/ui";
import { BlockedTimes } from "./blocks";

export function MemberBp() {
  const { org, me } = useApp();
  const mine = useLoad(() => api<BpMine>(`/orgs/${org.id}/bp/me`), [org.id]);
  const d = mine.data;

  // Look again once a minute, so a check-in that opens while the page is up appears.
  useEffect(() => {
    const id = setInterval(mine.reload, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-9">
      {mine.error && <Notice>{mine.error}</Notice>}
      {!d && !mine.error && <Skeleton />}
      {d && d.open && <OpenCheckIn ping={d.open} onDone={mine.reload} />}
      {d && <Today d={d} />}
      <BlockedTimes />
      {d && d.history.length > 0 && (
        <section>
          <h2 className="mb-3.5 font-display text-lg font-semibold tracking-[-0.01em]">Last two weeks</h2>
          <ul className="space-y-2.5">
            {d.history.map((p) => (
              <ListRow key={p.id} bar={p.response === "photo" ? "ok" : p.response === "missed" ? "light" : "mid"}>
                <p className="text-sm font-medium">{fmtShortDay(p.ping_at, me.timezone)}, {fmtTime(p.ping_at, me.timezone)}</p>
                <p className="text-[13px] text-muted">
                  {RESPONSE_LABEL[p.response ?? ""] ?? "Open"}{p.decline_reason ? `: ${p.decline_reason}` : ""}
                </p>
              </ListRow>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Today({ d }: { d: BpMine }) {
  const s = d.settings;
  if (!s.enabled) {
    return (
      <Card>
        <h2 className="font-display text-lg font-semibold">BP check-ins are off</h2>
        <p className="mt-1 text-sm text-muted">Your brothers haven&apos;t turned them on. You can still add the times you can&apos;t take a photo, so they&apos;re ready.</p>
      </Card>
    );
  }
  const days = s.weekdays.length === 7 ? "every day" : s.weekdays.map((i) => WEEKDAYS[i].slice(0, 3)).join(", ");
  return (
    <Card>
      <h2 className="font-display text-lg font-semibold">How check-ins work</h2>
      <p className="mt-1 text-sm text-muted">
        {s.checks_per_day === 1 ? "Once" : `${s.checks_per_day} times`} a day ({days}), at a random time between {fmtMinute(s.window_start_minute)} and{" "}
        {s.window_end_minute === 1440 ? "midnight" : fmtMinute(s.window_end_minute)}, you&apos;ll be asked for a photo in business professional.
        You&apos;ll have {s.response_minutes} minutes. Check-ins skip the times you list below{s.class_blocks ? ", including class" : ". Your brothers allow check-ins during class"}.
      </p>
      <p className="mt-3 text-sm">
        <span className="font-semibold">Today:</span>{" "}
        {d.today.planned === 0 ? "no check-ins." : `${d.today.photos} of ${d.today.planned} done${d.today.still_to_come ? `, ${d.today.still_to_come} still to come` : ""}.`}
      </p>
      <p className="mt-1 text-xs text-muted">
        Make sure you get them: turn on notifications in <Link href="/app/settings" className="font-semibold text-accent underline underline-offset-2">Notifications</Link>.
      </p>
    </Card>
  );
}

function OpenCheckIn({ ping, onDone }: { ping: BpPing; onDone: () => void }) {
  const toast = useToast();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [capture, setCapture] = useState<Capture | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const left = Math.max(0, Math.round((new Date(ping.closes_at).getTime() - nowMs) / 1000));

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);

  async function send(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      toast(done);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send it. Try again.");
      setBusy(false);
    }
  }

  return (
    <section aria-live="assertive" className="rounded-[18px] border border-warn bg-warn-soft p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-warn">BP check-in open</h2>
        <Badge tone="warn"><span className="tabular-nums">{fmtClock(left).slice(3)}</span>&nbsp;left</Badge>
      </div>
      <p className="mt-1 text-sm text-text">Take a photo of yourself in business professional. Your camera only opens when you press the button.</p>
      {!declining && (
        <div className="mt-4 space-y-3">
          <CameraCapture onChange={setCapture} getToken={async () => ping.id} />
          <div className="flex flex-wrap gap-2">
            {capture && (
              <Button variant="primary" busy={busy} onClick={() => {
                const form = new FormData();
                form.set("photo", new File([capture.blob], "bp.jpg", { type: "image/jpeg" }));
                send(() => api(`/bp/pings/${ping.id}/photo`, { method: "POST", body: form }), "Photo sent");
              }}>Send photo</Button>
            )}
            <Button variant="ghost" onClick={() => setDeclining(true)}>I can&apos;t right now</Button>
          </div>
        </div>
      )}
      {declining && (
        <form className="mt-4 space-y-2" onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 3) return setError("Say briefly why, so your brothers know.");
          send(() => post(`/bp/pings/${ping.id}/decline`, { reason }), "Sent. Your brothers will see your reason.");
        }}>
          <label className="block text-sm font-medium">Why can&apos;t you take one right now?
            <input autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={field}
              placeholder="In an interview until 3" />
          </label>
          <p className="text-xs text-muted">This isn&apos;t logged as missed. Your brothers see the reason.</p>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={busy}>Send</Button>
            <Button type="button" variant="ghost" onClick={() => { setDeclining(false); setError(""); }}>Back</Button>
          </div>
        </form>
      )}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
      {left === 0 && <p className="mt-2 text-sm text-muted">This check-in just closed.</p>}
    </section>
  );
}
