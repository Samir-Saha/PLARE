"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type Assignment } from "@/lib/api";
import { useApp } from "@/components/shell";
import { NewTask, TasksSection, type OpenTask } from "@/components/home/tasks";
import { NotificationBell } from "@/components/home/widgets";
import { TaskTemplates } from "@/components/task-templates";
import { Button, Notice, Page, PageHeader, Skeleton, useLoad, useToast } from "@/components/ui";

export default function TasksPage() {
  return <Suspense fallback={<Skeleton rows={4} />}><TasksContent /></Suspense>;
}

function TasksContent() {
  const { me, org, isLead, selectOrg } = useApp();
  const requestedOrg = useSearchParams().get("org");
  const allowed = !requestedOrg || me.orgs.some((o) => o.id === requestedOrg);
  useEffect(() => {
    if (requestedOrg && allowed && requestedOrg !== org.id) selectOrg(requestedOrg);
  }, [requestedOrg, allowed, org.id, selectOrg]);
  if (!allowed) return <Page><Notice>This group is no longer available to your account. Choose a group from the menu.</Notice></Page>;
  if (requestedOrg && requestedOrg !== org.id) return <Skeleton rows={4} />;
  return <GroupTasks key={org.id} isLead={isLead} />;
}

function GroupTasks({ isLead }: { isLead: boolean }) {
  const { me, org } = useApp();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const tasks = useLoad(() => api<Assignment[]>(`/orgs/${org.id}/tasks/mine`), [org.id, revision]);
  const open = useLoad(() => api<OpenTask[]>(`/orgs/${org.id}/tasks/open`), [org.id, revision]);
  return (
    <Page>
      <PageHeader title="Tasks" hint="Submit your work, claim open tasks, and keep track of deadlines."
        action={<div className="flex items-center gap-2"><NotificationBell />{isLead && <Button variant="primary" onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New task"}</Button>}</div>} />
      <p className="mb-5 text-sm text-muted">Automatic reminders arrive within 24 hours, within 1 hour, and once overdue. Work waiting for review is not reminded.</p>
      {isLead && <p className="mb-5 text-sm"><Link href="/app/review" className="font-semibold text-accent underline underline-offset-2">Review submitted work</Link></p>}
      {creating && <NewTask orgId={org.id} memberLabel={org.member_label} onDone={() => { setCreating(false); setRevision((v) => v + 1); toast("Task created"); }} />}
      <TasksSection tasks={tasks} open={open} tz={me.timezone} isLead={isLead} memberLabel={org.member_label} />
      {isLead && <TaskTemplates orgId={org.id} revision={revision} />}
    </Page>
  );
}
