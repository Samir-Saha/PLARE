"use client";
import { useState } from "react";
import { api, post, type DeadlineAlarm } from "@/lib/api";
import { Button, Notice, useLoad, useToast } from "@/components/ui";

export function AlarmBanner() {
  const alarms = useLoad(() => api<DeadlineAlarm[]>("/alarms/mine"), []);
  const ringing = (alarms.data ?? []).filter((a) => a.status === "ringing");
  if (ringing.length === 0) return null;
  return (
    <div className="border-b border-danger/30 bg-danger-soft px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {ringing.map((a) => <AlarmSolve key={a.id} alarm={a} onDone={alarms.reload} />)}
      </div>
    </div>
  );
}

function AlarmSolve({ alarm, onDone }: { alarm: DeadlineAlarm; onDone: () => void }) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function solve(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await post(`/alarms/${alarm.id}/solve`, { answer: Number(answer) });
      toast(`Alarm for ${alarm.task_title} is off`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That wasn't the right answer.");
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true); setError("");
    try {
      await post(`/alarms/${alarm.id}/dismiss`, {});
      toast("Alarm dismissed");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't dismiss the alarm.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={solve} className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-sm font-medium text-danger">
        Alarm: {alarm.task_title}. {alarm.prompt} You can also dismiss it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input required inputMode="numeric" pattern="-?[0-9]*" value={answer} onChange={(e) => setAnswer(e.target.value)}
          aria-label={`Answer for ${alarm.task_title}`}
          className="h-10 w-20 rounded-lg border border-line bg-surface px-2 text-center text-sm" />
        <Button type="submit" variant="primary" busy={busy}>Turn off</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={dismiss}>Dismiss</Button>
      </div>
      {error && <Notice>{error}</Notice>}
    </form>
  );
}

export function AlarmOptIn({ assignmentId, dueAt, canArm }: { assignmentId: string; dueAt: string | null; canArm: boolean }) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  if (!dueAt || !canArm || armed) {
    return armed ? <p className="mt-2 text-xs text-muted">Alarm is on. You&apos;ll get a math problem when this is due. You can dismiss it anytime.</p> : null;
  }
  return (
    <div className="mt-2">
      {error && <Notice>{error}</Notice>}
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try {
          await api(`/assignments/${assignmentId}/alarm`, { method: "POST" });
          setArmed(true);
          toast("Alarm set for this deadline");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't set the alarm.");
        } finally { setBusy(false); }
      }} className="text-xs font-semibold text-accent-2 hover:underline disabled:opacity-60">
        {busy ? "Setting alarm…" : "Set an alarm for this deadline"}
      </button>
    </div>
  );
}
