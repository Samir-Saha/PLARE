"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type AppNotification } from "@/lib/api";
import { fmtShortDay, fmtTime } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Button, Empty, Notice, Page, PageHeader, Skeleton, useLoad } from "@/components/ui";

export default function NotificationsPage() {
  const { me } = useApp();
  const router = useRouter();
  const notes = useLoad(() => api<AppNotification[]>("/notifications"), []);
  const [busy, setBusy] = useState(false);
  const unread = (notes.data ?? []).filter((n) => !n.read).length;

  async function mark(ids?: string[]) {
    setBusy(true);
    try {
      await api("/notifications/read", { method: "POST", body: ids ? JSON.stringify({ ids }) : "{}" });
      notes.reload();
    } finally {
      setBusy(false);
    }
  }

  async function open(n: AppNotification) {
    if (!n.read) await mark([n.id]);
    if (n.link) router.push(n.link);
  }

  return (
    <Page>
      <PageHeader title="Notifications" hint="Updates about tasks, reminders, BP posts, and alarms."
        action={unread > 0 ? <Button onClick={() => mark()} busy={busy}>Mark all read</Button> : undefined} />
      {notes.error && <Notice>{notes.error}</Notice>}
      {!notes.data && !notes.error && <Skeleton rows={4} />}
      {notes.data?.length === 0 && <Empty title="You're all caught up">New updates will show up here.</Empty>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {notes.data?.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => open(n)}
              className="flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised">
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-accent-2"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] ${n.read ? "text-muted" : "font-semibold"}`}>{n.title}</span>
                {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
                <span className="mt-1 block text-xs text-muted">{fmtShortDay(n.created_at, me.timezone)} · {fmtTime(n.created_at, me.timezone)}</span>
              </span>
              {n.link && <Link href={n.link} onClick={(e) => e.stopPropagation()} className="shrink-0 self-center text-xs font-semibold text-accent-2">Open</Link>}
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}
