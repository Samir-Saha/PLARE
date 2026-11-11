"use client";
import { useState } from "react";
import { post, type SubmissionCheck, type SubmissionRow } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { Badge, Button } from "@/components/ui";

/** At or above this, the score is highlighted and the reviewer gets the "can be wrong" reminder. */
const HIGH = 0.5;

const pct = (score: number) => `${Math.round(score * 100)}%`;

/** The AI score as the submitter sees it, under their own task. */
export function AiCheckNote({ check, own }: { check: SubmissionCheck; own?: boolean }) {
  if (check.ai_status === "pending") return <p className="mt-2 text-xs text-muted">Checking your writing for AI…</p>;
  if (check.ai_status !== "done" || check.ai_score == null) return null;
  const high = check.ai_score >= HIGH;
  return (
    <p className={`mt-2 text-xs ${high ? "text-warn" : "text-muted"}`}>
      AI check: {pct(check.ai_score)} chance {own ? "your submission" : "this"} is AI-written.
      {high && own && " Detectors can be wrong. If you wrote it yourself, tell your reviewer."}
    </p>
  );
}

/** Badges for a reviewer: whether a camera-only photo was taken in the app, and the AI score. */
export function ReviewChecks({ s, tz, onChange }: { s: SubmissionRow; tz: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function rerun() {
    setBusy(true);
    setError("");
    try {
      await post(`/submissions/${s.id}/ai-check`);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run the check.");
    } finally {
      setBusy(false);
    }
  }

  const camera = s.evidence === "camera" && s.has_file;
  const ai = s.ai_status;
  const high = ai === "done" && s.ai_score != null && s.ai_score >= HIGH;
  if (!camera && ai === "skipped") return null;

  return (
    <div className="mt-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {camera && (s.captured_in_app && s.captured_at
          ? <Badge tone="ok">Taken in the app at {fmtTime(s.captured_at, tz)}</Badge>
          : <Badge tone="warn">Not taken with the in-app camera</Badge>)}
        {ai === "pending" && <Badge>Checking for AI writing…</Badge>}
        {ai === "done" && s.ai_score != null && (
          <Badge tone={high ? "warn" : "neutral"}>AI check: {pct(s.ai_score)} chance AI-written</Badge>
        )}
        {ai === "too_short" && <Badge>Too short to check for AI</Badge>}
        {ai === "not_configured" && <Badge>AI check not set up</Badge>}
        {ai === "error" && <Badge tone="warn">AI check failed</Badge>}
        {(ai === "error" || ai === "not_configured") && (
          <Button variant="ghost" className="min-h-8 px-2 text-xs" busy={busy} onClick={rerun}>Run check again</Button>
        )}
      </div>
      {high && (
        <p className="text-xs text-muted">
          AI detectors are often wrong, especially for people writing in a second language, and this free one misses a lot of newer AI writing. Talk to {s.user_name} before acting on this.
        </p>
      )}
      {ai === "error" && s.ai_error && <p className="text-xs text-muted">{s.ai_error}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
