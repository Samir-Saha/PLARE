"use client";
import { useMemo, useState } from "react";
import { api, post, type Org } from "@/lib/api";
import { fmtShortDay } from "@/lib/format";
import { useApp } from "@/components/shell";
import { CreateGroupDialog, GROUP_KINDS } from "@/components/workspace";
import {
  Avatar, Badge, Button, Dialog, Empty, Notice, Page, PageHeader, Skeleton, Tabs, field, tabPanelProps, useLoad, useToast,
} from "@/components/ui";

type Member = { user_id: string; name: string; role: "admin" | "lead" | "member"; joined_at?: string; title?: string | null };
type Invite = { code: string; role: Member["role"]; expires_at: string | null; created_at: string; created_by: string };
type TabId = "members" | "invites" | "settings";

const inviteUrl = (code: string) => `${window.location.origin}/join/${code}`;

export default function Group() {
  const { me, org, isLead, refresh, selectOrg } = useApp();
  const [creating, setCreating] = useState(false);

  if (!org) {
    return (
      <Page>
        <PageHeader title="Start a group" hint="Create one, or open an invite link someone sent you." />
        <Empty title="You're not in a group yet">
          <p>Groups hold your tasks, submissions, and shared schedule. Pledge classes, intern teams, study groups, and clubs all work.</p>
          <Button variant="primary" className="mt-4" onClick={() => setCreating(true)}>Create a group</Button>
        </Empty>
        <CreateGroupDialog open={creating} onClose={() => setCreating(false)} onCreated={async (id) => { await refresh(); selectOrg(id); }} />
      </Page>
    );
  }
  return <GroupPage key={org.id} org={org} meId={me.id} tz={me.timezone} isLead={isLead} refresh={refresh} />;
}

function GroupPage({ org, meId, tz, isLead, refresh }: { org: Org; meId: string; tz: string; isLead: boolean; refresh: () => Promise<void> }) {
  const isAdmin = org.role === "admin";
  const [tab, setTab] = useState<TabId>("members");
  const [inviting, setInviting] = useState(false);
  const members = useLoad(() => api<Member[]>(`/orgs/${org.id}/members`), [org.id]);
  const invites = useLoad(() => (isLead ? api<Invite[]>(`/orgs/${org.id}/invites`) : Promise.resolve([])), [org.id, isLead]);
  const kindLabel = GROUP_KINDS.find(([k]) => k === org.kind)?.[1] ?? "Group";

  const tabs = [
    { id: "members" as const, label: "Members", count: members.data?.length },
    ...(isLead ? [{ id: "invites" as const, label: "Invitations", count: invites.data?.length }] : []),
    ...(isAdmin ? [{ id: "settings" as const, label: "Settings" }] : []),
  ];

  return (
    <Page>
      <PageHeader
        title={org.name}
        hint={`${kindLabel}${members.data ? ` · ${members.data.length} ${members.data.length === 1 ? "person" : "people"}` : ""}`}
        action={
          <>
            {isAdmin && <Button variant="outline" onClick={() => setTab("settings")}>Settings</Button>}
            {isLead && <Button variant="primary" onClick={() => setInviting(true)}>Invite members</Button>}
          </>
        }
      />
      <Tabs label="Group sections" tabs={tabs} value={tab} onChange={setTab} />
      <div className="pt-5" {...tabPanelProps(tab)}>
        {tab === "members" && <MembersTab org={org} meId={meId} tz={tz} members={members} onChanged={refresh} />}
        {tab === "invites" && isLead && <InvitesTab org={org} tz={tz} invites={invites} onNew={() => setInviting(true)} />}
        {tab === "settings" && isAdmin && <SettingsTab org={org} onSaved={refresh} />}
      </div>
      {isLead && <InviteDialog open={inviting} onClose={() => setInviting(false)} org={org} onCreated={() => { invites.reload(); }} />}
    </Page>
  );
}

/* ---------- Members ---------- */

function MembersTab({ org, meId, tz, members, onChanged }: {
  org: Org; meId: string; tz: string; members: { data: Member[] | null; error: string; reload: () => void }; onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const isAdmin = org.role === "admin";
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | Member["role"]>("all");
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState("");
  const label = (r: Member["role"]) => (r === "admin" ? "Admin" : r === "lead" ? org.lead_label : org.member_label);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members.data ?? []).filter((m) => (role === "all" || m.role === role) && (!q || m.name.toLowerCase().includes(q)));
  }, [members.data, query, role]);

  async function changeRole(m: Member) {
    const next = m.role === "member" ? "lead" : "member";
    setBusy(m.user_id);
    try {
      await api(`/orgs/${org.id}/members/${m.user_id}`, { method: "PATCH", body: JSON.stringify({ role: next }) });
      toast(`${m.name} is now ${next === "lead" ? `a ${org.lead_label.toLowerCase()}` : `a ${org.member_label.toLowerCase()}`}`);
      members.reload();
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change the role.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function remove(m: Member) {
    setBusy(m.user_id);
    try {
      await api(`/orgs/${org.id}/members/${m.user_id}`, { method: "DELETE" });
      toast(`Removed ${m.name}`);
      setRemoving(null);
      members.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove them.", "danger");
    } finally {
      setBusy("");
    }
  }

  if (members.error) return <Notice>{members.error}</Notice>;
  if (!members.data) return <Skeleton rows={4} />;

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="min-w-0 flex-1 basis-56">
          <span className="sr-only">Search members</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name"
            className={`${field} mt-0`} />
        </label>
        <label>
          <span className="sr-only">Filter by role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={`${field} mt-0 w-auto`}>
            <option value="all">All roles</option>
            <option value="member">{org.member_label}s</option>
            <option value="lead">{org.lead_label}s</option>
            <option value="admin">Admins</option>
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <Empty title="No one matches">Try a different name or role.</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {shown.map((m) => {
            const canManage = isAdmin && m.user_id !== meId && m.role !== "admin";
            return (
              <li key={m.user_id} className="flex min-h-14 items-center gap-3 px-3 py-2 sm:px-4">
                <Avatar name={m.name} className="size-8 text-[11px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}{m.user_id === meId && <span className="font-normal text-muted"> (you)</span>}</p>
                  {(m.title || m.joined_at) && (
                    <p className="truncate text-xs text-muted">
                      {m.title}{m.title && m.joined_at ? " · " : ""}{m.joined_at && `Joined ${fmtShortDay(m.joined_at, tz)}`}
                    </p>
                  )}
                </div>
                <Badge tone={m.role === "member" ? "neutral" : "accent"}>{label(m.role)}</Badge>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" className="min-h-9 px-2.5 text-xs" busy={busy === m.user_id} onClick={() => changeRole(m)}
                      aria-label={`Make ${m.name} ${m.role === "member" ? `a ${org.lead_label}` : `a ${org.member_label}`}`}>
                      <span className="hidden sm:inline">Make&nbsp;</span>{m.role === "member" ? org.lead_label.toLowerCase() : org.member_label.toLowerCase()}
                    </Button>
                    <Button variant="ghost" className="min-h-9 px-2.5 text-xs text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name}`}>
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? ""}?`}
        description="They lose access to this group right away. Their past submissions stay in the review history.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" busy={!!removing && busy === removing.user_id} onClick={() => removing && remove(removing)}>Remove</Button>
        </div>
      </Dialog>
    </>
  );
}

/* ---------- Invitations ---------- */

function InvitesTab({ org, tz, invites, onNew }: { org: Org; tz: string; invites: { data: Invite[] | null; error: string; reload: () => void }; onNew: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const label = (r: Invite["role"]) => (r === "admin" ? "Admin" : r === "lead" ? org.lead_label : org.member_label);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      toast("Invite link copied");
    } catch {
      toast("Couldn't copy. Select the link and copy it manually.", "danger");
    }
  }

  async function revoke(code: string) {
    setBusy(code);
    try {
      await api(`/orgs/${org.id}/invites/${code}`, { method: "DELETE" });
      toast("Invite link revoked. It no longer works.");
      invites.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't revoke it.", "danger");
    } finally {
      setBusy("");
    }
  }

  if (invites.error) return <Notice>{invites.error}</Notice>;
  if (!invites.data) return <Skeleton rows={2} />;
  if (invites.data.length === 0)
    return (
      <Empty title="No active invite links">
        <p>Create a link and share it in your group chat. Anyone who opens it can join after signing in.</p>
        <Button variant="primary" className="mt-4" onClick={onNew}>Create invite link</Button>
      </Empty>
    );

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {invites.data.map((i) => (
        <li key={i.code} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
          <div className="min-w-0 flex-1 basis-60">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Badge tone={i.role === "member" ? "neutral" : "accent"}>{label(i.role)}</Badge>
              <span className="truncate font-mono text-xs text-muted">/join/{i.code}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {i.created_by ? `Made by ${i.created_by} · ` : ""}{i.expires_at ? `Expires ${fmtShortDay(i.expires_at, tz)}` : "Never expires"}
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="outline" className="min-h-9 text-xs" onClick={() => copy(i.code)}>Copy link</Button>
            <Button variant="ghost" className="min-h-9 text-xs text-danger hover:bg-danger-soft hover:text-danger" busy={busy === i.code} onClick={() => revoke(i.code)}>Revoke</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function InviteDialog({ open, onClose, org, onCreated }: { open: boolean; onClose: () => void; org: Org; onCreated: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<"member" | "lead">("member");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setLink("");
    setError("");
    onClose();
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const r = await post<{ code: string }>(`/orgs/${org.id}/invites`, { role });
      setLink(inviteUrl(r.code));
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied");
    } catch {
      toast("Couldn't copy. Select the link and copy it manually.", "danger");
    }
  }

  return (
    <Dialog open={open} onClose={close} title="Invite members" description="Anyone with the link can join after signing in. Links work for 7 days.">
      {!link ? (
        <div className="space-y-4">
          {org.role === "admin" && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">They join as</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["member", "lead"] as const).map((r) => (
                  <label key={r} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition-colors duration-150 ${role === r ? "border-accent bg-accent-soft" : "border-line hover:bg-raised"}`}>
                    <input type="radio" name="invite-role" value={r} checked={role === r} onChange={() => setRole(r)} className="accent-[var(--accent)]" />
                    {r === "member" ? org.member_label : org.lead_label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error && <Notice>{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" busy={busy} onClick={create}>Create link</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            Invite link
            <input readOnly value={link} onFocus={(e) => e.target.select()} className={`${field} font-mono text-xs`} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Done</Button>
            <Button variant="primary" onClick={copy}>Copy link</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ---------- Settings ---------- */

function SettingsTab({ org, onSaved }: { org: Org; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(org.name);
  const [kind, setKind] = useState(org.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = name.trim() !== org.name || kind !== org.kind;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("The name needs at least 2 characters.");
    setBusy(true);
    setError("");
    try {
      await api(`/orgs/${org.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim(), kind }) });
      await onSaved();
      toast("Group settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-lg space-y-4" noValidate>
      <label className="block text-sm font-medium">
        Group name
        <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={120} aria-invalid={!!error} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
          {GROUP_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted">The type sets how roles are named, for example Pledge and Brother / PM, or Intern and Team lead.</span>
      </label>
      {error && <Notice>{error}</Notice>}
      <Button type="submit" variant="primary" busy={busy} disabled={!dirty}>Save changes</Button>
    </form>
  );
}
