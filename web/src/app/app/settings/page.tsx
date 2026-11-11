"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDay } from "@/lib/format";
import { currentSubscription, fromTime, loadPushConfig, pushSupport, toTime, turnOff, turnOn, type NotificationPrefs, type PushDevice } from "@/lib/push";
import { useApp } from "@/components/shell";
import { Button, Card, Notice, Page, PageHeader, Skeleton, field, useLoad, useToast } from "@/components/ui";

export default function Settings() {
  return (
    <Page>
      <PageHeader title="Notifications" hint="Get reminders and check-ins on your phone, and choose when to stay quiet." />
      <div className="grid max-w-2xl gap-5">
        <ThisDevice />
        <QuietHours />
      </div>
    </Page>
  );
}

function ThisDevice() {
  const toast = useToast();
  const config = useLoad(loadPushConfig, []);
  const sub = useLoad(currentSubscription, []);
  const devices = useLoad(() => api<PushDevice[]>("/push/devices"), []);
  const [busy, setBusy] = useState<"" | "on" | "off" | "test">("");
  const [error, setError] = useState("");
  const support = typeof window === "undefined" ? "unsupported" : pushSupport();
  const on = !!sub.data;

  async function run(kind: "on" | "off" | "test", work: () => Promise<unknown>, done: string) {
    setBusy(kind);
    setError("");
    try {
      await work();
      toast(done);
      sub.reload();
      devices.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg font-semibold">This device</h2>
      {!config.data && !config.error && <Skeleton rows={1} />}
      {config.error && <Notice>{config.error}</Notice>}
      {config.data && !config.data.configured && (
        <p className="mt-1.5 text-sm text-muted">
          Phone notifications aren&apos;t set up on the server yet. Whoever runs PLARE needs to add VAPID keys (see DEPLOY.md). You&apos;ll still see everything inside the app.
        </p>
      )}
      {config.data?.configured && support === "ios_install" && (
        <p className="mt-1.5 text-sm text-muted">
          On iPhone, add PLARE to your Home Screen first: tap Share in Safari, then Add to Home Screen. Open PLARE from that icon and come back here.
        </p>
      )}
      {config.data?.configured && support === "unsupported" && (
        <p className="mt-1.5 text-sm text-muted">This browser can&apos;t receive notifications. Try Chrome, Edge, Firefox, or Safari.</p>
      )}
      {config.data?.configured && support === "ok" && (
        <>
          <p className="mt-1.5 text-sm text-muted">
            {on ? "Notifications are on for this device. You can turn them off any time." : "Turn on notifications to get reminders and BP check-ins even when PLARE is closed."}
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            {!on && (
              <Button variant="primary" busy={busy === "on"} onClick={() => run("on", () => turnOn(config.data!.public_key!), "Notifications are on")}>
                Turn on notifications
              </Button>
            )}
            {on && (
              <>
                <Button busy={busy === "test"} onClick={() => run("test", () => api("/push/test", { method: "POST" }), "Test sent. It should arrive in a few seconds.")}>
                  Send a test
                </Button>
                <Button variant="ghost" busy={busy === "off"} onClick={() => run("off", () => turnOff(sub.data!), "Notifications are off for this device")}>
                  Turn off
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}

      {devices.data && devices.data.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Devices getting your notifications</h3>
          <ul className="mt-2 divide-y divide-line">
            {devices.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {d.device}{sub.data?.endpoint === d.endpoint ? " (this one)" : ""}
                  <span className="text-muted"> · added {fmtDay(d.created_at, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>
                </span>
                <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => run("off", async () => {
                  await api(`/push/devices/${d.id}`, { method: "DELETE" });
                  if (sub.data?.endpoint === d.endpoint) await sub.data.unsubscribe();
                }, `Removed ${d.device}`)}>Remove</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function QuietHours() {
  const { me } = useApp();
  const toast = useToast();
  const prefs = useLoad(() => api<NotificationPrefs>("/me/notification-prefs"), []);
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = draft ?? { start: toTime(prefs.data?.quiet_start_minute ?? null), end: toTime(prefs.data?.quiet_end_minute ?? null) };
  const isOn = prefs.data?.quiet_start_minute != null;

  async function save(start: number | null, end: number | null) {
    if ((start == null) !== (end == null)) return setError("Pick both a start and an end time.");
    setBusy(true);
    setError("");
    try {
      await api("/me/notification-prefs", { method: "PUT", body: JSON.stringify({ quiet_start_minute: start, quiet_end_minute: end }) });
      toast(start == null ? "Quiet hours are off" : "Quiet hours saved");
      setDraft(null);
      prefs.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save quiet hours.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg font-semibold">Quiet hours</h2>
      <p className="mt-1.5 text-sm text-muted">
        Nothing is pushed to your phone during these hours ({me.timezone.replace("_", " ")} time). Anything that comes in still shows inside the app.
      </p>
      {!prefs.data && !prefs.error && <Skeleton rows={1} />}
      {prefs.error && <Notice>{prefs.error}</Notice>}
      {prefs.data && (
        <form className="mt-3.5 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); save(fromTime(value.start), fromTime(value.end)); }}>
          <label className="text-sm font-medium">From
            <input type="time" value={value.start} onChange={(e) => setDraft({ ...value, start: e.target.value })} className={field} />
          </label>
          <label className="text-sm font-medium">Until
            <input type="time" value={value.end} onChange={(e) => setDraft({ ...value, end: e.target.value })} className={field} />
          </label>
          <Button type="submit" variant="primary" busy={busy}>Save</Button>
          {isOn && <Button type="button" variant="ghost" onClick={() => save(null, null)}>Turn off quiet hours</Button>}
        </form>
      )}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </Card>
  );
}
