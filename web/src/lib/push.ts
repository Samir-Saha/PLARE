import { api, post } from "./api";

export type PushConfig = { configured: boolean; public_key: string | null };
export type PushDevice = { id: string; device: string; endpoint: string; created_at: string };
export type NotificationPrefs = { quiet_start_minute: number | null; quiet_end_minute: number | null; timezone: string };

/** What this browser can do. iPhones only allow push for PLARE once it's added to the Home Screen. */
export function pushSupport(): "ok" | "ios_install" | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches;
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "ok";
  return ios && !installed ? "ios_install" : "unsupported";
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A short label for the device list, like "iPhone" or "Chrome on Mac". Never sent anywhere else. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "";
  if (os === "iPhone" || os === "iPad") return os;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return os ? `${browser} on ${os}` : browser;
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/** The push subscription this browser already has, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Ask for permission (only ever from a button press), subscribe, and save it on the server. */
export async function turnOn(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked for PLARE. Allow them in your browser or phone settings, then try again."
      : "Notifications weren't allowed. Press Turn on notifications to try again.");
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = sub.toJSON();
  await post("/push/subscriptions", { endpoint: sub.endpoint, keys: json.keys, device: deviceLabel() });
  return sub;
}

export async function turnOff(sub: PushSubscription): Promise<void> {
  await post("/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export const loadPushConfig = () => api<PushConfig>("/push/config");

/** "HH:MM" from minutes after midnight, for time inputs. */
export const toTime = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
export const fromTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
