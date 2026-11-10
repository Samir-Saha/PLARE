"use client";
import { useState } from "react";
import { api, fileUrl, post, type Progress, type SubmissionRow } from "@/lib/api";
import { fmtDay, fmtTime, fmtToday } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Avatar, Badge, Button, Empty, ListRow, Notice, PageHeader, Skeleton, StatTile, barFor, useLoad, Page } from "@/components/ui";


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

      <h2 className="mb-3.5 font-display text-lg font-semibold tracking-[-0.01em]">Queue</h2>

      {queue.error && <Notice>{queue.error}</Notice>}
      {!queue.data && !queue.error && <Skeleton />}
      {queue.data?.length === 0 && <Empty title="You're caught up">New submissions land here the moment they come in.</Empty>}
      <ul className="space-y-2.5">
        {queue.data?.map((s) => <Row key={s.id} s={s} tz={me.timezone} onDone={reload} />)}
      </ul>

      {p && p.members.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3.5 font-display text-lg font-semibold tracking-[-0.01em]">Progress by {org.member_label.toLowerCase()}</h2>
          <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-raised text-left text-[13px] text-muted">
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
                      <span className="flex items-center gap-2.5"><Avatar name={m.name} className="size-7 text-[10px]" />{m.name}</span>
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
  const [feedback, setFeedback] = useState("");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approved" | "needs_revision") {
    if (decision === "needs_revision" && !feedback.trim()) return setError("Say what needs to change before sending it back.");
    setBusy(true);
    try {
      await post(`/submissions/${s.id}/review`, { decision, feedback });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the review.");
      setBusy(false);
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
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium">{s.user_name} <span className="font-normal text-muted">submitted</span> {s.task_title}</p>
            <p className="text-sm text-muted">{s.category} · {fmtDay(s.created_at, tz)}, {fmtTime(s.created_at, tz)}</p>
          </div>
          <Badge tone="accent">Pending</Badge>
        </div>
        {s.text && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-raised p-3 text-sm">{s.text}</p>}
        {s.has_file && !image && <Button className="mt-2" onClick={openFile}>View {s.file_type?.startsWith("image/") ? "photo" : "attachment"}</Button>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt={`Submission from ${s.user_name}`} className="mt-2 max-h-96 rounded-xl border border-line" />}
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback (required to request a revision)" aria-label="Feedback"
            className="min-h-10 min-w-0 flex-1 basis-56 rounded-xl border border-line bg-surface px-3 text-sm" />
          <Button variant="primary" busy={busy} onClick={() => decide("approved")}>Approve</Button>
          <Button disabled={busy} onClick={() => decide("needs_revision")}>Request revision</Button>
        </div>
        {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </ListRow>
  );
}
