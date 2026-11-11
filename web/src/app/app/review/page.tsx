"use client";
import { useState } from "react";
import { api, fileUrl, post, type Progress, type SubmissionRow } from "@/lib/api";
import { fmtDay, fmtTime, fmtToday } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Avatar, Button, Empty, ListRow, Notice, PageHeader, Skeleton, StatTile, barFor, field, useLoad, useToast, Page } from "@/components/ui";


export default function Review() {
  const { me, org, isLead } = useApp();
  const queue = useLoad(() => (isLead ? api<SubmissionRow[]>(`/orgs/${org.id}/review`) : Promise.resolve([])), [org.id, isLead]);
  const progress = useLoad(() => (isLead ? api<Progress>(`/orgs/${org.id}/progress`) : Promise.resolve(null)), [org.id, isLead]);
  const reload = () => { queue.reload(); progress.reload(); };

  if (!isLead) return <Page><Empty title="Reviewers only">This page is for {org.lead_label.toLowerCase()}s.</Empty></Page>;
  const p = progress.data;

  return (
    <Page>
      <PageHeader title="Review" hint={`${fmtToday(me.timezone)} · every submission in one queue, oldest first`} />
      {p && (
        <dl className="mb-9 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Assigned" value={p.total} />
          <StatTile label="Approved" value={p.approved} />
          <StatTile label="Waiting on you" value={p.pending_review} />
          <StatTile label="Overdue" value={p.overdue} tone={p.overdue ? "danger" : undefined} />
        </dl>
      )}

      <h2 className="mb-3.5 font-display text-xl font-bold tracking-[-0.01em]">Queue</h2>

      {queue.error && <Notice>{queue.error}</Notice>}
      {!queue.data && !queue.error && <Skeleton />}
      {queue.data?.length === 0 && <Empty title="You're caught up">New submissions land here the moment they come in.</Empty>}
      <ul className="space-y-2.5">
        {queue.data?.map((s) => <Row key={s.id} s={s} tz={me.timezone} onDone={reload} />)}
      </ul>

      {p && p.members.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3.5 font-display text-xl font-bold tracking-[-0.01em]">Progress by {org.member_label.toLowerCase()}</h2>
          <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-raised text-left text-[14px] text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-normal">Name</th>
                  <th scope="col" className="px-3 py-3 text-right font-normal">Approved</th>
                  <th scope="col" className="px-3 py-3 text-right font-normal">In review</th>
                  <th scope="col" className="px-3 py-3 text-right font-normal">Revise</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.members.map((m) => (
                  <tr key={m.user_id}>
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      <span className="flex items-center gap-2.5"><Avatar name={m.name} className="size-7 text-[11px]" />{m.name}</span>
                    </th>
                    <td className="px-3 text-right">{m.approved}/{m.total}</td>
                    <td className="px-3 text-right">{m.submitted}</td>
                    <td className={`px-3 text-right ${m.needs_revision ? "text-warn" : ""}`}>{m.needs_revision}</td>
                    <td className={`px-4 text-right ${m.overdue ? "font-semibold text-danger" : ""}`}>{m.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Page>
  );
}

function Row({ s, tz, onDone }: { s: SubmissionRow; tz: string; onDone: () => void }) {
  const toast = useToast();
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "approved" | "needs_revision">("");

  async function decide(decision: "approved" | "needs_revision") {
    if (decision === "needs_revision" && !feedback.trim()) return setError("Say what needs to change before sending it back.");
    setBusy(decision);
    setError("");
    try {
      await post(`/submissions/${s.id}/review`, { decision, feedback });
      toast(decision === "approved" ? `Approved ${s.user_name}'s ${s.task_title}` : `Sent back to ${s.user_name} with feedback`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the review.");
      setBusy("");
    }
  }

  async function openFile() {
    try {
      const url = await fileUrl(`/submissions/${s.id}/file`);
      if (s.file_type?.startsWith("image/")) setImage(url);
      else window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the file.");
    }
  }

  return (
    <ListRow bar={barFor(s.category)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-[15px] font-medium leading-snug">{s.user_name} <span className="font-normal text-muted">submitted</span> {s.task_title}</p>
          <p className="mt-0.5 text-[13px] text-muted">{s.category} · {fmtDay(s.created_at, tz)}, {fmtTime(s.created_at, tz)}</p>
        </div>
        {!revising && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" className="min-h-9" disabled={!!busy} onClick={() => setRevising(true)}>Request revision</Button>
            <Button variant="primary" className="min-h-9" busy={busy === "approved"} disabled={!!busy} onClick={() => decide("approved")}>Approve</Button>
          </div>
        )}
      </div>
      {s.text && <p className="mt-2.5 whitespace-pre-wrap rounded-xl bg-raised px-3 py-2.5 text-sm">{s.text}</p>}
      {s.has_file && !image && <Button variant="outline" className="mt-2.5 min-h-9" onClick={openFile}>View {s.file_type?.startsWith("image/") ? "photo" : "attachment"}</Button>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && <img src={image} alt={`Submission from ${s.user_name}`} className="mt-2.5 max-h-96 max-w-full rounded-xl border border-line" />}
      {revising && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); decide("needs_revision"); }}>
          <label className="block text-sm font-medium">
            What needs to change?
            <textarea autoFocus rows={2} value={feedback} onChange={(e) => { setFeedback(e.target.value); setError(""); }}
              aria-invalid={!!error} className={field} placeholder="Be specific, so they can fix it in one try." />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setRevising(false); setError(""); }}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy === "needs_revision"}>Send back</Button>
          </div>
        </form>
      )}
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </ListRow>
  );
}
