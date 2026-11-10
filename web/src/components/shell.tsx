"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, signOut, type Me, type Org } from "@/lib/api";
import { Button, Notice, Skeleton, ThemeToggle, Wordmark } from "./ui";

type Ctx = { me: Me; org: Org; isLead: boolean; refresh: () => Promise<void>; selectOrg: (id: string) => void };
const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppShell");
  return ctx;
}

const ORG_KEY = "plare.org";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      let profile = await api<Me>("/me");
      // First visit on a real account: adopt the browser's timezone.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!profile.is_demo && tz && tz !== profile.timezone && !localStorage.getItem("plare.tz_set")) {
        profile = await api<Me>("/me", { method: "PATCH", body: JSON.stringify({ timezone: tz }) });
        localStorage.setItem("plare.tz_set", "1");
      }
      setMe(profile);
      setOrgId((cur) => cur ?? localStorage.getItem(ORG_KEY));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/");
      else setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, [router]);

  useEffect(() => {
    // Initial profile fetch; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const selectOrg = (id: string) => {
    localStorage.setItem(ORG_KEY, id);
    setOrgId(id);
  };

  if (error) return <main className="mx-auto max-w-md p-6"><Notice>{error}</Notice><Button className="mt-3" onClick={() => { setError(""); refresh(); }}>Try again</Button></main>;
  if (!me) return <main className="mx-auto max-w-3xl p-6"><Skeleton /></main>;

  const org = me.orgs.find((o) => o.id === orgId) ?? me.orgs[0];
  if (!org) {
    if (pathname !== "/app/group") router.replace("/app/group");
    return (
      <AppContext.Provider value={{ me, org: null as unknown as Org, isLead: false, refresh, selectOrg }}>
        <main className="mx-auto max-w-2xl p-4 sm:p-8">{pathname === "/app/group" ? children : <Skeleton />}</main>
      </AppContext.Provider>
    );
  }
  const isLead = org.role !== "member";
  const nav = [
    { href: "/app", label: "Tasks" },
    { href: "/app/schedule", label: "Schedule" },
    { href: "/app/study", label: "Study" },
    ...(isLead ? [{ href: "/app/review", label: "Review" }] : []),
    { href: "/app/group", label: "Group" },
  ];
  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  return (
    <AppContext.Provider value={{ me, org, isLead, refresh, selectOrg }}>
      <div className="mx-auto flex min-h-dvh max-w-6xl">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line p-4 md:flex">
          <Wordmark className="px-2 text-xl" />
          <label className="mt-6 block px-2 text-xs font-medium text-muted" htmlFor="org">Group</label>
          <select
            id="org"
            value={org.id}
            onChange={(e) => selectOrg(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
          >
            {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <nav aria-label="Main" className="mt-4 flex flex-col gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${active(n.href) ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-text"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto space-y-1 text-sm">
            <p className="truncate px-2 font-medium">{me.name}</p>
            <p className="px-2 text-xs text-muted">{isLead ? org.lead_label : org.member_label}{me.is_demo ? " · demo account" : ""}</p>
            <ThemeToggle />
            <Button variant="ghost" onClick={async () => { await signOut(); router.replace("/"); }}>Sign out</Button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
            <Wordmark className="text-lg" />
            <span className="max-w-[55%] truncate text-sm text-muted">{org.name}</span>
          </header>
          {org.is_demo && <p className="border-b border-line bg-warn-soft px-4 py-1.5 text-center text-xs text-warn">Demo group. Every person and record here is fictional.</p>}
          <main className="flex-1 px-4 pb-24 pt-5 sm:px-8 md:pb-10">{children}</main>
        </div>
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
              className={`flex-1 py-3 text-center text-xs font-medium ${active(n.href) ? "text-accent" : "text-muted"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </AppContext.Provider>
  );
}
