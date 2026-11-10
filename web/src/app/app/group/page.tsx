"use client";
import { useState } from "react";
import { api, post } from "@/lib/api";
import { useApp } from "@/components/shell";
import { Avatar, Badge, Button, Card, Notice, PageHeader, Skeleton, useLoad, Page } from "@/components/ui";

type Member = { user_id: string; name: string; role: "admin" | "lead" | "member" };
const KINDS = [["pledge_class", "Pledge class"], ["study_group", "Study group"], ["intern_team", "Intern team"], ["project_group", "Class project group"], ["club", "Club"]];

export default function Group() {
  const { me, org, isLead, refresh, selectOrg } = useApp();
  const members = useLoad(() => (org ? api<Member[]>(`/orgs/${org.id}/members`) : Promise.resolve([])), [org?.id]);
  const [invite, setInvite] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("pledge_class");
  const fail = (e: unknown) => setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Something went wrong." });

  async function makeInvite(role: "member" | "lead") {
    try {
      const r = await post<{ code: string }>(`/orgs/${org.id}/invites`, { role });
      const link = `${window.location.origin}/join/${r.code}`;
      setInvite(link);
      await navigator.clipboard?.writeText(link).catch(() => {});
      setMsg({ tone: "ok", text: "Invite link created. It works for 7 days." });
    } catch (e) { fail(e); }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    try {
      const created = await post<{ id: string }>("/orgs", { name, kind });
      await refresh();
      selectOrg(created.id);
      setName("");
      setMsg({ tone: "ok", text: "Group created. Invite people to get started." });
    } catch (err) { fail(err); }
  }

  const label = (m: Member) => (m.role === "admin" ? "Admin" : m.role === "lead" ? org.lead_label : org.member_label);

  return (
    <Page>
      <PageHeader title={org ? org.name : "Start a group"} hint={org ? undefined : "Create one below, or open an invite link someone sent you."} />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}

      {org && (
        <>
          {isLead && (
            <Card className="mb-8">
              <h2 className="text-lg font-semibold">Invite people</h2>
              <p className="text-sm text-muted">Anyone with the link can join after signing in.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => makeInvite("member")}>Invite {org.member_label.toLowerCase()}s</Button>
                {org.role === "admin" && <Button onClick={() => makeInvite("lead")}>Invite a {org.lead_label.toLowerCase()}</Button>}
              </div>
              {invite && <input readOnly value={invite} aria-label="Invite link" onFocus={(e) => e.target.select()} className="mt-3 w-full rounded-xl border border-line bg-raised px-3 py-2 font-mono text-xs" />}
            </Card>
          )}
          <h2 className="mb-3.5 font-display text-lg font-semibold tracking-[-0.01em] tabular-nums">{members.data ? `${members.data.length} people` : "People"}</h2>
          {!members.data && <Skeleton />}
          <ul className="mb-10 divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
            {members.data?.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.name} />
                  <span className="truncate font-medium">{m.name}{m.user_id === me.id && <span className="font-normal text-muted"> (you)</span>}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={m.role === "member" ? "neutral" : "accent"}>{label(m)}</Badge>
                  {org.role === "admin" && m.user_id !== me.id && m.role !== "admin" && (
                    <Button variant="ghost" onClick={() => api(`/orgs/${org.id}/members/${m.user_id}`, { method: "PATCH", body: JSON.stringify({ role: m.role === "member" ? "lead" : "member" }) }).then(() => { members.reload(); refresh(); }, fail)}>
                      Make {m.role === "member" ? org.lead_label.toLowerCase() : org.member_label.toLowerCase()}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <Card>
        <h2 className="text-lg font-semibold">Create a new group</h2>
        <p className="text-sm text-muted">Pledge class, intern team, study group, club. You&apos;ll be its admin.</p>
        <form onSubmit={createGroup} className="mt-3 flex flex-wrap gap-2">
          <input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" aria-label="Group name"
            className="min-h-10 min-w-0 flex-1 basis-48 rounded-xl border border-line bg-surface px-3 text-sm" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Group type" className="min-h-10 rounded-xl border border-line bg-surface px-2.5 text-sm">
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <Button type="submit">Create group</Button>
        </form>
      </Card>
    </Page>
  );
}
