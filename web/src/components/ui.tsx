"use client";
import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconCheck, IconMoon, IconSun } from "./icons";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-display font-bold tracking-[-0.02em] ${className}`}>
      <span aria-hidden className="flex h-[0.9em] items-end gap-[0.12em]">
        <span className="h-full w-[0.2em] rounded-full bg-accent" />
        <span className="h-[72%] w-[0.2em] rounded-full bg-accent-2" />
        <span className="h-[48%] w-[0.2em] rounded-full bg-accent-3" />
      </span>
      PLARE
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "bg-accent-soft text-accent hover:bg-accent-3/45",
  ghost: "text-muted hover:bg-raised hover:text-text",
  danger: "border border-line bg-surface text-danger hover:bg-danger-soft",
};

export function Button({ variant = "secondary", busy, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[18px] border border-line bg-surface p-4 sm:p-5 ${className}`}>{children}</section>;
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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">{title}</h1>
        {hint && <p className="mt-1.5 text-sm text-muted tabular-nums">{hint}</p>}
      </div>
      {action}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[18px] border border-dashed border-line bg-raised px-4 py-8 text-center">
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
    <div aria-busy="true" aria-label="Loading" className="space-y-2">
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

/** Overlapping initials for a handful of people, with a "+N" for the rest. */
export function AvatarStack({ names, max = 4, ring = "ring-surface" }: { names: string[]; max?: number; ring?: string }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span role="img" aria-label={`${names.length} ${names.length === 1 ? "person" : "people"}`} className="flex items-center">
      {shown.map((n, i) => <Avatar key={n + i} name={n} className={`-ml-2 size-7 text-[10px] ring-2 first:ml-0 ${ring}`} />)}
      {rest > 0 && <span aria-hidden className={`-ml-2 grid size-7 place-items-center rounded-full bg-raised text-[10px] font-semibold text-muted tabular-nums ring-2 ${ring}`}>+{rest}</span>}
    </span>
  );
}

export function Progress({ value, label, track = "bg-line", fill = "bg-accent" }: { value: number; label: string; track?: string; fill?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`h-1.5 overflow-hidden rounded-full ${track}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full transition-[width] ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const cardTones = {
  navy: { box: "bg-accent text-accent-fg", sub: "text-on-accent-muted", track: "bg-on-accent-muted/30", fill: "bg-accent-fg", ring: "ring-accent" },
  mid: { box: "bg-accent-2 text-accent-2-fg", sub: "text-accent-2-fg/85", track: "bg-accent-2-fg/25", fill: "bg-accent-2-fg", ring: "ring-accent-2" },
  light: { box: "bg-accent-soft text-text", sub: "text-muted", track: "bg-surface", fill: "bg-accent", ring: "ring-accent-soft" },
};

/** Dashboard summary card: title, one-line stat, optional people and progress. */
export function SummaryCard({ tone, title, stat, pct, people }: { tone: keyof typeof cardTones; title: string; stat: ReactNode; pct?: number; people?: string[] }) {
  const t = cardTones[tone];
  return (
    <section className={`flex min-h-40 flex-col rounded-[18px] p-5 ${t.box}`}>
      {people && people.length > 0 && <div className="mb-4"><AvatarStack names={people} ring={t.ring} /></div>}
      <h2 className="font-display text-lg font-semibold leading-tight">{title}</h2>
      <p className={`mt-1 text-sm tabular-nums ${t.sub}`}>{stat}</p>
      {pct !== undefined && (
        <div className="mt-auto flex items-center gap-3 pt-5">
          <div className="flex-1"><Progress value={pct} label={title} track={t.track} fill={t.fill} /></div>
          <span className="font-display text-sm font-semibold tabular-nums">{Math.round(pct)}%</span>
        </div>
      )}
    </section>
  );
}

export function SummaryRow({ children }: { children: ReactNode }) {
  return <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

/** One stat in a <dl>: raised tile, big display number, small muted label. */
export function StatTile({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" }) {
  return (
    <div className="rounded-[14px] bg-raised p-4">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={`mt-1 font-display text-3xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{value}</dd>
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

/** List row: white, 1px line border, 4px colored bar on the left. Renders an <li>. */
export function ListRow({ bar = "navy", className = "", children }: { bar?: Bar; className?: string; children: ReactNode }) {
  return (
    <li className={`relative overflow-hidden rounded-[14px] border border-line bg-surface py-3.5 pl-5 pr-3 sm:pr-4 ${className}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bars[bar]}`} />
      {children}
    </li>
  );
}

/** Round check control on the right of a list row. Icon-only, so it always takes a label. */
export function CheckButton({ active, label, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={`grid size-11 shrink-0 place-items-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-accent bg-accent text-accent-fg" : "border-line text-muted hover:border-accent hover:text-accent"} ${className}`}>
      {children ?? <IconCheck />}
    </button>
  );
}

/** Non-interactive filled check, for finished items. */
export function CheckMark({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className="grid size-11 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
      <IconCheck />
    </span>
  );
}

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
