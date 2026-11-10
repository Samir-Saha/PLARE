"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type SVGProps } from "react";
import { api, ApiError, signOut, type Me, type Org, type SubmissionRow } from "@/lib/api";
import { Avatar, Button, Notice, Skeleton, ThemeToggle, Wordmark, useLoad } from "./ui";
import { IconBook, IconCalendar, IconCheck, IconGrid, IconHome, IconLogout, IconUsers } from "./icons";
import { IconLog } from "./icons";
import type { LogSummary } from "@/lib/api";

type NavItem = { href: string; label: string; short?: string; icon: (p: SVGProps<SVGSVGElement>) => ReactNode; count?: number; alert?: boolean };

function CountPill({ n, alert }: { n: number; alert?: boolean }) {
  return <span className={`ml-auto rounded-full px-2 py-px text-[11px] font-semibold tabular-nums ${alert ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}>{n}</span>;
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
  return (
    <AppContext.Provider value={{ me, org, isLead: org.role !== "member", refresh, selectOrg }}>
      <Frame me={me} org={org} selectOrg={selectOrg} onSignOut={async () => { await signOut(); router.replace("/"); }}>{children}</Frame>
    </AppContext.Provider>
  );
}

function Frame({ me, org, selectOrg, onSignOut, children }: { me: Me; org: Org; selectOrg: (id: string) => void; onSignOut: () => void; children: ReactNode }) {
  const pathname = usePathname();
  const isLead = org.role !== "member";
  // Review badge: size of the existing review queue, refreshed on navigation so it drops after reviewing.
  const pending = useLoad(() => (isLead ? api<SubmissionRow[]>(`/orgs/${org.id}/review`).then((r) => r.length) : Promise.resolve(0)), [org.id, isLead, pathname]);

  // TODO(nav): the mockup also lists BP check-in, GM messages and Points. Only those remain;
  // they have no pages or API yet, so they're left out rather than linking to 404s.
  // Log badge for leads: entries created today (Eastern time), from the log summary.
  const logToday = useLoad(() => (isLead ? api<LogSummary>(`/orgs/${org.id}/log/summary`).then((r) => r.today) : Promise.resolve(0)), [org.id, isLead, pathname]);
  const nav: NavItem[] = [
    { href: "/app", label: isLead ? "Dashboard" : "Home", icon: isLead ? IconGrid : IconHome, short: "Home" },
    ...(isLead ? [{ href: "/app/review", label: "Review", icon: IconCheck, count: pending.data ?? undefined }] : []),
    { href: "/app/study", label: "Study hours", icon: IconBook, short: "Study" },
    { href: "/app/schedule", label: "Calendar", icon: IconCalendar },
    { href: "/app/group", label: "Group", icon: IconUsers },
    { href: "/app/log", label: "Log", icon: IconLog, count: logToday.data ?? undefined, alert: true },
  ];
  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const role = org.title || (isLead ? org.lead_label : org.member_label);

  return (
    // Phones: full-bleed on the raised background. Desktop: a white rounded frame on the page background.
    <div className="min-h-dvh bg-raised md:bg-bg md:p-8">
      <div className="mx-auto flex min-h-dvh max-w-[1376px] md:min-h-[calc(100dvh-4rem)] md:rounded-[28px] md:bg-surface md:shadow-frame">
        <aside className="sticky top-8 hidden h-[calc(100dvh-4rem)] w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line px-5 pb-6 pt-7 md:flex">
          <Link href="/app" aria-label="PLARE home" className="self-start px-2"><Wordmark className="text-[22px]" /></Link>

          <div className="mt-9 flex flex-col items-center text-center">
            <Avatar name={me.name} className="size-[72px] text-[22px]" />
            <p className="mt-3.5 max-w-full truncate text-[15px] font-semibold">{me.name.split(" ")[0]}</p>
            <p className="mt-0.5 flex max-w-full flex-wrap items-center justify-center text-xs leading-relaxed text-muted">
              <span className="shrink-0">{role}&nbsp;·&nbsp;</span>
              {me.orgs.length > 1 ? (
                <select aria-label="Group" value={org.id} onChange={(e) => selectOrg(e.target.value)}
                  className="max-w-full cursor-pointer rounded bg-transparent text-center text-xs text-muted underline decoration-dotted underline-offset-2">
                  {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : <span>{org.name}</span>}
            </p>
          </div>

          <nav aria-label="Main" className="mt-8 flex flex-col gap-1">
            {nav.map((n) => {
              const on = active(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                  className={`flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-[14.5px] transition-colors ${on ? "bg-accent font-semibold text-accent-fg" : "text-text hover:bg-raised"}`}>
                  <n.icon width={18} height={18} className={on ? "" : "text-muted"} />
                  {n.label}
                  {n.count ? <CountPill n={n.count} alert={n.alert} /> : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex flex-col gap-0.5 pt-6">
            <ThemeToggle className="min-h-9! justify-start! px-3! text-[13px] font-medium!" />
            <Button variant="ghost" className="min-h-9! justify-start! px-3! text-[13px] font-medium!" onClick={onSignOut}>
              <IconLogout width={18} height={18} />Sign out
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0">
          {org.is_demo && (
            <p className="border-b border-line bg-warn-soft px-4 py-1.5 text-center text-xs text-warn md:rounded-tr-[28px]">
              Demo group. Real names, but every record here is made up for the presentation.
            </p>
          )}
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {nav.map((n) => {
          const on = active(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
              className={`flex min-h-[76px] flex-1 flex-col items-center justify-center gap-1.5 text-[12px] ${on ? "font-semibold text-accent" : "text-muted"}`}>
              <n.icon width={24} height={24} />
              {n.short ?? n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
