import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Null when Supabase isn't configured; the app then offers demo sign-in only. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const TOKEN_KEY = "plare.google_token";

if (supabase && typeof window !== "undefined") {
  // Google's access token only arrives right after the OAuth redirect. Keep it
  // for this tab so the calendar import can use it; it is never sent anywhere
  // except our API's one-shot sync endpoint.
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.provider_token) sessionStorage.setItem(TOKEN_KEY, session.provider_token);
    if (!session) sessionStorage.removeItem(TOKEN_KEY);
  });
}

export function googleToken(): string | null {
  return typeof window === "undefined" ? null : sessionStorage.getItem(TOKEN_KEY);
}

export function clearGoogleToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function signInWithGoogle(opts: { calendar?: boolean; next?: string } = {}) {
  if (!supabase) throw new Error("Google sign-in isn't configured.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${opts.next ?? "/app"}`,
      scopes: opts.calendar ? CALENDAR_SCOPE : undefined,
    },
  });
  if (error) throw error;
}
