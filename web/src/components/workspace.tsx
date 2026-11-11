"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { post, type Me, type Org } from "@/lib/api";
import { Avatar, Button, Dialog, Notice, ThemeToggle, field, useToast } from "./ui";
import { IconBell, IconLogout } from "./icons";

export const GROUP_KINDS: [string, string][] = [
  ["pledge_class", "Pledge class"], ["study_group", "Study group"], ["intern_team", "Intern team"],
  ["project_group", "Class project group"], ["club", "Club"],
];

function roleLabel(org: Org) {
  return org.role === "admin" ? "Admin" : org.role === "lead" ? org.lead_label : org.member_label;
}

/** Create a group, switch to it, and open its Group page. */
export function CreateGroupDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => Promise<void> | void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("pledge_class");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Give the group a name of at least 2 characters.");
    setBusy(true);
    setError("");
    try {
      const created = await post<{ id: string }>("/orgs", { name: name.trim(), kind });
      await onCreated(created.id);
      toast(`Created ${name.trim()}`);
      setName("");
      onClose();
      router.push("/app/group");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create a group" description="Pledge class, intern team, study group, or club. You'll be its admin.">
      <form onSubmit={create} className="space-y-4" noValidate>
        <label className="block text-sm font-medium">
          Group name
          <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={120}
            aria-invalid={!!error} className={field} placeholder="Fall 2026 Pledge Class" />
        </label>
        <label className="block text-sm font-medium">
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            {GROUP_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Create group</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Desktop sidebar: current group with a menu to switch groups or create one. */
export function GroupSwitcher({ me, org, selectOrg, onCreate }: { me: Me; org: Org; selectOrg: (id: string) => void; onCreate: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function onKey(e: KeyboardEvent) {
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { setOpen(false); wrap.current?.querySelector("button")?.focus(); }
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
  }

  return (
    <div ref={wrap} className="relative" onKeyDown={onKey}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-[10px] border border-nav-line bg-nav-hover px-2.5 py-2 text-left text-nav-text transition-colors duration-150 hover:bg-nav-active">
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-gold text-[11px] font-bold text-gold-fg">
          {org.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">{org.name}</span>
          <span className="block truncate text-[11px] text-nav-muted">{roleLabel(org)}</span>
        </span>
        <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-nav-muted"><path d="M8 10l4-4 4 4M8 14l4 4 4-4" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Groups" className="plare-toast absolute inset-x-0 top-full z-20 mt-1.5 origin-top rounded-xl border border-line bg-surface p-1 text-text shadow-frame">
          {me.orgs.map((o, i) => (
            <button key={o.id} ref={(el) => { items.current[i] = el; }} role="menuitemradio" aria-checked={o.id === org.id}
              onClick={() => { selectOrg(o.id); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-raised focus-visible:bg-raised">
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.id === org.id && <span aria-hidden className="text-accent">✓</span>}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button ref={(el) => { items.current[me.orgs.length] = el; }} role="menuitem"
            onClick={() => { setOpen(false); onCreate(); }}
            className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-accent transition-colors duration-150 hover:bg-raised focus-visible:bg-raised">
            + Create a group
          </button>
        </div>
      )}
    </div>
  );
}

/** Phones: account sheet with groups, create group, theme, and sign out (the sidebar is hidden there). */
export function AccountSheet({ open, onClose, me, org, selectOrg, onCreate, onSignOut }: {
  open: boolean; onClose: () => void; me: Me; org: Org | null; selectOrg: (id: string) => void; onCreate: () => void; onSignOut: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={me.name} description={org ? `${roleLabel(org)} · ${org.name}` : me.email} size="sheet">
      {me.orgs.length > 0 && (
        <fieldset className="mb-4">
          <legend className="mb-1.5 text-sm font-semibold text-muted">Groups</legend>
          <div className="overflow-hidden rounded-xl border border-line">
            {me.orgs.map((o) => (
              <button key={o.id} type="button" aria-pressed={o.id === org?.id} onClick={() => { selectOrg(o.id); onClose(); }}
                className="flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left text-sm last:border-b-0 hover:bg-raised">
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.id === org?.id && <span className="text-xs font-semibold text-accent">Current</span>}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex flex-col gap-1">
        <Button variant="outline" className="justify-start" onClick={() => { onClose(); onCreate(); }}>+ Create a group</Button>
        <NotificationsLink onClose={onClose} />
        <ThemeToggle className="min-h-11! justify-start!" />
        <Button variant="ghost" className="min-h-11 justify-start" onClick={onSignOut}>
          <IconLogout width={18} height={18} />Sign out
        </Button>
      </div>
    </Dialog>
  );
}

export function MobileTopBar({ me, org, onOpenAccount }: { me: Me; org: Org | null; onOpenAccount: () => void }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 bg-nav px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] text-nav-text md:hidden">
      <span aria-hidden className="grid size-7 shrink-0 grid-cols-3 gap-[2px]">{[0,1,2,1,2,3,2,1,0].map((v, i) => <span key={i} className={`rounded-[1.5px] ${v === 3 ? "bg-gold" : v === 2 ? "bg-nav-text" : v === 1 ? "bg-nav-text/55" : "bg-nav-text/25"}`} />)}</span>
      <span className="min-w-0 flex-1 truncate font-display text-[17px] font-bold">{org?.name ?? "PLARE"}</span>
      <button type="button" onClick={onOpenAccount} aria-label="Account and groups"
        className="grid size-11 place-items-center rounded-full transition-colors duration-150 hover:bg-nav-hover">
        <Avatar name={me.name} className="size-8 text-[11px]" />
      </button>
    </header>
  );
}

function NotificationsLink({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  return (
    <Button variant="ghost" className="min-h-11 justify-start" onClick={() => { onClose(); router.push("/app/settings"); }}>
      <IconBell width={18} height={18} />Notifications
    </Button>
  );
}
