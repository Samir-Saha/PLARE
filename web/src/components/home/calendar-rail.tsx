"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Meeting } from "@/lib/api";
import { fmtShortDay, fmtTime } from "@/lib/format";
import { Skeleton } from "@/components/ui";

export type RailItem = { id: string; at: string; kind: string; title: string; tone: "navy" | "mid" | "light"; extra?: ReactNode };

const border = { navy: "border-accent", mid: "border-accent-2", light: "border-accent-3" };

/** Meetings as rail items: confirmed ones navy, proposed ones mid blue. */
export function meetingItems(meetings: Meeting[], extra?: (m: Meeting) => ReactNode): RailItem[] {
  return meetings.map((m) => ({
    id: m.id, at: m.start_at, title: m.title, tone: m.status === "confirmed" ? "navy" : "mid",
    kind: `${m.status === "confirmed" ? "Meeting" : "Proposed meeting"} · ${m.yes} going`,
    extra: extra?.(m),
  }));
}

/** Right-hand calendar rail: items grouped by day, time on the left, a 2px colored border, type above title. */
export function CalendarRail({ title, items, tz, loading, error, footer, emptyText }: {
  title: string; items: RailItem[]; tz: string; loading?: boolean; error?: string; footer?: ReactNode; emptyText?: string;
}) {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
  const days: [string, RailItem[]][] = [];
  for (const it of sorted) {
    const d = fmtShortDay(it.at, tz);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(it);
    else days.push([d, [it]]);
  }

  return (
    <div className="flex h-full flex-col">
      {/* TODO(notifications): the mockup's bell button opens a notification center that isn't built yet. */}
      <h2 className="mb-6 font-display text-xl font-bold tracking-[-0.01em]">{title}</h2>
      {error && <p className="text-sm text-danger">{error}</p>}
      {loading && <Skeleton rows={2} />}
      {!loading && !error && days.length === 0 && <p className="text-[14px] text-muted">{emptyText ?? "Nothing scheduled yet."}</p>}
      <div className="space-y-6">
        {days.map(([day, list]) => (
          <section key={day}>
            <h3 className="mb-3 text-[13px] font-bold uppercase tracking-[0.04em] text-accent-2">{day}</h3>
            <ul className="space-y-4">
              {list.map((it) => (
                <li key={it.id} className="flex gap-3">
                  <time dateTime={it.at} className="w-[72px] shrink-0 pt-0.5 text-[15px] font-bold tabular-nums">{fmtTime(it.at, tz)}</time>
                  <div className={`min-w-0 flex-1 border-l-[3px] pl-3 ${border[it.tone]}`}>
                    <p className="text-xs text-muted">{it.kind}</p>
                    <p className="text-[15px] font-semibold leading-snug">{it.title}</p>
                    {it.extra}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {footer && <div className="mt-auto pt-10">{footer}</div>}
    </div>
  );
}

export function RailFooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 items-center justify-center rounded-xl border-[1.5px] border-dashed border-accent-2 text-[14px] font-bold text-accent hover:bg-surface hover:border-solid">
      {children}
    </Link>
  );
}
