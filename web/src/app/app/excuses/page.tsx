"use client";
import { useState } from "react";
import { api, fileUrl, post, type Excuse, type ExcuseSummary } from "@/lib/api";
import { fmtDate, fmtShortDay, fmtTime } from "@/lib/format";
import { LOG_TZ } from "@/lib/log";
import { useApp } from "@/components/shell";
import { Avatar, Badge, Button, Card, Empty, ListRow, Notice, Page, PageHeader, Skeleton, Tabs, field, tabPanelProps, table, useLoad, useToast, type Bar } from "@/components/ui";

/** Mirrors api/app/excuses.py KINDS and REASONS; keep them in sync. */
const KINDS: [string, string][] = [["bp", "BP check-in"], ["gm", "GM message"], ["study", "Study session"], ["event", "Event"], ["all", "Everything that day"]];
const REASONS: [string, string][] = [["exam", "Exam"], ["class", "Class"], ["sick", "Sick"], ["work", "Work"], ["family", "Family"], ["other", "Other"]];

const STATUS: Record<Excuse["status"], { label: string; tone: "neutral" | "ok" | "warn"; bar: Bar }> = {
  pending: { label: "Waiting for a reply", tone: "neutral", bar: "mid" },
  approved: { label: "Approved", tone: "ok", bar: "ok" },
  denied: { label: "Denied", tone: "warn", bar: "light" },
};

/** Today as YYYY-MM-DD in the group's timezone, for date input defaults. */
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LOG_TZ }).format(new Date());
}

function days(e: Excuse) {
  return e.start_day === e.end_day ? fmtDate(e.start_day) : `${fmtDate(e.start_day)} to ${fmtDate(e.end_day)}`;
}

export default function Excuses() {
  const { isLead } = useApp();
  return isLead ? <LeadExcuses /> : <MemberExcuses />;
}

/** What the request says, shared by both views. */
function Details({ e, showName }: { e: Excuse; showName: boolean }) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");

  async function openFile() {
    try {
      const url = await fileUrl(`/excuses/${e.id}/file`);
      if (e.file_type?.startsWith("image/")) setImage(url);
      else window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the file. Try again.");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-[15px] font-semibold leading-snug">{showName && <>{e.user_name} <span className="font-normal text-muted">·</span> </>}{e.kind_label}</p>
        <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
        {e.late && <Badge tone="warn">Late request</Badge>}
      </div>
      <p className="mt-0.5 text-[13px] leading-snug">{days(e)} · {e.reason_label}</p>
      {e.note && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-raised px-3 py-2.5 text-sm">{e.note}</p>}
      {e.has_file && !image && <Button variant="outline" className="mt-2.5 min-h-9" onClick={openFile}>View {e.file_type?.startsWith("image/") ? "photo" : "attachment"}</Button>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && <img src={image} alt={`Proof from ${e.user_name}`} className="mt-2.5 max-h-96 max-w-full rounded-xl border border-line" />}
      {e.status !== "pending" && e.reply && <div className="mt-2.5"><Notice tone={e.status === "approved" ? "ok" : "warn"}>{e.reviewer_name ?? "Reviewer"}: {e.reply}</Notice></div>}
      <p className="mt-1.5 text-xs text-muted tabular-nums">
        Requested <time dateTime={e.created_at}>{fmtShortDay(e.created_at, LOG_TZ)}, {fmtTime(e.created_at, LOG_TZ)}</time>
        {e.status !== "pending" && e.reviewer_name && !e.reply && <> · {STATUS[e.status].label} by {e.reviewer_name}</>}
      </p>
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </>
  );
}

function MemberExcuses() {
  const { org } = useApp();
  const toast = useToast();
  const mine = useLoad(() => api<Excuse[]>(`/orgs/${org.id}/excuses/mine`), [org.id]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const lead = org.lead_label.toLowerCase();

  async function withdraw(e: Excuse) {
    if (!window.confirm(`Withdraw your ${e.kind_label.toLowerCase()} request for ${days(e)}?`)) return;
    try {
      await api(`/excuses/${e.id}`, { method: "DELETE" });
      toast("Request withdrawn");
      mine.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't withdraw the request. Try again.");
    }
  }

  return (
    <Page>
      <PageHeader title="Excuses" hint="Tell the group ahead of time when you can't make something."
        action={<Button variant="primary" className="min-h-11 px-5" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Request excuse"}</Button>} />
      {adding && <RequestForm orgId={org.id} lead={lead} onDone={() => { setAdding(false); toast("Request sent"); mine.reload(); }} />}
      {error && <div className="mb-4"><Notice>{error}</Notice></div>}
      {mine.error && <Notice>{mine.error}</Notice>}
      {!mine.data && !mine.error && <Skeleton />}
      {mine.data?.length === 0 && <Empty title="No requests yet">Request an excuse before the day you&apos;ll miss. A {lead} approves or denies it.</Empty>}
      <ul className="space-y-2.5">
        {mine.data?.map((e) => (
          <ListRow key={e.id} bar={STATUS[e.status].bar}
            end={e.status === "pending" && <Button variant="ghost" className="shrink-0 self-start" onClick={() => withdraw(e)}>Withdraw</Button>}>
            <Details e={e} showName={false} />
          </ListRow>
        ))}
      </ul>
    </Page>
  );
}

function RequestForm({ orgId, lead, onDone }: { orgId: string; lead: string; onDone: () => void }) {
  const [form, setForm] = useState({ kind: "bp", start_day: today(), end_day: "", reason: "exam", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const late = form.start_day !== "" && form.start_day < today();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Check on the device first so people don't wait on an upload that will be rejected.
    if (form.end_day && form.end_day < form.start_day) return setError("The last day can't be before the first day.");
    if (form.reason === "other" && !form.note.trim()) return setError("Add a note that explains the reason.");
    if (file && file.size > 8 * 1024 * 1024) return setError("That file is over 8 MB. Pick a smaller one.");
    setBusy(true);
    setError("");
    const body = new FormData();
    Object.entries(form).forEach(([k, v]) => body.set(k, v));
    if (file) body.set("file", file);
    try {
      await api(`/orgs/${orgId}/excuses`, { method: "POST", body });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request. Try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="mb-7">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">What you&apos;ll miss
          <select value={form.kind} onChange={set("kind")} className={field}>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Reason
          <select value={form.reason} onChange={set("reason")} className={field}>
            {REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">First day
          <input type="date" required value={form.start_day} onChange={set("start_day")} className={field} />
        </label>
        <label className="text-sm font-medium">Last day (optional)
          <input type="date" min={form.start_day} value={form.end_day} onChange={set("end_day")} className={field} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">Note{form.reason === "other" ? "" : " (optional)"}
          <textarea rows={2} maxLength={500} value={form.note} onChange={set("note")} placeholder="e.g. Calc midterm 6 to 9 PM" className={field} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">Proof (JPEG, PNG, or PDF, optional)
          <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm font-normal" />
        </label>
        {late && <div className="sm:col-span-2"><Notice tone="warn">This day has already passed, so the request will be marked late.</Notice></div>}
        <p className="text-xs text-muted sm:col-span-2">Only you and this group&apos;s {lead}s can see your request and proof.</p>
        {error && <div className="sm:col-span-2"><Notice>{error}</Notice></div>}
        <div className="sm:col-span-2"><Button variant="primary" type="submit" busy={busy}>Send request</Button></div>
      </form>
    </Card>
  );
}

function LeadExcuses() {
  const { org } = useApp();
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const list = useLoad(() => api<Excuse[]>(`/orgs/${org.id}/excuses?status=${tab}`), [org.id, tab]);
  const summary = useLoad(() => api<ExcuseSummary>(`/orgs/${org.id}/excuses/summary`), [org.id]);
  const reload = () => { list.reload(); summary.reload(); };
  const member = org.member_label.toLowerCase();
  const people = summary.data?.members ?? [];

  return (
    <Page>
      <PageHeader title="Excuses" hint={summary.data ? `${summary.data.pending} waiting for a reply` : undefined} />
      <p className="-mt-5 mb-6 max-w-2xl text-sm text-muted">
        An approved excuse means the {member} isn&apos;t flagged for what they missed on those days.
      </p>
      <Tabs label="Requests" value={tab} onChange={setTab}
        tabs={[{ id: "pending", label: "Waiting", count: summary.data?.pending }, { id: "all", label: "All requests" }]} />
      <div {...tabPanelProps(tab)} className="mt-4">
        {list.error && <Notice>{list.error}</Notice>}
        {!list.data && !list.error && <Skeleton />}
        {list.data?.length === 0 && <Empty title={tab === "pending" ? "You're caught up" : "No requests yet"}>New requests land here the moment they come in.</Empty>}
        <ul className="space-y-2.5">
          {list.data?.map((e) => <ReviewRow key={e.id} e={e} onDone={reload} />)}
        </ul>
      </div>

      {people.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3.5 font-display text-lg font-semibold tracking-[-0.01em]">Requests by {member}</h2>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th scope="col" className={table.th}>Name</th>
                  <th scope="col" className="px-3 py-3 text-right font-normal">Waiting</th>
                  <th scope="col" className="px-3 py-3 text-right font-normal">Approved</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Denied</th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {people.map((p) => (
                  <tr key={p.user_id}>
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      <span className="flex items-center gap-2.5"><Avatar name={p.name} className="size-7 text-[10px]" />{p.name}</span>
                    </th>
                    <td className="px-3 text-right">{p.pending}</td>
                    <td className="px-3 text-right">{p.approved}</td>
                    <td className="px-4 text-right">{p.denied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Page>
  );
}

function ReviewRow({ e, onDone }: { e: Excuse; onDone: () => void }) {
  const toast = useToast();
  const [reply, setReply] = useState("");
  const [denying, setDenying] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "approved" | "denied">("");

  async function decide(decision: "approved" | "denied") {
    if (decision === "denied" && !reply.trim()) return setError("Say why before denying it.");
    setBusy(decision);
    setError("");
    try {
      await post(`/excuses/${e.id}/review`, { decision, reply });
      toast(decision === "approved" ? `Approved ${e.user_name}'s excuse` : `Denied ${e.user_name}'s excuse`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the decision. Try again.");
      setBusy("");
    }
  }

  return (
    <ListRow bar={STATUS[e.status].bar}>
      <Details e={e} showName />
      {e.status === "pending" && !denying && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" className="min-h-9" disabled={!!busy} onClick={() => setDenying(true)}>Deny</Button>
          <Button variant="primary" className="min-h-9" busy={busy === "approved"} disabled={!!busy} onClick={() => decide("approved")}>Approve</Button>
        </div>
      )}
      {denying && (
        <form className="mt-3 space-y-2" onSubmit={(ev) => { ev.preventDefault(); decide("denied"); }}>
          <label className="block text-sm font-medium">
            Why is it denied?
            <textarea autoFocus rows={2} maxLength={500} value={reply} onChange={(ev) => { setReply(ev.target.value); setError(""); }}
              aria-invalid={!!error} className={field} placeholder="Be specific, so they know what to do next." />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setDenying(false); setError(""); }}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy === "denied"}>Deny request</Button>
          </div>
        </form>
      )}
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </ListRow>
  );
}
