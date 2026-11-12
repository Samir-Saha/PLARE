"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode, type SVGProps } from "react";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useLoad } from "@/components/ui";
import { IconBell, IconChevronLeft, IconChevronRight } from "@/components/icons";

/* ---------- date helpers (always in the viewer's timezone) ---------- */

/** YYYY-MM-DD for an instant, in a timezone. */
export function dayKey(iso: string | number | Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function timeAgo(iso: string, nowMs: number) {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

/* ---------- KPI card ---------- */

const kpiTones = {
  navy: { box: "bg-accent text-accent-fg", sub: "text-on-accent-muted", icon: "bg-gold text-gold-fg", track: "bg-accent-fg/20", fill: "bg-gold" },
  mid: { box: "bg-accent-2 text-accent-2-fg", sub: "text-accent-2-fg/75", icon: "bg-accent-2-fg/15", track: "bg-accent-2-fg/25", fill: "bg-accent-2-fg" },
  light: { box: "bg-accent-soft text-text", sub: "text-muted", icon: "bg-surface text-accent", track: "bg-accent-3/40", fill: "bg-accent" },
  plain: { box: "border border-line bg-surface text-text", sub: "text-muted", icon: "bg-surface text-accent", track: "bg-line", fill: "bg-accent-2" },
};

/** Compact metric card. `pct` is omitted when there's no denominator, so no fake 0% bar is drawn. */
export function KpiCard({ tone, icon: Icon, label, value, unit, sub, pct, href }: {
  tone: keyof typeof kpiTones; icon: (p: SVGProps<SVGSVGElement>) => ReactNode; label: string; value: ReactNode; unit?: string;
  sub: string; pct?: number; href?: string;
}) {
  const t = kpiTones[tone];
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg ${t.icon}`}><Icon width={17} height={17} /></span>
        <p className="text-[13px] font-semibold">{label}</p>
      </div>
      <p className="mt-4 whitespace-nowrap font-display text-[26px] font-extrabold leading-none tabular-nums sm:text-[32px]">
        {value}{unit && <span className="ml-1.5 text-[15px] font-semibold">{unit}</span>}
      </p>
      <p className={`mt-1.5 line-clamp-2 text-xs ${t.sub}`}>{sub}</p>
      {pct !== undefined && (
        <div className={`mt-3 h-1 overflow-hidden rounded-full ${t.track}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${t.fill}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
      )}
    </>
  );
  const cls = `block min-w-0 rounded-2xl p-4 sm:p-5 ${t.box}`;
  return href ? <Link href={href} className={`${cls} transition-[translate,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-pop active:translate-y-0`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/* ---------- Panel ---------- */

export function Panel({ title, icon: Icon, action, children, className = "" }: {
  title: string; icon?: (p: SVGProps<SVGSVGElement>) => ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[17px] font-bold">
          {Icon && <Icon width={18} height={18} className="text-accent-2" />}{title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[13px] font-medium text-accent-2 hover:underline">
      {children}<IconChevronRight width={14} height={14} />
    </Link>
  );
}

/** Small inline empty state for panels. */
export function PanelEmpty({ icon: Icon, title, children }: { icon?: (p: SVGProps<SVGSVGElement>) => ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-4 py-6 text-center">
      {Icon && <Icon width={22} height={22} className="mb-2 text-muted" />}
      <p className="text-sm font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-xs text-[13px] text-muted">{children}</div>}
    </div>
  );
}

/* ---------- Donut ---------- */

export function Donut({ segments, center, sub }: { segments: { value: number; className: string }[]; center: string; sub: string }) {
  const total = segments.reduce((t, s) => t + s.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative size-[116px] shrink-0">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-line" />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = <circle key={i} cx="50" cy="50" r={r} fill="none" strokeWidth="10" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} className={s.className} />;
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <p className="font-display text-xl font-bold tabular-nums leading-none">{center}</p>
        <p className="mt-1 text-[11px] text-muted">{sub}</p>
      </div>
    </div>
  );
}

/* ---------- Mini calendar ---------- */

export type CalItem = { id: string; at: string; title: string; kind: string; href?: string };

/** Month grid with a dot on days that have items. Selecting a day filters the list under it. */
export function MiniCalendar({ tz, items, selected, onSelect }: { tz: string; items: CalItem[]; selected: string | null; onSelect: (day: string | null) => void }) {
  const [today] = useState(() => dayKey(Date.now(), tz));
  const [month, setMonth] = useState(() => { const [y, m] = today.split("-").map(Number); return { y, m }; });
  const busy = useMemo(() => new Set(items.map((i) => dayKey(i.at, tz))), [items, tz]);
  const first = new Date(Date.UTC(month.y, month.m - 1, 1));
  const days = new Date(Date.UTC(month.y, month.m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const shift = (d: number) => setMonth(({ y, m }) => { const n = new Date(Date.UTC(y, m - 1 + d, 1)); return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1 }; });
  const key = (d: number) => `${month.y}-${String(month.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface hover:text-text"><IconChevronLeft width={16} height={16} /></button>
        <p className="text-sm font-semibold" aria-live="polite">{title}</p>
        <button type="button" onClick={() => shift(1)} aria-label="Next month" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface hover:text-text"><IconChevronRight width={16} height={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs" role="grid" aria-label={title}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i} aria-hidden className="pb-1 text-[11px] font-medium text-muted">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1;
          const k = key(d);
          const isToday = k === today;
          const isSel = k === selected;
          return (
            <button key={k} type="button" onClick={() => onSelect(isSel ? null : k)} aria-pressed={isSel}
              aria-label={`${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.y, month.m - 1, d)))}${busy.has(k) ? ", has events" : ""}`}
              className={`relative mx-auto grid size-8 place-items-center rounded-lg tabular-nums transition-colors duration-150 ${isSel ? "bg-accent font-semibold text-accent-fg" : isToday ? "bg-accent-soft font-semibold text-accent" : "hover:bg-surface"}`}>
              {d}
              {busy.has(k) && <span aria-hidden className={`absolute bottom-0.5 size-1 rounded-full ${isSel ? "bg-accent-fg" : "bg-accent-2"}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function UpcomingList({ items, tz, empty }: { items: CalItem[]; tz: string; empty: string }) {
  if (items.length === 0) return <p className="py-2 text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((i) => {
        const body = (
          <>
            <span aria-hidden className={`mt-0.5 h-8 w-[3px] shrink-0 rounded-full ${i.kind === "Meeting" ? "bg-accent" : "bg-accent-3"}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{i.title}</span>
              <span className="block truncate text-xs text-muted">
                {i.kind} · {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(i.at))}, {fmtTime(i.at, tz)}
              </span>
            </span>
            {i.href && <IconChevronRight width={15} height={15} className="mt-1 shrink-0 text-muted" />}
          </>
        );
        return (
          <li key={i.id}>
            {i.href
              ? <Link href={i.href} className="flex gap-2.5 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-surface">{body}</Link>
              : <div className="flex gap-2.5 px-2 py-2">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Notifications ---------- */

type Note = { id: string; category: string; title: string; body: string; link: string; read: boolean; created_at: string };

/** Bell with an unread dot, backed by the existing /notifications API. */
export function NotificationBell() {
  const router = useRouter();
  const notes = useLoad(() => api<Note[]>("/notifications"), []);
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const unread = (notes.data ?? []).filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function markAll() {
    await api("/notifications/read", { method: "POST" }).catch(() => {});
    notes.reload();
  }

  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setNowMs(Date.now()); setOpen((v) => !v); }}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid size-11 place-items-center rounded-xl border border-line bg-surface text-text transition-colors duration-150 hover:bg-raised">
        <IconBell width={19} height={19} />
        {unread > 0 && <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-danger ring-2 ring-surface" />}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface shadow-frame">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && <button type="button" onClick={markAll} className="text-xs font-medium text-accent-2 hover:underline">Mark all read</button>}
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {notes.error && <li className="px-4 py-3 text-sm text-danger">{notes.error}</li>}
            {notes.data?.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">You&apos;re all caught up.</li>}
            {notes.data?.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => { setOpen(false); if (n.link) router.push(n.link); }}
                  className="flex w-full gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-raised">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-accent-2"}`} />
                  <span className="min-w-0">
                    <span className={`block text-[13px] ${n.read ? "text-muted" : "font-semibold"}`}>{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                    <span className="block text-[11px] text-muted">{timeAgo(n.created_at, nowMs)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2.5">
            <Link href="/app/notifications" onClick={() => setOpen(false)} className="text-xs font-semibold text-accent-2 hover:underline">See all notifications</Link>
          </div>
        </div>
      )}
    </div>
  );
}
