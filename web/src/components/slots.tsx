import type { ReactNode } from "react";
import type { Slots, SlotOption } from "@/lib/api";
import { fmtRange } from "@/lib/format";
import { Badge, Empty, ListRow } from "./ui";

/** Ranked meeting or study options. Never shows a time the availability data doesn't support. */
export function SlotList({ slots, action }: { slots: Slots; action?: (o: SlotOption) => ReactNode }) {
  return (
    <div className="space-y-3">
      {slots.no_data.length > 0 && (
        <p className="text-sm text-muted">
          No availability yet from {slots.no_data.join(", ")}. They&apos;re counted as unavailable until they add it.
        </p>
      )}
      {slots.options.length === 0 && (
        <Empty title="No shared time found">Try a shorter length or a longer search window, or ask people to add availability.</Empty>
      )}
      <ul className="space-y-2">
      {slots.options.map((o, i) => (
        <ListRow key={o.start + o.count} bar={o.count === o.total ? "ok" : i === 0 ? "navy" : "light"} className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={o.count === o.total ? "ok" : i === 0 ? "accent" : "neutral"}>
                {o.count === o.total ? "Everyone free" : i === 0 ? "Best match" : "Alternative"}
              </Badge>
              <span className="text-sm font-medium tabular-nums">{o.count}/{o.total} available</span>
            </div>
            <p className="mt-1 font-medium">{fmtRange(o.start, o.end, slots.timezone)}</p>
            {o.unavailable.length > 0 && <p className="text-sm text-muted">Can&apos;t make it: {o.unavailable.join(", ")}</p>}
          </div>
          {action?.(o)}
        </ListRow>
      ))}
      </ul>
    </div>
  );
}
