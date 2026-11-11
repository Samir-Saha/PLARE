"use client";
import { useState } from "react";
import { api, type TaskTemplate } from "@/lib/api";
import { fmtDay, fmtTime } from "@/lib/format";
import { Badge, Button, Dialog, Empty, ListRow, Notice, SectionHeader, Skeleton, useLoad } from "./ui";

export function TaskTemplates({ orgId, revision }: { orgId: string; revision: number }) {
  const templates = useLoad(() => api<TaskTemplate[]>(`/orgs/${orgId}/task-templates`), [orgId, revision]);
  return (
    <section className="mt-10">
      <SectionHeader title="Recurring templates" />
      <p className="mb-4 text-sm text-muted">Pause or end future tasks without changing work already assigned. Resuming skips missed cycles.</p>
      {templates.error && <Notice>{templates.error}</Notice>}
      {!templates.data && !templates.error && <Skeleton rows={2} />}
      {templates.data?.length === 0 && <Empty title="No recurring templates">Choose Daily or Weekly when creating a task.</Empty>}
      <ul className="space-y-3">
        {templates.data?.map((template) => <TemplateRow key={template.id} orgId={orgId} template={template} onChange={templates.reload} />)}
      </ul>
    </section>
  );
}

function TemplateRow({ orgId, template: t, onChange }: { orgId: string; template: TaskTemplate; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState("");
  async function change(status: TaskTemplate["status"]) {
    setBusy(true); setError("");
    try {
      await api(`/orgs/${orgId}/task-templates/${t.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setEnding(false);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the template. Try again.");
    } finally { setBusy(false); }
  }
  return (
    <ListRow bar={null}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{t.title}</h3>
        <Badge tone={t.status === "active" ? "ok" : "neutral"}>{t.status === "active" ? "Active" : t.status === "paused" ? "Paused" : "Ended"}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{t.frequency === "daily" ? "Daily" : "Weekly"} · {fmtTime(t.first_due_at, t.timezone)} · {t.timezone}</p>
      <p className="mt-1 text-sm text-muted">
        {t.assign === "open" ? "Open for anyone to claim" : t.assign === "users" ? "Selected group members" : "All current members"}
        {t.ends_at && ` · Final deadline ${fmtDay(t.ends_at, t.timezone)}`}
      </p>
      {t.status === "active" && <p className="mt-1 text-xs text-muted">Next generation check: {fmtDay(t.next_run_at, t.timezone)}, {fmtTime(t.next_run_at, t.timezone)}</p>}
      {error && !ending && <div className="mt-2"><Notice>{error}</Notice></div>}
      {t.status !== "ended" && <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" busy={busy} onClick={() => change(t.status === "paused" ? "active" : "paused")}>{t.status === "paused" ? "Resume" : "Pause"}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEnding(true)}>End template</Button>
      </div>}
      <Dialog open={ending} onClose={() => { if (!busy) setEnding(false); }} title="End recurring template" description={`Stop creating tasks for ${t.title}? Existing tasks and submissions will stay. This template can't be resumed.`}>
        {error && <Notice>{error}</Notice>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setEnding(false)}>Cancel</Button>
          <Button variant="danger" busy={busy} onClick={() => change("ended")}>End template</Button>
        </div>
      </Dialog>
    </ListRow>
  );
}
