"use client";
import { useState } from "react";
import { api, fileUrl, post, type SubmissionRow } from "@/lib/api";
import { fmtDay, fmtTime } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Badge, Button, Card, Empty, Notice, PageHeader, Skeleton, useLoad } from "@/components/ui";

type Progress = { total: number; approved: number; pending_review: number; overdue: number; members: { user_id: string; name: string; total: number; approved: number; submitted: number; needs_revision: number; overdue: number }[] };

export default function Review() {
  const { me, org, isLead } = useApp();
  const queue = useLoad(() => (isLead ? api<SubmissionRow[]>(`/orgs/${org.id}/review`) : Promise.resolve([])), [org.id, isLead]);
  const progress = useLoad(() => (isLead ? api<Progress>(`/orgs/${org.id}/progress`) : Promise.resolve(null)), [org.id, isLead]);
  const reload = () => { queue.reload(); progress.reload(); };

  if (!isLead) return <Empty title="Reviewers only">This page is for {org.lead_label.toLowerCase()}s.</Empty>;
  const p = progress.data;

  return (
    <>
      <PageHeader title="Review" hint="Every submission in one queue, oldest first." />
      {p && (
        <dl className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Assigned", p.total], ["Approved", p.approved], ["Waiting on you", p.pending_review], ["Overdue", p.overdue]].map(([k, v]) => (
            <Card key={k} className="!p-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{v}</dd>
            </Card>
          ))}
        </dl>
      )}

      {queue.error && <Notice>{queue.error}</Notice>}
      {!queue.data && !queue.error && <Skeleton />}
      {queue.data?.length === 0 && <Empty title="You're caught up">New submissions land here the moment they come in.</Empty>}
      <ul className="space-y-2">
        {queue.data?.map((s) => <Row key={s.id} s={s} tz={me.timezone} onDone={reload} />)}
      </ul>

      {p && p.members.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Progress by {org.member_label.toLowerCase()}</h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="px-4 py-2 font-medium">Name</th><th className="px-2 font-medium">Approved</th><th className="px-2 font-medium">In review</th><th className="px-2 font-medium">Revise</th><th className="px-2 font-medium">Overdue</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.members.map((m) => (
                  <tr key={m.user_id}>
                    <th scope="row" className="px-4 py-2 text-left font-medium">{m.name}</th>
                    <td className="px-2 tabular-nums">{m.approved}/{m.total}</td>
                    <td className="px-2 tabular-nums">{m.submitted}</td>
                    <td className="px-2 tabular-nums">{m.needs_revision}</td>
                    <td className={`px-2 tabular-nums ${m.overdue ? "font-medium text-danger" : ""}`}>{m.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
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
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">{s.user_name} <span className="font-normal text-muted">submitted</span> {s.task_title}</p>
            <p className="text-sm text-muted">{s.category} · {fmtDay(s.created_at, tz)}, {fmtTime(s.created_at, tz)}</p>
          </div>
          <Badge tone="accent">Pending</Badge>
        </div>
        {s.text && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-raised p-3 text-sm">{s.text}</p>}
        {s.has_file && !image && <Button className="mt-2" onClick={openFile}>View {s.file_type?.startsWith("image/") ? "photo" : "attachment"}</Button>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt={`Submission from ${s.user_name}`} className="mt-2 max-h-96 rounded-lg border border-line" />}
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback (required to request a revision)" aria-label="Feedback"
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
          <Button variant="primary" busy={busy} onClick={() => decide("approved")}>Approve</Button>
          <Button disabled={busy} onClick={() => decide("needs_revision")}>Request revision</Button>
        </div>
        {error && <div className="mt-2"><Notice>{error}</Notice></div>}
      </Card>
    </li>
  );
}
