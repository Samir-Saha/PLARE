"use client";
import { useState } from "react";
import { api, post, type CoffeeChat } from "@/lib/api";
import { fmtShortDay, fmtTime } from "@/lib/format";
import { useApp } from "@/components/shell";
import { IconClose } from "@/components/icons";
import { Avatar, Badge, Button, Card, CheckButton, Empty, ListRow, Notice, Page, PageHeader, Progress, Skeleton, StatTile, field, useLoad, type Bar } from "@/components/ui";

const fullName = (c: CoffeeChat) => `${c.first_name} ${c.last_name}`;

function Deadline({ c, tz, now }: { c: CoffeeChat; tz: string; now: number }) {
  if (c.done && c.completed_at) {
    return <p className="mt-0.5 text-[14px] font-medium text-ok tabular-nums">Done {fmtShortDay(c.completed_at, tz)}</p>;
  }
  // Whole calendar days between today and the due date, in the viewer's timezone.
  const localDay = (ms: number) => Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ms)));
  const days = Math.round((localDay(new Date(c.due_at).getTime()) - localDay(now)) / 864e5);
  const when = <time dateTime={c.due_at}>{fmtShortDay(c.due_at, tz)}, {fmtTime(c.due_at, tz)}</time>;
  return (
    <p className={`mt-0.5 text-[14px] tabular-nums ${c.overdue ? "font-semibold text-danger" : days <= 2 ? "font-semibold text-warn" : "text-muted"}`}>
      {c.overdue ? <>Overdue · was due {when}</> : <>Due {when} · {days <= 0 ? "due today" : days === 1 ? "due tomorrow" : `in ${days} days`}</>}
    </p>
  );
}

const bar = (c: CoffeeChat): Bar => (c.done ? "ok" : c.overdue ? "danger" : "navy");

export default function CoffeeChats() {
  const { isLead } = useApp();
  return isLead ? <LeadCoffee /> : <MemberCoffee />;
}

function MemberCoffee() {
  const { org, me } = useApp();
  const chats = useLoad(() => api<CoffeeChat[]>(`/orgs/${org.id}/coffee-chats`), [org.id]);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const all = chats.data ?? [];
  const done = all.filter((c) => c.done);
  const todo = all.filter((c) => !c.done);
  const overdue = todo.filter((c) => c.overdue).length;
  const next = todo.find((c) => !c.overdue);

  async function toggle(c: CoffeeChat) {
    setBusy(c.id);
    setError("");
    try {
      await api(`/orgs/${org.id}/coffee-chats/${c.id}/done`, { method: c.done ? "DELETE" : "PUT" });
      chats.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
    } finally {
      setBusy("");
    }
  }

  const row = (c: CoffeeChat) => (
    <ListRow key={c.id} bar={bar(c)} end={
      <CheckButton active={c.done} disabled={busy === c.id} onClick={() => toggle(c)}
        label={c.done ? `Mark coffee chat with ${fullName(c)} as not done` : `Mark coffee chat with ${fullName(c)} as done`} />
    }>
      <div className="flex items-center gap-3">
        <Avatar name={fullName(c)} className="size-10 text-[13px]" />
        <div className="min-w-0">
          <p className={`text-[16px] font-semibold leading-snug ${c.done ? "text-muted line-through decoration-2" : ""}`}>{fullName(c)}</p>
          <Deadline c={c} tz={me.timezone} now={now} />
        </div>
      </div>
    </ListRow>
  );

  return (
    <Page>
      <PageHeader title="Coffee chats" hint={chats.data ? `${done.length} of ${all.length} done${overdue ? ` · ${overdue} overdue` : next ? ` · next due ${fmtShortDay(next.due_at, me.timezone)}` : ""}` : undefined} />
      {chats.error && <Notice>{chats.error}</Notice>}
      {error && <div className="mb-4"><Notice>{error}</Notice></div>}
      {!chats.data && !chats.error && <Skeleton />}
      {chats.data && all.length === 0 && <Empty title="No coffee chats yet">When a brother adds people to meet, they show up here with a deadline.</Empty>}
      {all.length > 0 && (
        <>
          <Card className="mb-8">
            <dl className="grid grid-cols-3 gap-3">
              <StatTile label="Done" value={done.length} />
              <StatTile label="Left to do" value={todo.length} />
              <StatTile label="Overdue" value={overdue} tone={overdue ? "danger" : undefined} />
            </dl>
            <Progress className="mt-5 h-2.5" value={(done.length / all.length) * 100} label="Coffee chats done" />
            <p className="mt-3 text-sm text-muted">Tap the circle after you finish a chat. Tap it again to undo.</p>
          </Card>

          <h2 className="mb-3.5 font-display text-xl font-bold tracking-[-0.01em]">To do ({todo.length})</h2>
          {todo.length === 0 ? <Empty title="All coffee chats done">Nice work. Every chat on the list is checked off.</Empty> : <ul className="space-y-2.5">{todo.map(row)}</ul>}

          {done.length > 0 && (
            <>
              <h2 className="mb-3.5 mt-9 font-display text-xl font-bold tracking-[-0.01em]">Done ({done.length})</h2>
              <ul className="space-y-2.5">{done.map(row)}</ul>
            </>
          )}
        </>
      )}
    </Page>
  );
}

function LeadCoffee() {
  const { org, me } = useApp();
  const chats = useLoad(() => api<CoffeeChat[]>(`/orgs/${org.id}/coffee-chats`), [org.id]);
  const [now] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const member = org.member_label.toLowerCase();
  const all = chats.data ?? [];

  async function remove(c: CoffeeChat) {
    if (!window.confirm(`Remove ${fullName(c)} from the coffee chat list? Every ${member}'s check-off for this chat is deleted too.`)) return;
    try {
      await api(`/orgs/${org.id}/coffee-chats/${c.id}`, { method: "DELETE" });
      chats.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that brother. Try again.");
    }
  }

  return (
    <Page>
      <PageHeader
        title="Coffee chats"
        hint={chats.data ? `${all.length} ${all.length === 1 ? "brother" : "brothers"} on the list` : undefined}
        action={<Button variant="primary" className="min-h-11 px-5" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Add brother"}</Button>}
      />
      <p className="-mt-5 mb-6 max-w-2xl text-sm text-muted">Each {member} has a coffee chat with every brother here by the deadline and checks it off themselves.</p>
      {error && <div className="mb-4"><Notice>{error}</Notice></div>}
      {adding && <AddBrother orgId={org.id} onDone={() => { setAdding(false); chats.reload(); }} />}
      {chats.error && <Notice>{chats.error}</Notice>}
      {!chats.data && !chats.error && <Skeleton />}
      {chats.data && all.length === 0 && <Empty title="No brothers on the list">Choose Add brother to set who {member}s should meet and by when.</Empty>}
      <ul className="space-y-2.5">
        {all.map((c) => {
          const n = c.done_count ?? 0, total = c.member_count ?? 0;
          const late = new Date(c.due_at).getTime() < now && n < total;
          return (
            <ListRow key={c.id} bar={n === total && total > 0 ? "ok" : late ? "danger" : "navy"} end={
              <button type="button" onClick={() => remove(c)} aria-label={`Remove ${fullName(c)}`} title="Remove brother"
                className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-text">
                <IconClose width={16} height={16} />
              </button>
            }>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={fullName(c)} className="size-10 text-[13px]" />
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold leading-snug">{fullName(c)}</p>
                    <p className="mt-0.5 text-[14px] text-muted tabular-nums">
                      Due <time dateTime={c.due_at}>{fmtShortDay(c.due_at, me.timezone)}, {fmtTime(c.due_at, me.timezone)}</time>
                    </p>
                  </div>
                </div>
                <div className="w-full sm:w-56">
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[14px] tabular-nums">
                    <span className="font-semibold">{n} of {total} {member}s</span>
                    {late && <Badge tone="danger">{total - n} late</Badge>}
                  </div>
                  <Progress value={total ? (n / total) * 100 : 0} label={`${fullName(c)} coffee chats done`} fill={n === total && total > 0 ? "bg-ok" : "bg-accent"} />
                </div>
              </div>
            </ListRow>
          );
        })}
      </ul>
    </Page>
  );
}

function AddBrother({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", due: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // datetime-local is the browser's local time; toISOString sends it as UTC.
      await post(`/orgs/${orgId}/coffee-chats`, { first_name: form.first_name, last_name: form.last_name, due_at: new Date(form.due).toISOString() });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the brother. Try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="mb-7">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">First name
          <input required maxLength={60} value={form.first_name} onChange={set("first_name")} className={field} />
        </label>
        <label className="text-sm font-medium">Last name
          <input required maxLength={60} value={form.last_name} onChange={set("last_name")} className={field} />
        </label>
        <label className="text-sm font-medium">Deadline
          <input required type="datetime-local" value={form.due} onChange={set("due")} className={field} />
        </label>
        {error && <div className="sm:col-span-3"><Notice>{error}</Notice></div>}
        <div className="sm:col-span-3"><Button variant="primary" type="submit" busy={busy}>Add to list</Button></div>
      </form>
    </Card>
  );
}
