"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { API_URL, demoUser } from "@/lib/api";
import { signInWithGoogle, supabase } from "@/lib/supabase";
import { Button, Notice, ThemeToggle, Wordmark } from "@/components/ui";
import { AvailabilityHero, StepAssign, StepReview, StepSubmit } from "@/components/landing";

type DemoUser = { email: string; name: string; role: string };

// Demo buttons pick people by name (falling back to the first person with the role). Mirrors DEMO_LOGINS in api/app/seed.py.
const DEMO_LOGINS = { pledge: ["Mohammad Butt", "member"], brother: ["Abirami", "lead"], admin: ["Arnav", "admin"] } as const;

const ROLES: { who: keyof typeof DEMO_LOGINS; title: string; body: string }[] = [
  { who: "pledge", title: "Enter as a pledge", body: "See what's due this week, submit a photo or note, and log study hours." },
  { who: "brother", title: "Enter as a brother or PM", body: "Approve submissions, send work back with feedback, and see who's behind." },
  { who: "admin", title: "Enter as an admin", body: "Set up the group, invite people, and manage roles and settings." },
];

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
  const google = () => signInWithGoogle().catch((e) => setError(e.message));

  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark className="text-[22px]" />
        <div className="flex items-center gap-1">
          <ThemeToggle className="px-3" />
          <a href="#start" className="inline-flex min-h-11 items-center rounded-[10px] px-4 text-sm font-semibold text-text transition-colors hover:bg-surface">Sign in</a>
        </div>
      </header>

      <main>
        {/* Hero: the claim on the left, the product's signature move on the right. */}
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-20 pt-6 sm:px-8 md:min-h-[calc(100dvh-88px)] lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-24">
          <div className="min-w-0">
            <span aria-hidden className="mb-6 block h-1.5 w-12 rounded-full bg-gold" />
            <h1 className="max-w-[13ch] font-display text-[46px] font-black leading-[0.95] sm:text-[64px] xl:text-[76px]">
              Know what&apos;s due, who turned it in, and when everyone&apos;s free.
            </h1>
            <p className="mt-7 max-w-[46ch] text-lg leading-relaxed text-muted">
              PLARE keeps a pledge class&apos;s tasks, photo proof, and reviews in one place. It reads everyone&apos;s
              Google Calendar and finds the hour when the most people can meet or study.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              {supabase && <Button variant="primary" className="min-h-12 px-6 text-base" onClick={google}><GoogleMark />Continue with Google</Button>}
              <a href="#demo" className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-line-strong bg-surface px-6 text-base font-semibold text-text transition-[background-color,scale] duration-150 hover:bg-raised active:scale-[0.97]">
                Try the demo group
              </a>
            </div>
            {error && <div className="mt-4 max-w-md"><Notice>{error}</Notice></div>}
          </div>
          <div className="flex justify-center lg:justify-end">
            <AvailabilityHero />
          </div>
        </section>

        {/* The weekly loop. A real sequence, so it's numbered. */}
        <section aria-labelledby="loop" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 lg:py-24">
            <h2 id="loop" className="max-w-[20ch] font-display text-[34px] font-extrabold leading-[1.02] sm:text-[46px]">One loop, every week, no group-chat chasing.</h2>
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              <Step n={1} title="Leads assign" body="Set a requirement once, with a due time and whether it needs a photo or a note.">
                <StepAssign />
              </Step>
              <Step n={2} title="Pledges submit" body="Attach the proof from a phone. Files stay private to the group's reviewers.">
                <StepSubmit />
              </Step>
              <Step n={3} title="Brothers review" body="Approve it, or send it back with one line on what to change. Progress updates for everyone.">
                <StepReview />
              </Step>
            </ol>
          </div>
        </section>

        {/* Demo entry and sign-in. */}
        <section id="demo" aria-labelledby="demo-title" className="mx-auto max-w-[1200px] scroll-mt-6 px-5 py-20 sm:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div id="start" className="scroll-mt-6">
              <h2 id="demo-title" className="font-display text-[34px] font-extrabold leading-[1.02] sm:text-[46px]">Walk through it as anyone in the class.</h2>
              <p className="mt-5 max-w-[44ch] text-muted">
                The demo group uses real names from our pledge class, but every task, photo, and hour in it is made up for this presentation.
              </p>
              {supabase ? (
                <div className="mt-8 max-w-sm">
                  <Button variant="primary" className="min-h-12 w-full text-base" onClick={google}><GoogleMark />Continue with Google</Button>
                  <p className="mt-2.5 text-sm text-muted">Use your own account to start a new group or join one with an invite link.</p>
                </div>
              ) : (
                <p className="mt-8 text-sm text-muted">Google sign-in isn&apos;t set up on this deployment yet, so only the demo is available.</p>
              )}
            </div>
            <div className="min-w-0">
              {serverDown && <Notice tone="warn">Can&apos;t reach the PLARE server, so the demo is unavailable. Start the API and reload this page.</Notice>}
              {!serverDown && (
                <ul className="grid gap-3">
                  {ROLES.map((r) => {
                    const u = pick(r.who);
                    return (
                      <li key={r.who}>
                        <button type="button" disabled={!u} onClick={() => enter(u)}
                          className="group flex w-full items-center gap-5 rounded-2xl border border-line bg-surface p-5 text-left transition-[border-color,box-shadow,translate,scale] duration-200 ease-out hover:-translate-y-0.5 hover:border-accent-2 hover:shadow-pop active:translate-y-0 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60">
                          <span className="min-w-0 flex-1">
                            <span className="block font-display text-[22px] font-extrabold">{r.title}</span>
                            <span className="mt-1 block text-sm text-muted">{r.body}</span>
                            {u && <span className="mt-2 block text-xs font-medium text-muted">Signs in as {u.name}</span>}
                          </span>
                          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent transition-colors group-hover:bg-gold group-hover:text-gold-fg dark:text-text">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted sm:px-8">
          <Wordmark className="text-base" />
          <p>Built by the KTP pledge class for our capstone. Works for any group.</p>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: ReactNode }) {
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-bg p-5">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[40px] font-black leading-none text-accent-2 tabular-nums">{n}</span>
        <h3 className="font-display text-[22px] font-extrabold">{title}</h3>
      </div>
      <p className="mt-2 min-h-[3lh] text-sm text-muted">{body}</p>
      <div className="mt-4 flex-1">{children}</div>
    </li>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" className="shrink-0 rounded-full bg-white p-[2px]">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" />
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9z" />
    </svg>
  );
}
