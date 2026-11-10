"use client";
import { useState } from "react";
import { api, post, type Assignment } from "@/lib/api";
import { fmtDue, fmtToday } from "@/lib/format";
import { useApp } from "@/components/shell";
import { IconClose } from "@/components/icons";
import { MyPlan, SuggestOwner } from "@/components/plan";
import {
  Badge, Button, Card, CheckButton, CheckMark, Empty, ListRow, Notice, PageHeader, Skeleton, SummaryCard, SummaryRow, field, useLoad, type Bar,
} from "@/components/ui";

const STATUS: Record<Assignment["status"], { label: string; tone: "neutral" | "accent" | "ok" | "warn" }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "accent" },
  submitted: { label: "Waiting for review", tone: "accent" },
  approved: { label: "Approved", tone: "ok" },
  needs_revision: { label: "Needs revision", tone: "warn" },
};

// Row bar color follows task priority: high is navy, normal mid blue, low light blue.
const PRIORITY_BAR: Record<string, Bar> = { high: "navy", normal: "mid", low: "light" };

type OpenTask = { task_id: string; title: string; description: string; due_at: string | null };

export default function Tasks() {
  const { me, org, isLead } = useApp();
  const tasks = useLoad(() => api<Assignment[]>(`/orgs/${org.id}/tasks/mine`), [org.id]);
  const open = useLoad(() => api<OpenTask[]>(`/orgs/${org.id}/tasks/open`), [org.id]);
  const [filter, setFilter] = useState<"todo" | "review" | "done">("todo");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [planVersion, setPlanVersion] = useState(0);
  const refreshAll = () => { tasks.reload(); open.reload(); setPlanVersion((v) => v + 1); };

  const all = tasks.data ?? [];
  const groups = {
    todo: all.filter((t) => ["not_started", "in_progress", "needs_revision"].includes(t.status)),
    review: all.filter((t) => t.status === "submitted"),
    done: all.filter((t) => t.status === "approved"),
  };
  const overdue = all.filter((t) => t.overdue).length;
  const pct = all.length ? Math.round((groups.done.length / all.length) * 100) : 0;
  const share = (n: number) => (all.length ? (n / all.length) * 100 : 0);

  return (
    <>
      <PageHeader
        title={`Hello, ${me.name.split(" ")[0]}`}
        hint={fmtToday(me.timezone)}
        action={isLead && <Button variant="primary" onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New task"}</Button>}
      />
      {error && <div className="mb-3"><Notice>{error}</Notice></div>}
      {creating && <NewTask orgId={org.id} memberLabel={org.member_label} onDone={() => { setCreating(false); refreshAll(); }} />}

      {/* TODO(people): summary cards can show an avatar stack, but this page only loads the viewer's own tasks. */}
      {all.length > 0 && (
        <SummaryRow>
          <SummaryCard tone="navy" title="Approved" stat={`${groups.done.length} of ${all.length} tasks signed off`} pct={pct} />
          <SummaryCard tone="mid" title="In review" stat={`${groups.review.length} waiting on a reviewer`} pct={share(groups.review.length)} />
          <SummaryCard tone="light" title="To do" stat={`${groups.todo.length} open, ${overdue} overdue`} pct={share(groups.todo.length)} />
        </SummaryRow>
      )}

      <MyPlan orgId={org.id} version={planVersion} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">Your tasks</h2>
        <div role="tablist" aria-label="Task filter" className="flex gap-1 rounded-full bg-raised p-1">
          {(["todo", "review", "done"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`min-h-9 rounded-full px-3.5 text-sm font-medium tabular-nums transition-colors ${filter === f ? "bg-accent text-accent-fg" : "text-muted hover:text-text"}`}>
              {{ todo: "To do", review: "In review", done: "Approved" }[f]} ({groups[f].length})
            </button>
          ))}
        </div>
      </div>

      {tasks.error && <Notice>{tasks.error}</Notice>}
      {!tasks.data && !tasks.error && <Skeleton />}
      {tasks.data && groups[filter].length === 0 && (
        <Empty title={filter === "todo" ? "Nothing to do right now" : filter === "review" ? "Nothing waiting for review" : "No approved tasks yet"}>
          {isLead && all.length === 0 ? `Tasks you create are assigned to every ${org.member_label.toLowerCase()}.` : "New tasks show up here as soon as they're assigned."}
        </Empty>
      )}
      <ul className="space-y-2">
        {groups[filter].map((t) => <TaskRow key={t.id} task={t} tz={me.timezone} onChange={refreshAll} />)}
      </ul>

      {open.data && open.data.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-[-0.01em]">Open tasks anyone can claim</h2>
          <ul className="space-y-2">
            {open.data.map((t) => (
              <OpenTaskRow key={t.task_id} task={t} tz={me.timezone} isLead={isLead} onChange={refreshAll} onError={setError} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function OpenTaskRow({ task, tz, isLead, onChange, onError }: { task: OpenTask; tz: string; isLead: boolean; onChange: () => void; onError: (m: string) => void }) {
  const [suggesting, setSuggesting] = useState(false);
  return (
    <ListRow bar="light">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{task.title}</p>
          <p className="text-sm text-muted">{task.description ? `${task.description} · ` : ""}{fmtDue(task.due_at, tz)}</p>
        </div>
        <div className="flex gap-2">
          {isLead && (
            <Button variant={suggesting ? "ghost" : "secondary"} onClick={() => setSuggesting((v) => !v)}>
              {suggesting ? "Hide" : "Suggest owner"}
            </Button>
          )}
          <Button onClick={() => post(`/tasks/${task.task_id}/claim`).then(onChange, (e) => onError(e.message))}>Claim</Button>
        </div>
      </div>
      {suggesting && <SuggestOwner taskId={task.task_id} onAssigned={onChange} />}
    </ListRow>
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
    <ListRow bar={PRIORITY_BAR[task.priority] ?? "mid"}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{task.title}</p>
            <p className={`text-sm ${task.overdue ? "font-medium text-danger" : "text-muted"}`}>
              {task.category} · {fmtDue(task.due_at, tz)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {task.overdue && <Badge tone="danger">Overdue</Badge>}
              <Badge tone={s.tone}>{s.label}</Badge>
            </div>
          </div>
          {canSubmit ? (
            <CheckButton active={openForm} onClick={() => setOpenForm((v) => !v)} aria-expanded={openForm}
              label={openForm ? "Cancel" : `${task.status === "needs_revision" ? "Resubmit" : "Submit"} ${task.title}`}>
              {openForm ? <IconClose /> : undefined}
            </CheckButton>
          ) : task.status === "approved" ? <CheckMark label="Approved" /> : null}
        </div>
        {task.description && <p className="mt-2 text-sm text-muted">{task.description}</p>}
        {task.status === "needs_revision" && task.feedback && <div className="mt-3"><Notice tone="warn">Reviewer: {task.feedback}</Notice></div>}
        {openForm && canSubmit && (
          <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-4">
            {task.evidence !== "photo" && (
              <label className="block text-sm font-medium">
                Note
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000}
                  className={field} />
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
    </ListRow>
  );
}

function NewTask({ orgId, memberLabel, onDone }: { orgId: string; memberLabel: string; onDone: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", category: "General Requirements", due: "", evidence: "any", assign: "all_members", estimate: "30" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(`/orgs/${orgId}/tasks`, {
        title: form.title, description: form.description, category: form.category, evidence: form.evidence,
        assign: form.assign, due_at: form.due ? new Date(form.due).toISOString() : null, estimate_minutes: Number(form.estimate),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the task.");
      setBusy(false);
    }
  }

  return (
    <Card className="mb-8">
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium sm:col-span-2">Title<input required maxLength={200} value={form.title} onChange={set("title")} className={field} /></label>
        <label className="text-sm font-medium sm:col-span-2">Details<textarea rows={2} value={form.description} onChange={set("description")} className={field} /></label>
        <label className="text-sm font-medium">Category
          <select value={form.category} onChange={set("category")} className={field}>
            {["Good Morning Messages", "BP Posts", "Study Hours", "Meetings", "Events", "General Requirements"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Due<input type="datetime-local" value={form.due} onChange={set("due")} className={field} /></label>
        <label className="text-sm font-medium">Time needed
          <select value={form.estimate} onChange={set("estimate")} className={field}>
            {[["15", "15 min"], ["30", "30 min"], ["60", "1 hour"], ["90", "1.5 hours"], ["120", "2 hours"], ["180", "3 hours"], ["300", "5 hours"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
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
