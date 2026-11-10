"use client";
import { useState } from "react";
import { api, post, type Assignment } from "@/lib/api";
import { fmtDue } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Badge, Button, Card, Empty, Notice, PageHeader, Skeleton, useLoad } from "@/components/ui";

const STATUS: Record<Assignment["status"], { label: string; tone: "neutral" | "accent" | "ok" | "warn" }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "accent" },
  submitted: { label: "Waiting for review", tone: "accent" },
  approved: { label: "Approved", tone: "ok" },
  needs_revision: { label: "Needs revision", tone: "warn" },
};

type OpenTask = { task_id: string; title: string; description: string; due_at: string | null };

export default function Tasks() {
  const { me, org, isLead } = useApp();
  const tasks = useLoad(() => api<Assignment[]>(`/orgs/${org.id}/tasks/mine`), [org.id]);
  const open = useLoad(() => api<OpenTask[]>(`/orgs/${org.id}/tasks/open`), [org.id]);
  const [filter, setFilter] = useState<"todo" | "review" | "done">("todo");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const all = tasks.data ?? [];
  const groups = {
    todo: all.filter((t) => ["not_started", "in_progress", "needs_revision"].includes(t.status)),
    review: all.filter((t) => t.status === "submitted"),
    done: all.filter((t) => t.status === "approved"),
  };
  const overdue = all.filter((t) => t.overdue).length;
  const pct = all.length ? Math.round((groups.done.length / all.length) * 100) : 0;

  return (
    <>
      <PageHeader
        title={`Hey, ${me.name.split(" ")[0]}`}
        hint={all.length ? `${groups.todo.length} to do, ${overdue} overdue, ${pct}% approved` : undefined}
        action={isLead && <Button variant="primary" onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New task"}</Button>}
      />
      {error && <div className="mb-3"><Notice>{error}</Notice></div>}
      {creating && <NewTask orgId={org.id} memberLabel={org.member_label} onDone={() => { setCreating(false); tasks.reload(); open.reload(); }} />}

      {all.length > 0 && (
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks approved">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div role="tablist" aria-label="Task filter" className="mb-3 flex gap-1">
        {(["todo", "review", "done"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised"}`}>
            {{ todo: "To do", review: "In review", done: "Approved" }[f]} ({groups[f].length})
          </button>
        ))}
      </div>

      {tasks.error && <Notice>{tasks.error}</Notice>}
      {!tasks.data && !tasks.error && <Skeleton />}
      {tasks.data && groups[filter].length === 0 && (
        <Empty title={filter === "todo" ? "Nothing to do right now" : filter === "review" ? "Nothing waiting for review" : "No approved tasks yet"}>
          {isLead && all.length === 0 ? `Tasks you create are assigned to every ${org.member_label.toLowerCase()}.` : "New tasks show up here as soon as they're assigned."}
        </Empty>
      )}
      <ul className="space-y-2">
        {groups[filter].map((t) => <TaskRow key={t.id} task={t} tz={me.timezone} onChange={tasks.reload} />)}
      </ul>

      {open.data && open.data.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold text-muted">Open tasks anyone can claim</h2>
          <ul className="space-y-2">
            {open.data.map((t) => (
              <li key={t.task_id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-sm text-muted">{t.description || fmtDue(t.due_at, me.timezone)}</p>
                  </div>
                  <Button onClick={() => post(`/tasks/${t.task_id}/claim`).then(() => { tasks.reload(); open.reload(); }, (e) => setError(e.message))}>Claim</Button>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function TaskRow({ task, tz, onChange }: { task: Assignment; tz: string; onChange: () => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSubmit = task.evidence !== "none" && ["not_started", "in_progress", "needs_revision"].includes(task.status);
  const s = STATUS[task.status];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = new FormData();
    body.set("text", text);
    if (file) body.set("file", file);
    try {
      await api(`/assignments/${task.id}/submissions`, { method: "POST", body });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{task.title}</p>
            <p className={`text-sm ${task.overdue ? "font-medium text-danger" : "text-muted"}`}>
              {task.category} · {fmtDue(task.due_at, tz)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {task.overdue && <Badge tone="danger">Overdue</Badge>}
            <Badge tone={s.tone}>{s.label}</Badge>
            {canSubmit && <Button variant={openForm ? "ghost" : "primary"} onClick={() => setOpenForm((v) => !v)}>{openForm ? "Cancel" : task.status === "needs_revision" ? "Resubmit" : "Submit"}</Button>}
          </div>
        </div>
        {task.description && <p className="mt-2 text-sm text-muted">{task.description}</p>}
        {task.status === "needs_revision" && task.feedback && <div className="mt-3"><Notice tone="warn">Reviewer: {task.feedback}</Notice></div>}
        {openForm && canSubmit && (
          <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-4">
            {task.evidence !== "photo" && (
              <label className="block text-sm font-medium">
                Note
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000}
                  className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm font-normal" />
              </label>
            )}
            {task.evidence !== "text" && (
              <label className="block text-sm font-medium">
                {task.evidence === "photo" ? "Photo (JPEG or PNG, up to 8 MB)" : "Attachment (JPEG, PNG, or PDF, optional)"}
                <input type="file" accept={task.evidence === "photo" ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf"}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm font-normal" />
              </label>
            )}
            <p className="text-xs text-muted">Only you and this group&apos;s reviewers can see what you submit.</p>
            {error && <Notice>{error}</Notice>}
            <Button variant="primary" type="submit" busy={busy}>Send for review</Button>
          </form>
        )}
      </Card>
    </li>
  );
}

function NewTask({ orgId, memberLabel, onDone }: { orgId: string; memberLabel: string; onDone: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", category: "General Requirements", due: "", evidence: "any", assign: "all_members" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const field = "mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm font-normal";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(`/orgs/${orgId}/tasks`, {
        title: form.title, description: form.description, category: form.category, evidence: form.evidence,
        assign: form.assign, due_at: form.due ? new Date(form.due).toISOString() : null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the task.");
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium sm:col-span-2">Title<input required maxLength={200} value={form.title} onChange={set("title")} className={field} /></label>
        <label className="text-sm font-medium sm:col-span-2">Details<textarea rows={2} value={form.description} onChange={set("description")} className={field} /></label>
        <label className="text-sm font-medium">Category
          <select value={form.category} onChange={set("category")} className={field}>
            {["Good Morning Messages", "BP Posts", "Study Hours", "Meetings", "Events", "General Requirements"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Due<input type="datetime-local" value={form.due} onChange={set("due")} className={field} /></label>
        <label className="text-sm font-medium">Proof required
          <select value={form.evidence} onChange={set("evidence")} className={field}>
            <option value="any">Note or file</option><option value="text">Written note</option><option value="photo">Photo</option><option value="none">Nothing to submit</option>
          </select>
        </label>
        <label className="text-sm font-medium">Who
          <select value={form.assign} onChange={set("assign")} className={field}>
            <option value="all_members">Every {memberLabel.toLowerCase()}</option><option value="open">Open: anyone can claim it</option>
          </select>
        </label>
        {error && <div className="sm:col-span-2"><Notice>{error}</Notice></div>}
        <div className="sm:col-span-2"><Button variant="primary" type="submit" busy={busy}>Create task</Button></div>
      </form>
    </Card>
  );
}
