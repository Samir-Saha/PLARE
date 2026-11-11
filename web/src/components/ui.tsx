"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { IconCheck, IconMoon, IconSun } from "./icons";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-display font-bold tracking-[0.01em] text-text ${className}`}>
      <span aria-hidden className="flex h-[0.95em] items-end gap-[0.14em]">
        <span className="h-[55%] w-[0.22em] rounded-[2px] bg-accent-3" />
        <span className="h-[78%] w-[0.22em] rounded-[2px] bg-accent-2" />
        <span className="h-full w-[0.22em] rounded-[2px] bg-accent" />
      </span>
      PLARE
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "bg-accent-soft text-accent hover:bg-accent-3/45",
  ghost: "text-muted hover:bg-raised hover:text-text",
  danger: "border border-line bg-surface text-danger hover:bg-danger-soft",
  outline: "border border-line bg-surface text-text hover:bg-raised",
};

export function Button({ variant = "secondary", busy, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`relative inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[background-color,color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {/* Busy keeps the label in place (no width jump) and overlays a spinner. */}
      <span className={`inline-flex items-center gap-2 ${busy ? "invisible" : ""}`}>{children}</span>
      {busy && <span aria-hidden className="absolute inset-0 grid place-items-center"><Spinner /></span>}
    </button>
  );
}

/** Link styled as a button, for navigation that looks like an action. */
export function ButtonLink({ href, variant = "secondary", className = "", children, ...rest }: { href: string; variant?: Variant; className?: string; children: ReactNode; "aria-label"?: string }) {
  return (
    <Link href={href} {...rest} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span aria-hidden className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[18px] border border-line bg-surface p-5 ${className}`}>{children}</section>;
}

const tones = {
  neutral: "bg-raised text-muted border border-line",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function PageHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-[-0.01em] sm:text-[32px]">{title}</h1>
        {hint && <p className="mt-1 text-sm text-muted tabular-nums">{hint}</p>}
      </div>
      {action && <div className="flex items-center gap-3">{action}</div>}
    </header>
  );
}

/** Section heading with an optional underlined link on the right ("See all 12"). */
export function SectionHeader({ title, href, linkLabel, id, className = "" }: { title: string; href?: string; linkLabel?: string; id?: string; className?: string }) {
  return (
    <div className={`mb-3.5 flex items-baseline justify-between gap-3 ${className}`}>
      <h2 id={id} className="font-display text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      {href && linkLabel && <Link href={href} className="text-[13px] font-medium text-accent underline underline-offset-2 tabular-nums">{linkLabel}</Link>}
    </div>
  );
}

/**
 * Page body inside the app frame. `rail` renders a raised column flush with the frame's right
 * edge on wide screens (the calendar rail in the mockup); on narrower screens it stacks below.
 */
export function Page({ children, rail, railLabel, railOnMobile = true }: { children: ReactNode; rail?: ReactNode; railLabel?: string; railOnMobile?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col xl:flex-row">
      <div className="min-w-0 flex-1 px-5 pb-10 pt-6 sm:px-8 md:px-10 md:pt-9">
        <div className="mx-auto w-full max-w-[1080px]">{children}</div>
      </div>
      {rail && (
        <aside aria-label={railLabel}
          className={`border-t border-line bg-raised px-5 py-8 sm:px-8 xl:w-[280px] xl:shrink-0 xl:border-l xl:border-t-0 xl:px-6 xl:pt-8 ${railOnMobile ? "" : "hidden xl:block"}`}>
          {rail}
        </aside>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-line bg-raised px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "ok" | "warn"; children: ReactNode }) {
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-[14px] bg-line/60" />
      ))}
    </div>
  );
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => observer.disconnect();
    },
    () => document.documentElement.dataset.theme ?? "light",
    () => "light",
  );
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      className={className}
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        localStorage.setItem("plare.theme", next);
      }}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </Button>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function Avatar({ name, className = "size-9 text-xs" }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-accent-soft font-display font-semibold text-accent ${className}`}>
      {initials(name)}
    </span>
  );
}

/** Overlapping initials: a "+N" chip first, then the most recent few people (as in the mockup). */
export function AvatarStack({ names, max = 2, ring = "ring-surface" }: { names: string[]; max?: number; ring?: string }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const chip = `-ml-1.5 grid h-7 min-w-7 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums ring-2 first:ml-0 ${ring}`;
  return (
    <span role="img" aria-label={`${names.length} ${names.length === 1 ? "person" : "people"}`} className="flex items-center">
      {rest > 0 && <span aria-hidden className={`${chip} relative z-10 bg-surface text-[9px] text-accent`}>+{rest}</span>}
      {shown.map((n, i) => (
        <span key={n + i} aria-hidden className={`${chip} ${i % 2 ? "bg-surface text-accent" : "bg-accent-3 text-accent"}`}>{initials(n)}</span>
      ))}
    </span>
  );
}

export function Progress({ value, label, track = "bg-line", fill = "bg-accent", className = "h-1.5" }: { value: number; label: string; track?: string; fill?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`overflow-hidden rounded-full ${track} ${className}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full transition-[width] ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export const cardTones = {
  navy: { box: "bg-accent text-accent-fg", sub: "text-on-accent-muted", track: "bg-on-accent-muted/30", fill: "bg-accent-fg", ring: "ring-accent" },
  mid: { box: "bg-accent-2 text-accent-2-fg", sub: "text-accent-2-fg/85", track: "bg-accent-2-fg/25", fill: "bg-accent-2-fg", ring: "ring-accent-2" },
  light: { box: "bg-accent-soft text-text", sub: "text-muted", track: "bg-surface/80", fill: "bg-accent", ring: "ring-accent-soft" },
};

/** Dashboard summary card: people + period on top, title, one-line stat, bar, footnote. */
export function SummaryCard({ tone, title, stat, pct, people, meta, foot }: {
  tone: keyof typeof cardTones; title: string; stat: ReactNode; pct?: number; people?: string[]; meta?: ReactNode; foot?: ReactNode;
}) {
  const t = cardTones[tone];
  return (
    <section className={`flex min-h-[196px] flex-col rounded-[18px] px-[22px] pb-5 pt-[22px] ${t.box}`}>
      <div className="mb-5 flex min-h-7 items-center justify-between gap-2">
        {people && people.length > 0 ? <AvatarStack names={people} ring={t.ring} /> : <span />}
        {meta && <span className={`text-xs tabular-nums ${t.sub}`}>{meta}</span>}
      </div>
      <h2 className="font-display text-xl font-semibold leading-tight">{title}</h2>
      <p className={`mt-1 text-[13px] leading-snug tabular-nums ${t.sub}`}>{stat}</p>
      {pct !== undefined && <div className="mt-auto pt-5"><Progress value={pct} label={title} track={t.track} fill={t.fill} /></div>}
      {foot && <p className={`mt-3 text-xs tabular-nums ${t.sub}`}>{foot}</p>}
    </section>
  );
}

export function SummaryRow({ children }: { children: ReactNode }) {
  return <div className="mb-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

/** One stat in a <dl>: raised tile, big display number on top, small muted label below. */
export function StatTile({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" }) {
  return (
    <div className="flex flex-col-reverse justify-end rounded-[14px] bg-raised px-4 py-4">
      <dt className="mt-1.5 text-xs text-muted">{label}</dt>
      <dd className={`font-display text-[26px] font-semibold leading-none tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{value}</dd>
    </div>
  );
}

const bars = { navy: "bg-accent", mid: "bg-accent-2", light: "bg-accent-3", ok: "bg-ok", danger: "bg-danger" };
export type Bar = keyof typeof bars;

/** Stable navy / mid / light bar color for a category name. */
export function barFor(key: string): Bar {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (["navy", "mid", "light"] as const)[h % 3];
}

/**
 * List row: white, 1px line border, 14px radius, a 3px rounded bar inset on the left, content,
 * and an optional control on the right (`end`). Renders an <li>. Pass `bar={null}` for no bar.
 */
export function ListRow({ bar = "navy", className = "", end, children }: { bar?: Bar | null; className?: string; end?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-4 rounded-[14px] border border-line bg-surface py-3.5 pl-4 pr-3">
      {bar && <span aria-hidden className={`my-0.5 w-[3px] shrink-0 self-stretch rounded-full ${bars[bar]}`} />}
      <div className={`min-w-0 flex-1 ${className}`}>{children}</div>
      {end}
    </li>
  );
}

const circle = "grid size-8 place-items-center rounded-full transition-colors";

/** Round check control on the right of a list row: a 32px circle in a 44px touch target. */
export function CheckButton({ active, label, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={`group grid size-11 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      <span className={`${circle} ${active ? "bg-accent text-accent-fg" : "border-[1.5px] border-muted/35 text-transparent group-hover:border-accent group-hover:text-accent"}`}>
        {children ?? <IconCheck width={16} height={16} strokeWidth={2.25} />}
      </span>
    </button>
  );
}

/** Non-interactive filled navy check, for finished items. */
export function CheckMark({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className="grid size-11 shrink-0 place-items-center">
      <span className={`${circle} bg-accent text-accent-fg`}><IconCheck width={16} height={16} strokeWidth={2.25} /></span>
    </span>
  );
}

/** Link styled like an empty round check (e.g. "open this in the review queue"). */
export function CheckLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} title={label} className="group grid size-11 shrink-0 place-items-center rounded-full">
      <span className={`${circle} border-[1.5px] border-muted/35 text-transparent group-hover:border-accent group-hover:text-accent`}>
        <IconCheck width={16} height={16} strokeWidth={2.25} />
      </span>
    </Link>
  );
}

/** Shared classes for bordered tables with a raised header. */
export const table = {
  wrap: "overflow-x-auto rounded-[14px] border border-line bg-surface",
  table: "w-full text-sm tabular-nums",
  head: "bg-raised text-left text-[13px] text-muted",
  th: "px-4 py-3 font-normal",
  body: "divide-y divide-line",
  cell: "px-4 py-3",
};

/** Shared class for text inputs and selects. */
export const field = "mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm font-normal text-text";

/** Loads data on mount and whenever deps change; exposes reload for after mutations. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (d) => live && (setData(d), setError("")),
      (e) => live && setError(e instanceof Error ? e.message : "Something went wrong."),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}


/* ---------- Dialog ---------- */

/**
 * Accessible modal built on the native <dialog>: focus moves in and is trapped,
 * Escape closes it, and focus returns to the opener when it closes.
 */
export function Dialog({ open, onClose, title, description, children, size = "md" }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; size?: "md" | "sheet";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const shape = size === "sheet"
    ? "mt-auto mb-0 w-full max-w-none rounded-t-[20px] pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:m-auto sm:max-w-md sm:rounded-[18px] sm:pb-5"
    : "w-[calc(100%-2rem)] max-w-md rounded-[18px]";
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={`m-auto border border-line bg-surface p-5 text-text shadow-frame backdrop:bg-black/40 ${shape}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close"
          className="-m-1 grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-raised hover:text-text">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {open && children}
    </dialog>
  );
}

/* ---------- Toasts ---------- */

type Toast = { id: number; text: string; tone: "ok" | "danger" };
const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

/** Short confirmations after an action ("Saved", "Link copied"). Announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div role="status" aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6">
        {toasts.map((t) => (
          <p key={t.id} className={`pointer-events-auto rounded-xl px-4 py-2.5 text-sm font-medium shadow-frame ${t.tone === "ok" ? "bg-accent text-accent-fg" : "bg-danger text-white"}`}>
            {t.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------- Tabs ---------- */

/** Tab bar with arrow-key navigation. Render the active panel yourself with `tabPanelProps`. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`}
            aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors duration-150 ${on ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}>
            {t.label}
            {t.count !== undefined && <span className="rounded-full bg-raised px-1.5 text-xs tabular-nums text-muted">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(id: string) {
  return { role: "tabpanel", id: `panel-${id}`, "aria-labelledby": `tab-${id}`, tabIndex: 0 } as const;
}
