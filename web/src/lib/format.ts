export function fmtDay(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: tz }).format(new Date(iso));
}

export function fmtTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function fmtRange(start: string, end: string, tz: string) {
  return `${fmtDay(start, tz)}, ${fmtTime(start, tz)} to ${fmtTime(end, tz)}`;
}

export function fmtDue(iso: string | null, tz: string) {
  if (!iso) return "No due date";
  const ms = new Date(iso).getTime() - Date.now();
  const hours = Math.round(Math.abs(ms) / 36e5);
  const rel = hours < 1 ? "under an hour" : hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  const when = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  return ms < 0 ? `Was due ${when} (${rel} ago)` : `Due ${when} (in ${rel})`;
}

export function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function fmtClock(seconds: number) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(seconds / 3600))}:${p(Math.floor((seconds % 3600) / 60))}:${p(seconds % 60)}`;
}

/** Today's date for page headers, e.g. "Tuesday, November 10". */
export function fmtToday(tz: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(new Date());
}

/** Short day for rails and lists, e.g. "Tue, Nov 10". */
export function fmtShortDay(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(iso));
}
