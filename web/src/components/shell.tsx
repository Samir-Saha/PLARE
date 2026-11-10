"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, signOut, type Me, type Org } from "@/lib/api";
import { Avatar, Button, Notice, Skeleton, ThemeToggle, Wordmark } from "./ui";
import { IconBook, IconCalendar, IconInbox, IconLogout, IconTasks, IconUsers } from "./icons";

type NavItem = { href: string; label: string; icon: (p: { className?: string }) => ReactNode; count?: number; alert?: boolean };

function CountPill({ n, alert }: { n: number; alert?: boolean }) {
  return <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${alert ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}>{n}</span>;
}

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
  // TODO(counts): nav items accept `count` (and `alert` for overdue/fry counts) but the shell
  // doesn't load per-tab totals yet. Wire them up once there's a cheap summary endpoint.
  const nav: NavItem[] = [
    { href: "/app", label: "Tasks", icon: IconTasks },
    { href: "/app/schedule", label: "Schedule", icon: IconCalendar },
    { href: "/app/study", label: "Study", icon: IconBook },
    ...(isLead ? [{ href: "/app/review", label: "Review", icon: IconInbox }] : []),
    { href: "/app/group", label: "Group", icon: IconUsers },
  ];
  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const role = isLead ? org.lead_label : org.member_label;

  return (
    <AppContext.Provider value={{ me, org, isLead, refresh, selectOrg }}>
      {/* Desktop: the app sits in a rounded white frame on the page background. Phones: full-bleed. */}
      <div className="md:p-8">
        <div className="mx-auto flex min-h-dvh max-w-[1376px] bg-surface md:min-h-[calc(100dvh-4rem)] md:rounded-[28px] md:shadow-frame">
          <aside className="sticky top-8 hidden h-[calc(100dvh-4rem)] w-[232px] shrink-0 flex-col overflow-y-auto rounded-l-[28px] border-r border-line bg-raised px-4 py-6 md:flex">
            <Wordmark className="px-2 text-2xl" />

            <div className="mt-8 flex flex-col items-center text-center">
              <Avatar name={me.name} className="size-[72px] text-xl" />
              <p className="mt-3 max-w-full truncate font-display font-semibold">{me.name}</p>
              <p className="max-w-full truncate text-xs text-muted">{role}{me.is_demo ? " · demo account" : ""}</p>
              <label className="sr-only" htmlFor="org">Group</label>
              <select
                id="org"
                value={org.id}
                onChange={(e) => selectOrg(e.target.value)}
                className="mt-3 w-full truncate rounded-xl border border-line bg-surface px-2.5 py-2 text-center text-xs font-medium text-muted"
              >
                {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>

            <nav aria-label="Main" className="mt-8 flex flex-col gap-1">
              {nav.map((n) => {
                const on = active(n.href);
                return (
                  <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors ${on ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface hover:text-text"}`}>
                    <n.icon className="shrink-0" />
                    {n.label}
                    {n.count ? <CountPill n={n.count} alert={n.alert} /> : null}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto flex flex-col gap-1 pt-6">
              <ThemeToggle className="justify-start! rounded-full" />
              <Button variant="ghost" className="justify-start! rounded-full" onClick={async () => { await signOut(); router.replace("/"); }}>
                <IconLogout />Sign out
              </Button>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 md:hidden">
              <Wordmark className="text-lg" />
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm text-muted">{org.name}</span>
                <Avatar name={me.name} className="size-8 text-[11px]" />
              </span>
            </header>
            {org.is_demo && (
              <p className="border-b border-line bg-warn-soft px-4 py-1.5 text-center text-xs text-warn md:rounded-tr-[28px]">
                Demo group. Every person and record here is fictional.
              </p>
            )}
            <main className="flex-1 px-4 pb-28 pt-6 sm:px-8 md:px-10 md:pb-10 md:pt-8">{children}</main>
          </div>
        </div>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {nav.map((n) => {
          const on = active(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${on ? "text-accent" : "text-muted"}`}>
              <span className={`grid h-7 w-12 place-items-center rounded-full ${on ? "bg-accent-soft" : ""}`}><n.icon /></span>
              {n.label}
            </Link>
          );
        })}
      </nav>
    </AppContext.Provider>
  );
}
