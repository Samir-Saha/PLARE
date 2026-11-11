"use client";
import { useState } from "react";
import { api, post, type Assignment } from "@/lib/api";
import { fmtDue } from "@/lib/format";
import { IconClose } from "@/components/icons";
import { Button, Card, CheckButton, CheckMark, Empty, ListRow, Notice, Skeleton, field, useToast, type Bar } from "@/components/ui";
import { SuggestOwner } from "@/components/plan";
import { CameraCapture, type Capture } from "@/components/camera";
import { AiCheckNote } from "@/components/checks";

const STATUS: Record<Assignment["status"], { label: string }> = {
  not_started: { label: "Not started" },
  in_progress: { label: "In progress" },
  submitted: { label: "Waiting for review" },
  approved: { label: "Approved" },
  needs_revision: { label: "Needs revision" },
};

// Row bar color follows task priority: high is navy, normal mid blue, low light blue.
const PRIORITY_BAR: Record<string, Bar> = { high: "navy", normal: "mid", low: "light" };

export type OpenTask = { task_id: string; title: string; description: string; due_at: string | null };

type Loaded<T> = { data: T | null; error: string; reload: () => void };

/** The viewer's own tasks with To do / In review / Approved tabs, plus open tasks to claim. */
export function TasksSection({ tasks, open, tz, isLead, memberLabel, title = "Your tasks", onChange }: {
  tasks: Loaded<Assignment[]>; open: Loaded<OpenTask[]>; tz: string; isLead: boolean; memberLabel: string; title?: string;
  /** Called after any task changes, so other panels (like Your plan) can refresh. */
  onChange?: () => void;
}) {
  const [filter, setFilter] = useState<"todo" | "review" | "done">("todo");
  const [error, setError] = useState("");
  const changed = () => { tasks.reload(); open.reload(); onChange?.(); };
  const all = tasks.data ?? [];
  const groups = {
    todo: all.filter((t) => ["not_started", "in_progress", "needs_revision"].includes(t.status)),
    review: all.filter((t) => t.status === "submitted"),
    done: all.filter((t) => t.status === "approved"),
  };

  return (
    <section>
      {error && <div className="mb-3"><Notice>{error}</Notice></div>}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        <div role="tablist" aria-label="Task filter" className="flex gap-1 rounded-xl bg-raised p-1">
          {(["todo", "review", "done"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`min-h-9 rounded-[10px] px-3 text-[13px] font-medium tabular-nums transition-colors ${filter === f ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text"}`}>
              {{ todo: "To do", review: "In review", done: "Approved" }[f]} ({groups[f].length})
            </button>
          ))}
        </div>
      </div>

      {tasks.error && <Notice>{tasks.error}</Notice>}
      {!tasks.data && !tasks.error && <Skeleton />}
      {tasks.data && groups[filter].length === 0 && (
        <Empty title={filter === "todo" ? "Nothing to do right now" : filter === "review" ? "Nothing waiting for review" : "No approved tasks yet"}>
          {isLead && all.length === 0 ? `Tasks you create are assigned to every ${memberLabel.toLowerCase()}.` : "New tasks show up here as soon as they're assigned."}
        </Empty>
      )}
      <ul className="space-y-2.5">
        {groups[filter].map((t) => <TaskRow key={t.id} task={t} tz={tz} onChange={changed} />)}
      </ul>

      {open.data && open.data.length > 0 && (
        <>
          <h2 className="mb-3.5 mt-9 font-display text-lg font-semibold tracking-[-0.01em]">Open tasks anyone can claim</h2>
          <ul className="space-y-2.5">
            {open.data.map((t) => (
              <OpenTaskRow key={t.task_id} task={t} tz={tz} isLead={isLead} onChange={changed} onError={setError} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** An open task anyone can claim. Leads can also see who has the most spare time for it and assign it. */
function OpenTaskRow({ task, tz, isLead, onChange, onError }: { task: OpenTask; tz: string; isLead: boolean; onChange: () => void; onError: (m: string) => void }) {
  const [suggesting, setSuggesting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const toast = useToast();
  return (
    <ListRow bar="light">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-snug">{task.title}</p>
          <p className="mt-0.5 text-[13px] text-muted">{task.description ? `${task.description} · ` : ""}{fmtDue(task.due_at, tz)}</p>
        </div>
        <div className="flex gap-2">
          {isLead && (
            <Button variant={suggesting ? "ghost" : "secondary"} onClick={() => setSuggesting((v) => !v)}>
              {suggesting ? "Hide" : "Suggest owner"}
            </Button>
          )}
          <Button busy={claiming} onClick={async () => {
            setClaiming(true);
            try { await post(`/tasks/${task.task_id}/claim`); toast(`Claimed ${task.title}`); onChange(); }
            catch (e) { onError(e instanceof Error ? e.message : "Couldn't claim it."); setClaiming(false); }
          }}>Claim</Button>
        </div>
      </div>
      {suggesting && <SuggestOwner taskId={task.task_id} onAssigned={onChange} />}
    </ListRow>
  );
}

export function TaskRow({ task, tz, onChange }: { task: Assignment; tz: string; onChange: () => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSubmit = task.evidence !== "none" && ["not_started", "in_progress", "needs_revision"].includes(task.status);
  const s = STATUS[task.status];
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Check on the device first so people don't wait on an upload that will be rejected.
    if (task.evidence === "photo" && !file) return setError("Add a photo before sending.");
    if (task.evidence === "camera" && !capture) return setError("Take the photo with the camera before sending.");
    if (task.evidence === "text" && !text.trim()) return setError("Write a note before sending.");
    if (task.evidence === "any" && !text.trim() && !file) return setError("Add a note or attach a file.");
    if (file && file.size > 8 * 1024 * 1024) return setError("That file is over 8 MB. Pick a smaller one.");
    setBusy(true);
    setError("");
    const body = new FormData();
    body.set("text", text);
    if (task.evidence === "camera" && capture) {
      body.set("file", new File([capture.blob], "photo.jpg", { type: "image/jpeg" }));
      body.set("capture_token", capture.token);
    } else if (file) body.set("file", file);
    try {
      await api(`/assignments/${task.id}/submissions`, { method: "POST", body });
      toast(`Sent ${task.title} for review`);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ListRow bar={PRIORITY_BAR[task.priority] ?? "mid"}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug">{task.title}</p>
            <p className={`mt-0.5 truncate text-[13px] leading-snug ${task.overdue ? "font-medium text-danger" : "text-muted"}`}>
              {task.overdue ? "Overdue" : s.label} · {fmtDue(task.due_at, tz)} · {task.category}
            </p>
          </div>
          {canSubmit ? (
            <CheckButton active={openForm} onClick={() => setOpenForm((v) => !v)} aria-expanded={openForm}
              label={openForm ? "Cancel" : `${task.status === "needs_revision" ? "Resubmit" : "Submit"} ${task.title}`}>
              {openForm ? <IconClose /> : undefined}
            </CheckButton>
          ) : task.status === "approved" ? <CheckMark label="Approved" /> : null}
        </div>
        {task.description && <p className={`mt-1.5 text-[13px] text-muted ${openForm ? "" : "line-clamp-1"}`}>{task.description}</p>}
        {task.status === "needs_revision" && task.feedback && <div className="mt-3"><Notice tone="warn">Reviewer: {task.feedback}</Notice></div>}
        {task.check && <AiCheckNote check={task.check} own />}
        {openForm && canSubmit && (
          <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-4">
            {task.evidence === "camera" && (
              <div className="text-sm font-medium">
                <p className="mb-2">Photo <span className="font-normal text-muted">(take it now with the camera; uploads aren&apos;t accepted)</span></p>
                <CameraCapture onChange={setCapture}
                  getToken={async () => (await post<{ token: string }>(`/assignments/${task.id}/capture`)).token} />
              </div>
            )}
            {task.evidence !== "photo" && (
              <label className="block text-sm font-medium">
                {task.evidence === "camera" ? "Caption (optional)" : "Note"}
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000}
                  className={field} />
              </label>
            )}
            {task.evidence !== "text" && task.evidence !== "camera" && (
              <label className="block text-sm font-medium">
                {task.evidence === "photo" ? "Photo (JPEG or PNG, up to 8 MB)" : "Attachment (JPEG, PNG, or PDF, optional; export slides as PDF)"}
                <input type="file" accept={task.evidence === "photo" ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf"}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm font-normal" />
              </label>
            )}
            <p className="text-xs text-muted">Only you and this group&apos;s reviewers can see what you submit.</p>
            {task.ai_check_on && (
              <p className="text-xs text-muted">
                Written work, including PDF text, is sent to GPTZero to check for AI writing. You and your reviewers see the score. Detectors can be wrong, so it&apos;s never used on its own.
              </p>
            )}
            {error && <Notice>{error}</Notice>}
            <Button variant="primary" type="submit" busy={busy}>Send for review</Button>
          </form>
        )}
    </ListRow>
  );
}

export function NewTask({ orgId, memberLabel, onDone }: { orgId: string; memberLabel: string; onDone: () => void }) {
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
          {/* BP photos default to the in-app camera; the lead can still change it below. */}
          <select value={form.category} className={field}
            onChange={(e) => setForm({ ...form, category: e.target.value, ...(e.target.value === "BP Posts" ? { evidence: "camera" } : {}) })}>
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
            <option value="any">Note or file</option><option value="text">Written note</option><option value="photo">Photo</option><option value="camera">Photo taken in the app (no uploads)</option><option value="none">Nothing to submit</option>
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
