import type { CSSProperties, ReactNode } from "react";
import { IconCamera, IconCheck } from "./icons";

/*
 * Landing-page pieces. Everything here is an illustration of the product, never real activity:
 * the hero grid is an example week and the step cards are UI samples.
 */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = ["5 PM", "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM"];
const TOTAL = 16;
// Free members per hour (rows) and day (columns) in the example week. Thursday 8 PM is the best hour.
const FREE = [
  [3, 5, 2, 6, 4, 8, 7],
  [5, 7, 4, 9, 5, 9, 8],
  [8, 6, 7, 11, 6, 7, 10],
  [9, 10, 8, 14, 7, 5, 11],
  [7, 11, 9, 12, 4, 4, 9],
  [4, 8, 6, 9, 3, 3, 6],
  [2, 4, 3, 5, 2, 2, 3],
];
const BEST = { row: 3, col: 3 };

function shade(n: number) {
  const r = n / TOTAL;
  if (r >= 0.7) return "bg-accent";
  if (r >= 0.5) return "bg-accent-2";
  if (r >= 0.35) return "bg-accent-3";
  if (r >= 0.2) return "bg-accent-3/45";
  return "bg-accent-soft";
}

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/** The hero: an example week's availability filling in, then the best hour locking in gold. */
export function AvailabilityHero() {
  return (
    <figure aria-label={`Example week. Thursday at 8 PM is the best hour: 14 of ${TOTAL} members are free.`}
      className="relative w-full max-w-[560px] rounded-[22px] border border-line bg-surface p-4 shadow-frame sm:p-6">
      <div aria-hidden className="mb-4 flex items-baseline justify-between gap-3">
        <p className="font-display text-[17px] font-bold">Example week</p>
        <p className="text-xs font-medium text-muted tabular-nums">{TOTAL} members</p>
      </div>
      <div aria-hidden className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5">
        <span />
        {DAYS.map((d, c) => (
          <span key={d} className={`pb-1 text-center text-[11px] font-semibold sm:text-xs ${c === BEST.col ? "text-text" : "text-muted"}`}>{d}</span>
        ))}
        {FREE.map((row, r) => (
          <Row key={r} label={HOURS[r]} strong={r === BEST.row}>
            {row.map((n, c) => {
              const best = r === BEST.row && c === BEST.col;
              return (
                <span key={c} className={`relative aspect-square ${best ? "z-10" : ""}`}>
                  <span
                    className={`absolute inset-0 rounded-[5px] sm:rounded-md ${best ? "bg-gold" : shade(n)} motion-safe:animate-[plare-cell_420ms_var(--ease-out-soft)_both]`}
                    style={delay(best ? 1150 : 120 + (c * 7 + r) * 18)}
                  />
                  {best && (
                    <span className="absolute -inset-1.5 rounded-[9px] border-[2.5px] border-gold motion-safe:animate-[plare-lock_520ms_var(--ease-out-soft)_both] sm:-inset-2 sm:rounded-[11px]"
                      style={delay(1450)} />
                  )}
                </span>
              );
            })}
          </Row>
        ))}
      </div>
      <figcaption className="mt-5 flex items-center gap-3 rounded-xl bg-accent px-4 py-3 text-accent-fg motion-safe:animate-[plare-rise_420ms_var(--ease-out-soft)_both]" style={delay(1750)}>
        <span aria-hidden className="size-3 shrink-0 rounded-[3px] bg-gold" />
        <span className="min-w-0">
          <span className="block font-display text-[19px] font-extrabold leading-tight">Thursday, 8 PM</span>
          <span className="block text-[13px] text-on-accent-muted tabular-nums">14 of {TOTAL} free for two hours</span>
        </span>
      </figcaption>
    </figure>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <>
      <span className={`self-center whitespace-nowrap pr-1.5 text-right text-[11px] font-semibold tabular-nums sm:pr-2 sm:text-xs ${strong ? "text-text" : "text-muted"}`}>{label}</span>
      {children}
    </>
  );
}

/* ---------- The weekly loop: assign, submit, review ---------- */

export function StepAssign() {
  return (
    <div aria-hidden className="space-y-2">
      {[
        { t: "BP post: chapter history", d: "Due Thu, 11:59 PM", on: true },
        { t: "Coffee chat with a brother", d: "Due Fri, 5:00 PM" },
        { t: "Study hours", d: "6 of 8 hours this week" },
      ].map((r) => (
        <div key={r.t} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${r.on ? "border-accent-2 bg-accent-soft/60" : "border-line bg-surface"}`}>
          <span className={`h-7 w-1 shrink-0 rounded-full ${r.on ? "bg-accent-2" : "bg-line-strong"}`} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{r.t}</span>
            <span className="block text-xs text-muted tabular-nums">{r.d}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function StepSubmit() {
  return (
    <div aria-hidden className="rounded-lg border border-line bg-surface p-3">
      <p className="text-sm font-semibold">BP post: chapter history</p>
      <div className="mt-2.5 grid aspect-[16/9] place-items-center rounded-md border border-dashed border-line-strong bg-raised text-muted">
        <span className="flex flex-col items-center gap-1.5 text-xs font-medium"><IconCamera width={22} height={22} />Photo of the post</span>
      </div>
      <p className="mt-2.5 rounded-md bg-raised px-2.5 py-2 text-xs text-muted">Posted to the chapter story at 9:40 PM.</p>
      <span className="mt-2.5 flex min-h-9 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-accent-fg">Submit for review</span>
    </div>
  );
}

export function StepReview() {
  return (
    <div aria-hidden className="space-y-2">
      <div className="rounded-lg border border-line bg-surface p-3">
        <p className="text-sm font-semibold">BP post: chapter history</p>
        <p className="text-xs text-muted">Submitted 12 min ago</p>
        <div className="mt-3 flex gap-2">
          <span className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-xs font-semibold text-accent-fg"><IconCheck width={14} height={14} />Approve</span>
          <span className="flex min-h-9 flex-1 items-center justify-center rounded-lg border border-line-strong text-xs font-semibold">Request revision</span>
        </div>
      </div>
      <div className="flex items-center gap-2.5 rounded-lg border border-gold/40 bg-gold-soft px-3 py-2.5 text-xs font-semibold text-gold-ink">
        <span className="size-2 shrink-0 rounded-full bg-gold" />Approved. 7 of 9 requirements done.
      </div>
    </div>
  );
}
