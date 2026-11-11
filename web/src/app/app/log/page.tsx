"use client";
import { useState } from "react";
import { api, post, type LogEntry, type LogSummary } from "@/lib/api";
import { fmtShortDay, fmtTime, fmtToday } from "@/lib/format";
import { LOG_KINDS, LOG_TZ, logBar } from "@/lib/log";
import { useApp } from "@/components/shell";
import { IconClose } from "@/components/icons";
import { Avatar, Badge, Button, Card, Empty, ListRow, Notice, Page, PageHeader, Skeleton, field, useLoad } from "@/components/ui";

export default function Log() {
  const { isLead } = useApp();
  return isLead ? <LeadLog /> : <MemberLog />;
}

function EntryRow({ e, showName, onRemove }: { e: LogEntry; showName: boolean; onRemove?: () => void }) {
  return (
    <ListRow bar={logBar(e.kind)} end={onRemove && (
      <button type="button" onClick={onRemove} aria-label={`Remove ${e.label} entry for ${e.user_name}`} title="Remove entry"
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-text">
        <IconClose width={16} height={16} />
      </button>
    )}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-[15px] font-semibold leading-snug">{e.label}</p>
        <Badge tone={e.automatic ? "neutral" : "accent"}>{e.automatic ? "Automatic" : `Added by ${e.created_by_name ?? "a brother"}`}</Badge>
      </div>
      {e.detail && <p className="mt-0.5 text-[13px] leading-snug">{e.detail}</p>}
      <p className="mt-1 text-xs text-muted tabular-nums">
        {showName && <>{e.user_name} · </>}
        <time dateTime={e.created_at}>{fmtShortDay(e.created_at, LOG_TZ)}, {fmtTime(e.created_at, LOG_TZ)}</time>
      </p>
    </ListRow>
  );
}

type Group = { key: string; entries: LogEntry[] };

/**
 * Display-only grouping: entries with the same kind and detail on the same Eastern day become one
 * row (e.g. several pledges overdue on one task). The API still returns one row per pledge.
 */
function groupEntries(entries: LogEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const e of entries) {
    const key = `${e.kind}|${e.detail}|${fmtShortDay(e.created_at, LOG_TZ)}`;
    const g = groups.get(key);
    if (g) g.entries.push(e);
    else groups.set(key, { key, entries: [e] });
  }
  return [...groups.values()];
}

function SourceBadge({ entries }: { entries: LogEntry[] }) {
  const auto = entries.every((e) => e.automatic);
  const by = [...new Set(entries.filter((e) => !e.automatic).map((e) => e.created_by_name ?? "a brother"))];
  return <Badge tone={auto ? "neutral" : "accent"}>{auto ? "Automatic" : by.length === 1 ? `Added by ${by[0]}` : "Added by brothers"}</Badge>;
}

function GroupRow({ entries, member, onRemove }: { entries: LogEntry[]; member: string; onRemove?: (e: LogEntry) => void }) {
  const [open, setOpen] = useState(false);
  const first = entries[0];
  const id = `group-${first.id}`;
  return (
    <ListRow bar={logBar(first.kind)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-[15px] font-semibold leading-snug">{first.label}</p>
        <SourceBadge entries={entries} />
      </div>
      {first.detail && <p className="mt-0.5 text-[13px] leading-snug">{first.detail}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span role="img" aria-label={entries.map((e) => e.user_name).join(", ")} className="flex items-center">
          {entries.slice(0, 4).map((e) => <Avatar key={e.id} name={e.user_name} className="-ml-2 size-7 text-[10px] ring-2 ring-surface first:ml-0" />)}
          {entries.length > 4 && <span aria-hidden className="-ml-2 grid size-7 place-items-center rounded-full bg-raised text-[10px] font-semibold text-muted ring-2 ring-surface tabular-nums">+{entries.length - 4}</span>}
        </span>
        <span className="text-xs font-medium tabular-nums">{entries.length} {member}s</span>
        <span className="text-xs text-muted tabular-nums">· <time dateTime={first.created_at}>{fmtShortDay(first.created_at, LOG_TZ)}, {fmtTime(first.created_at, LOG_TZ)}</time></span>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}
          className="ml-auto min-h-9 rounded-lg px-2.5 text-xs font-semibold text-accent hover:bg-raised">
          {open ? "Hide people" : `Show ${entries.length} people`}
        </button>
      </div>
      {open && (
        <ul id={id} className="mt-2 divide-y divide-line border-t border-line">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5 py-1.5">
              <Avatar name={e.user_name} className="size-7 text-[10px]" />
              <span className="min-w-0 flex-1 truncate text-sm">{e.user_name}</span>
              <span className="text-xs text-muted tabular-nums">{fmtTime(e.created_at, LOG_TZ)}</span>
              {onRemove && !e.automatic && (
                <button type="button" onClick={() => onRemove(e)} aria-label={`Remove ${e.label} entry for ${e.user_name}`} title="Remove entry"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-text">
                  <IconClose width={14} height={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ListRow>
  );
}

/** Grouped entries under "Today" and "Earlier" headings (Eastern time). */
function LogList({ entries, showName, member, onRemove }: { entries: LogEntry[]; showName: boolean; member: string; onRemove?: (e: LogEntry) => void }) {
  const [today] = useState(() => fmtShortDay(new Date().toISOString(), LOG_TZ));
  const groups = groupEntries(entries);
  const sections = [
    { title: "Today", groups: groups.filter((g) => fmtShortDay(g.entries[0].created_at, LOG_TZ) === today) },
    { title: "Earlier", groups: groups.filter((g) => fmtShortDay(g.entries[0].created_at, LOG_TZ) !== today) },
  ].filter((sec) => sec.groups.length > 0);
  return (
    <>
      {sections.map((sec) => (
        <section key={sec.title} aria-label={sec.title} className="mb-6">
          <h2 className="mb-2.5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            {sec.title}<span aria-hidden className="h-px flex-1 bg-line" />
          </h2>
          <ul className="space-y-2.5">
            {sec.groups.map((g) => g.entries.length > 1
              ? <GroupRow key={g.key} entries={g.entries} member={member} onRemove={onRemove} />
              : <EntryRow key={g.key} e={g.entries[0]} showName={showName} onRemove={onRemove && !g.entries[0].automatic ? () => onRemove(g.entries[0]) : undefined} />)}
          </ul>
        </section>
      ))}
    </>
  );
}

function LeadLog() {
  const { org } = useApp();
  const [who, setWho] = useState("");
  const [kind, setKind] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const qs = new URLSearchParams({ ...(who && { user_id: who }), ...(kind && { kind }) }).toString();
  const entries = useLoad(() => api<LogEntry[]>(`/orgs/${org.id}/log${qs ? `?${qs}` : ""}`), [org.id, qs]);
  const summary = useLoad(() => api<LogSummary>(`/orgs/${org.id}/log/summary`), [org.id]);
  const reload = () => { entries.reload(); summary.reload(); };
  const member = org.member_label.toLowerCase();
  const people = summary.data?.members ?? [];

  async function remove(e: LogEntry) {
    if (!window.confirm(`Remove this ${e.label.toLowerCase()} entry for ${e.user_name}? Only do this to fix a mistake.`)) return;
    try {
      await api(`/orgs/${org.id}/log/${e.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the entry. Try again.");
    }
  }

  return (
    <Page>
      <PageHeader
        title="Log"
        hint={`${fmtToday(LOG_TZ)}${summary.data ? ` · ${summary.data.today} new today · ${summary.data.total} total` : ""}`}
        action={<Button variant="primary" className="min-h-11 px-5" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Add entry"}</Button>}
      />
      <p className="-mt-5 mb-6 max-w-2xl text-sm text-muted">
        Facts only: what was late, missed, or short. Overdue tasks are logged automatically; {member}s see their own entries.
      </p>
      {error && <div className="mb-4"><Notice>{error}</Notice></div>}
      {adding && <AddEntry orgId={org.id} people={people} member={member} onDone={() => { setAdding(false); reload(); }} />}

      <section aria-labelledby="by-person" className="mb-7">
        <h2 id="by-person" className="sr-only">Entries per {member}</h2>
        {summary.error && <Notice>{summary.error}</Notice>}
        {!summary.data && !summary.error && <Skeleton rows={1} />}
        <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {people.map((p) => {
            const on = who === p.user_id;
            return (
              <li key={p.user_id} className="shrink-0">
                <button type="button" aria-pressed={on} onClick={() => setWho(on ? "" : p.user_id)}
                  className={`flex min-h-11 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:bg-raised"}`}>
                  <Avatar name={p.name} className="size-8 text-[11px]" />
                  <span className="font-medium">{p.name.split(" ")[0]}</span>
                  <span className={`min-w-6 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${on ? "bg-accent-fg/15" : p.count ? "bg-accent-soft text-accent" : "text-muted"}`}>{p.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1 text-sm font-medium sm:flex-none">
          {org.member_label}
          <select value={who} onChange={(e) => setWho(e.target.value)} className={field}>
            <option value="">Everyone</option>
            {[...people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
        </label>
        <label className="min-w-40 flex-1 text-sm font-medium sm:flex-none">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            <option value="">All kinds</option>
            {LOG_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {(who || kind) && <Button variant="ghost" onClick={() => { setWho(""); setKind(""); }}>Clear filters</Button>}
      </div>

      {entries.error && <Notice>{entries.error}</Notice>}
      {!entries.data && !entries.error && <Skeleton />}
      {entries.data?.length === 0 && <Empty title="Nothing logged">{who || kind ? "No entries match these filters." : `Nothing has been logged for any ${member} yet.`}</Empty>}
      {entries.data && <LogList entries={entries.data} showName member={member} onRemove={remove} />}
    </Page>
  );
}

function AddEntry({ orgId, people, member, onDone }: { orgId: string; people: LogSummary["members"]; member: string; onDone: () => void }) {
  const [form, setForm] = useState({ user_id: "", kind: "other", detail: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(`/orgs/${orgId}/log`, form);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the entry. Try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="mb-7">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">{member.charAt(0).toUpperCase() + member.slice(1)}
          <select required value={form.user_id} onChange={set("user_id")} className={field}>
            <option value="" disabled>Choose a {member}</option>
            {[...people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Kind
          <select value={form.kind} onChange={set("kind")} className={field}>
            {LOG_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium sm:col-span-2">What happened
          <input required maxLength={500} value={form.detail} onChange={set("detail")} placeholder="e.g. Missed coffee chat with Gokul" className={field} />
        </label>
        <p className="text-xs text-muted sm:col-span-2">Record the fact only. The {member} gets a notification and can see this entry.</p>
        {error && <div className="sm:col-span-2"><Notice>{error}</Notice></div>}
        <div className="sm:col-span-2"><Button variant="primary" type="submit" busy={busy}>Add to log</Button></div>
      </form>
    </Card>
  );
}

function MemberLog() {
  const { org } = useApp();
  const entries = useLoad(() => api<LogEntry[]>(`/orgs/${org.id}/log`), [org.id]);
  const n = entries.data?.length ?? 0;
  return (
    <Page>
      <PageHeader title="Your log" hint={entries.data ? `${n} ${n === 1 ? "entry" : "entries"} total` : undefined} />
      {entries.error && <Notice>{entries.error}</Notice>}
      {!entries.data && !entries.error && <Skeleton />}
      {entries.data?.length === 0 && <Empty title="Nothing logged. Keep it that way." />}
      {entries.data && <LogList entries={entries.data} showName={false} member={org.member_label.toLowerCase()} />}
    </Page>
  );
}
