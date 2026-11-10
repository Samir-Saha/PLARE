"use client";
import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-[-0.04em] ${className}`}>
      <span aria-hidden className="grid size-[1.15em] place-items-center rounded-[0.3em] bg-accent text-[0.7em] font-bold text-accent-fg">P</span>
      PLARE
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line bg-surface hover:bg-raised",
  ghost: "text-muted hover:bg-raised hover:text-text",
  danger: "border border-line bg-surface text-danger hover:bg-danger-soft",
};

export function Button({ variant = "secondary", busy, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>{children}</section>;
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
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "ok" | "warn"; children: ReactNode }) {
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-line/60" />
      ))}
    </div>
  );
}

export function ThemeToggle() {
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
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        localStorage.setItem("plare.theme", next);
      }}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </Button>
  );
}

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
