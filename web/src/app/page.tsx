"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL, demoUser } from "@/lib/api";
import { signInWithGoogle, supabase } from "@/lib/supabase";
import { Badge, Button, Card, Notice, ThemeToggle, Wordmark } from "@/components/ui";

type DemoUser = { email: string; name: string; role: string };

// Demo buttons pick people by name (falling back to the first person with the role). Mirrors DEMO_LOGINS in api/app/seed.py.
const DEMO_LOGINS = { pledge: ["Mohammad Butt", "member"], brother: ["Abirami", "lead"], admin: ["Arnav", "admin"] } as const;

export default function Home() {
  const router = useRouter();
  const [demo, setDemo] = useState<DemoUser[]>([]);
  const [error, setError] = useState("");
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => data.session && router.replace("/app"));
    fetch(`${API_URL}/demo/users`).then((r) => r.json()).then(setDemo, () => setServerDown(true));
  }, [router]);

  const pick = (who: keyof typeof DEMO_LOGINS) => {
    const [name, role] = DEMO_LOGINS[who];
    return demo.find((u) => u.name === name) ?? demo.find((u) => u.role === role);
  };
  const enter = (u?: DemoUser) => {
    if (!u) return;
    demoUser.set(u.email);
    router.push("/app");
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-5 py-6">
      <div className="flex items-center justify-between">
        <Wordmark className="text-xl" />
        <ThemeToggle />
      </div>
      <div className="grid flex-1 items-center gap-10 py-10 md:grid-cols-[1.2fr_1fr]">
        <div>
          <Badge tone="accent">Built for pledge classes. Works for any group.</Badge>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
            Know what&apos;s due, who turned it in, and when everyone&apos;s free.
          </h1>
          <p className="mt-4 max-w-md text-muted">
            PLARE keeps a group&apos;s tasks, photo submissions, and schedules in one place, then finds the time when
            the most people can meet or study, straight from their calendars.
          </p>
        </div>
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Sign in</h2>
          {error && <Notice>{error}</Notice>}
          {supabase ? (
            <Button variant="primary" className="w-full" onClick={() => signInWithGoogle().catch((e) => setError(e.message))}>
              Continue with Google
            </Button>
          ) : (
            <p className="text-sm text-muted">Google sign-in isn&apos;t configured on this deployment yet.</p>
          )}
          {demo.length > 0 && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-sm text-muted">Or explore the demo group. Real names, but every record here is made up for the presentation.</p>
              <Button className="w-full" onClick={() => enter(pick("pledge"))}>Enter as a pledge</Button>
              <Button className="w-full" onClick={() => enter(pick("brother"))}>Enter as a brother / PM</Button>
              <Button className="w-full" onClick={() => enter(pick("admin"))}>Enter as an admin</Button>
            </div>
          )}
          {serverDown && <Notice tone="warn">Can&apos;t reach the PLARE server right now.</Notice>}
        </Card>
      </div>
    </main>
  );
}
