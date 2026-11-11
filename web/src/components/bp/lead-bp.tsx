"use client";
import { useState } from "react";
import { api, fileUrl } from "@/lib/api";
import { RESPONSE_LABEL, WEEKDAYS, kindLabel, type BpGroupBlocks, type BpRandomSettings, type BpToday } from "@/lib/bp";
import { fmtShortDay, fmtTime } from "@/lib/format";
import { fromTime, toTime } from "@/lib/push";
import { useApp } from "@/components/shell";
import { Avatar, Badge, Button, Card, Empty, ListRow, Notice, Skeleton, field, table, useLoad, useToast } from "@/components/ui";
import { whenLabel } from "./blocks";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

const hours = (m: number) => (m % 60 ? `${(m / 60).toFixed(1)}h` : `${m / 60}h`);

export function RandomLeadBp() {
  const { org } = useApp();
  const today = useLoad(() => api<BpToday>(`/orgs/${org.id}/bp/random/today`), [org.id]);
  const blocks = useLoad(() => api<BpGroupBlocks>(`/orgs/${org.id}/bp/random/blocks`), [org.id]);
  return (
    <div className="space-y-9">
      {today.data && <SettingsCard initial={today.data.settings} onSaved={today.reload} />}
      {today.error && <Notice>{today.error}</Notice>}
      {!today.data && !today.error && <Skeleton />}
      {today.data && <TodayTable d={today.data} />}
      {today.data && <Recent d={today.data} />}
      <Blocks data={blocks.data} error={blocks.error} memberLabel={org.member_label} />
    </div>
  );
}

function SettingsCard({ initial, onSaved }: { initial: BpRandomSettings; onSaved: () => void }) {
  const { org } = useApp();
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const zones = ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES];

  async function save(next: BpRandomSettings) {
    setBusy(true);
    setError("");
    try {
      setS(await api<BpRandomSettings>(`/orgs/${org.id}/bp/random/settings`, { method: "PUT", body: JSON.stringify(next) }));
      toast(next.enabled ? "BP check-in settings saved" : "BP check-ins are off");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the settings.");
    } finally {
      setBusy(false);
    }
  }

  const toggleDay = (i: number) => setS({ ...s, weekdays: s.weekdays.includes(i) ? s.weekdays.filter((d) => d !== i) : [...s.weekdays, i].sort() });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Random BP check-ins</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {org.member_label}s get a notification at a random time and send a photo in business professional, taken in the app.
            Check-ins skip the times each {org.member_label.toLowerCase()} can&apos;t take a photo. They can always say they can&apos;t right now, with a reason.
          </p>
        </div>
        <Badge tone={initial.enabled ? "ok" : "neutral"}>{initial.enabled ? "On" : "Off"}</Badge>
      </div>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(s); }}>
        <label className="flex items-center gap-2.5 text-sm font-medium sm:col-span-2">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} className="size-4 accent-accent" />
          Turn on random BP check-ins for this group
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">Days</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <button key={d} type="button" aria-pressed={s.weekdays.includes(i)} onClick={() => toggleDay(i)}
                className={`min-h-9 rounded-lg border px-3 text-sm ${s.weekdays.includes(i) ? "border-accent bg-accent text-accent-fg" : "border-line text-text hover:bg-raised"}`}>
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">Earliest
            <input type="time" value={toTime(s.window_start_minute)} className={field}
              onChange={(e) => setS({ ...s, window_start_minute: fromTime(e.target.value) ?? s.window_start_minute })} />
          </label>
          <label className="text-sm font-medium">Latest
            <input type="time" value={toTime(s.window_end_minute % 1440)} className={field}
              onChange={(e) => setS({ ...s, window_end_minute: fromTime(e.target.value) || 1440 })} />
          </label>
        </div>
        <label className="text-sm font-medium">Timezone
          <select value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} className={field}>
            {zones.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Check-ins per day
          <select value={s.checks_per_day} onChange={(e) => setS({ ...s, checks_per_day: Number(e.target.value) })} className={field}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Time to respond
          <select value={s.response_minutes} onChange={(e) => setS({ ...s, response_minutes: Number(e.target.value) })} className={field}>
            {[5, 10, 15, 20, 30, 45, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}
          </select>
        </label>
        <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
          <input type="checkbox" checked={!s.class_blocks} onChange={(e) => setS({ ...s, class_blocks: !e.target.checked })} className="mt-0.5 size-4 accent-accent" />
          <span>
            <span className="font-medium">Allow check-ins during class</span>
            <span className="block text-muted">Off: class counts as a time they can&apos;t take a photo. Interviews, religious services, work, and medical times are always skipped.</span>
          </span>
        </label>
        {error && <div className="sm:col-span-2"><Notice>{error}</Notice></div>}
        <div className="sm:col-span-2"><Button type="submit" variant="primary" busy={busy}>Save</Button></div>
      </form>
    </Card>
  );
}

function TodayTable({ d }: { d: BpToday }) {
  if (!d.settings.enabled) return null;
  return (
    <section>
      <h2 className="mb-1 font-display text-lg font-semibold tracking-[-0.01em]">Today</h2>
      <p className="mb-3.5 text-sm text-muted">Check-in times stay hidden until they open, from everyone.</p>
      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
        <table className="w-full text-sm tabular-nums">
          <thead className={table.head}>
            <tr>
              <th scope="col" className="px-4 py-3 font-normal">Name</th>
              <th scope="col" className="px-3 py-3 text-right font-normal">Planned</th>
              <th scope="col" className="px-3 py-3 text-right font-normal">Photos</th>
              <th scope="col" className="px-3 py-3 text-right font-normal">Couldn&apos;t</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Missed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.members.map((m) => (
              <tr key={m.user_id}>
                <th scope="row" className="px-4 py-2.5 text-left font-medium">
                  <span className="flex items-center gap-2.5"><Avatar name={m.name} className="size-7 text-[10px]" />{m.name}
                    {m.open_now && <Badge tone="warn">Open now</Badge>}</span>
                </th>
                <td className="px-3 text-right">{m.planned}</td>
                <td className="px-3 text-right">{m.photos}</td>
                <td className="px-3 text-right">{m.declined}</td>
                <td className={`px-4 text-right ${m.missed ? "font-semibold text-danger" : ""}`}>{m.missed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Recent({ d }: { d: BpToday }) {
  const { me } = useApp();
  if (d.recent.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3.5 font-display text-lg font-semibold tracking-[-0.01em]">Last 7 days</h2>
      <ul className="space-y-2.5">
        {d.recent.map((p) => <RecentRow key={p.id} p={p} tz={me.timezone} />)}
      </ul>
    </section>
  );
}

function RecentRow({ p, tz }: { p: BpToday["recent"][number]; tz: string }) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  return (
    <ListRow bar={p.response === "photo" ? "ok" : p.response === "missed" ? "light" : "mid"}>
      <p className="text-sm font-medium">{p.name} <span className="font-normal text-muted">· {fmtShortDay(p.ping_at, tz)}, {fmtTime(p.ping_at, tz)}</span></p>
      <p className="text-[13px] text-muted">
        {RESPONSE_LABEL[p.response ?? ""]}
        {p.responded_at && p.response === "photo" ? ` at ${fmtTime(p.responded_at, tz)}` : ""}
        {p.decline_reason ? `: ${p.decline_reason}` : ""}
      </p>
      {p.has_photo && !image && (
        <Button variant="outline" className="mt-2 min-h-9" onClick={async () => {
          try { setImage(await fileUrl(`/bp/pings/${p.id}/photo`)); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't open the photo."); }
        }}>View photo</Button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && <img src={image} alt={`BP photo from ${p.name}`} className="mt-2 max-h-80 max-w-full rounded-xl border border-line" />}
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </ListRow>
  );
}

function Blocks({ data, error, memberLabel }: { data: BpGroupBlocks | null; error: string; memberLabel: string }) {
  const [openId, setOpenId] = useState("");
  return (
    <section>
      <h2 className="mb-1 font-display text-lg font-semibold tracking-[-0.01em]">Times they can&apos;t take a photo</h2>
      <p className="mb-3.5 text-sm text-muted">The type and time of each, and anything added in the last day. If something looks off, talk to them.</p>
      {error && <Notice>{error}</Notice>}
      {!data && !error && <Skeleton rows={2} />}
      {data?.length === 0 && <Empty title={`No ${memberLabel.toLowerCase()}s yet`} />}
      <ul className="space-y-2.5">
        {data?.map((p) => {
          const total = Object.values(p.weekly_minutes).reduce((a, b) => a + b, 0);
          const open = openId === p.user_id;
          return (
            <ListRow key={p.user_id} bar={null}>
              <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? "" : p.user_id)}
                className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 text-left">
                <Avatar name={p.name} className="size-7 text-[10px]" />
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-[13px] text-muted">
                  {total ? `${hours(total)} a week` : "No weekly blocks"}
                  {total ? ` (${Object.entries(p.weekly_minutes).map(([k, m]) => `${kindLabel(k).toLowerCase()} ${hours(m)}`).join(", ")})` : ""}
                </span>
                {p.recent > 0 && <Badge tone="warn">{p.recent} added in the last day</Badge>}
              </button>
              {open && (
                p.blocks.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing listed.</p> : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {p.blocks.map((b) => (
                      <li key={b.id}>
                        <span className="font-medium">{b.kind_label}</span>
                        <span className="text-muted"> · {whenLabel(b)}{b.source === "calendar" ? " · from calendar" : ""}</span>
                        {b.recent && <span className="text-warn"> · new</span>}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </ListRow>
          );
        })}
      </ul>
    </section>
  );
}
