"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type SVGProps } from "react";
import { api, ApiError, post, signOut, type AppNotification, type GmInbox, type Me, type Org, type SubmissionRow } from "@/lib/api";
import { Avatar, Button, Notice, Skeleton, ThemeToggle, ToastProvider, Wordmark, useLoad } from "./ui";
import { AccountSheet, CreateGroupDialog, GroupSwitcher, MobileTopBar } from "./workspace";
import { IconBell, IconBook, IconCalendar, IconCamera, IconCheck, IconClose, IconCoffee, IconGrid, IconHome, IconLog, IconLogout, IconNote, IconSun, IconUsers } from "./icons";
import type { ExcuseSummary, LogSummary } from "@/lib/api";

type NavItem = { href: string; label: string; short?: string; icon: (p: SVGProps<SVGSVGElement>) => ReactNode; count?: number; alert?: boolean; countLabel?: string };

function CountPill({ n, alert, label }: { n: number; alert?: boolean; label?: string }) {
  return <span aria-label={label} title={label} className={`ml-auto min-w-6 rounded-full px-2 py-px text-center text-[12px] font-bold tabular-nums ${alert ? "bg-danger text-white" : "bg-gold text-gold-fg"}`}>{n}</span>;
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

  // A new account belongs to no group yet: send it to the Group page to create or join one.
  // Navigating has to happen in an effect, never during render.
  const noGroup = !!me && me.orgs.length === 0;
  useEffect(() => {
    if (noGroup && pathname !== "/app/group") router.replace("/app/group");
  }, [noGroup, pathname, router]);

  if (error) return <main className="mx-auto max-w-md p-6"><Notice>{error}</Notice><Button className="mt-3" onClick={() => { setError(""); refresh(); }}>Try again</Button></main>;
  if (!me) return <main className="mx-auto max-w-3xl p-6"><Skeleton /></main>;

  const org = me.orgs.find((o) => o.id === orgId) ?? me.orgs[0];
  if (!org) {
    return (
      <AppContext.Provider value={{ me, org: null as unknown as Org, isLead: false, refresh, selectOrg }}>
        <ToastProvider>
          <NoGroupFrame me={me} refresh={refresh} selectOrg={selectOrg} onSignOut={async () => { await signOut(); router.replace("/"); }}>
            {pathname === "/app/group" ? children : <Skeleton />}
          </NoGroupFrame>
        </ToastProvider>
      </AppContext.Provider>
    );
  }
  return (
    <AppContext.Provider value={{ me, org, isLead: org.role !== "member", refresh, selectOrg }}>
      <ToastProvider>
        <Frame me={me} org={org} selectOrg={selectOrg} refresh={refresh} onSignOut={async () => { await signOut(); router.replace("/"); }}>{children}</Frame>
      </ToastProvider>
    </AppContext.Provider>
  );
}

/** A signed-in account that belongs to no group yet: just the Group page, plus account controls. */
function NoGroupFrame({ me, refresh, selectOrg, onSignOut, children }: { me: Me; refresh: () => Promise<void>; selectOrg: (id: string) => void; onSignOut: () => void; children: ReactNode }) {
  const [sheet, setSheet] = useState(false);
  const [creating, setCreating] = useState(false);
  return (
    <div className="min-h-dvh bg-bg">
      <MobileTopBar me={me} org={null} onOpenAccount={() => setSheet(true)} />
      <header className="hidden items-center justify-between border-b border-line px-8 py-4 md:flex">
        <Wordmark className="text-xl" />
        <div className="flex items-center gap-1"><ThemeToggle /><Button variant="ghost" onClick={onSignOut}>Sign out</Button></div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-8">{children}</main>
      <AccountSheet open={sheet} onClose={() => setSheet(false)} me={me} org={null} selectOrg={selectOrg} onCreate={() => setCreating(true)} onSignOut={onSignOut} />
      <CreateGroupDialog open={creating} onClose={() => setCreating(false)} onCreated={async (id) => { await refresh(); selectOrg(id); }} />
    </div>
  );
}

function Frame({ me, org, selectOrg, refresh, onSignOut, children }: { me: Me; org: Org; selectOrg: (id: string) => void; refresh: () => Promise<void>; onSignOut: () => void; children: ReactNode }) {
  const pathname = usePathname();
  const isLead = org.role !== "member";
  const [sheet, setSheet] = useState(false);
  const [creating, setCreating] = useState(false);
  // Review badge: size of the existing review queue, refreshed on navigation so it drops after reviewing.
  const pending = useLoad(() => (isLead ? api<SubmissionRow[]>(`/orgs/${org.id}/review`).then((r) => r.length) : Promise.resolve(0)), [org.id, isLead, pathname]);

  // GM badge for leads: today's flagged plus missing messages.
  const gmAlerts = useLoad(() => (isLead
    ? api<GmInbox>(`/orgs/${org.id}/gm/inbox`).then((r) => r.counts.flagged + r.counts.missing)
    : Promise.resolve(0)), [org.id, isLead, pathname]);

  // Log badge for leads: entries created today (Eastern time), from the log summary.
  const logToday = useLoad(() => (isLead ? api<LogSummary>(`/orgs/${org.id}/log/summary`).then((r) => r.today) : Promise.resolve(0)), [org.id, isLead, pathname]);

  // Excuses badge for leads: requests waiting for a decision.
  const excusesPending = useLoad(() => (isLead ? api<ExcuseSummary>(`/orgs/${org.id}/excuses/summary`).then((r) => r.pending) : Promise.resolve(0)), [org.id, isLead, pathname]);

  // TODO(nav): the mockup also lists Points. It has no page or API yet, so it's left out
  // rather than linking to a 404.
  const nav: NavItem[] = [
    { href: "/app", label: isLead ? "Dashboard" : "Home", icon: isLead ? IconGrid : IconHome, short: "Home" },
    ...(isLead ? [{ href: "/app/review", label: "Review", icon: IconCheck, count: pending.data ?? undefined }] : []),
    { href: "/app/gm", label: "GM messages", short: "GM", icon: IconSun, count: gmAlerts.data || undefined, alert: true },
    { href: "/app/bp", label: "BP check-in", short: "BP", icon: IconCamera },
    { href: "/app/study", label: "Study hours", icon: IconBook, short: "Study" },
    { href: "/app/schedule", label: "Calendar", icon: IconCalendar },
    { href: "/app/coffee", label: "Coffee chats", icon: IconCoffee, short: "Coffee" },
    { href: "/app/group", label: "Group", icon: IconUsers },
    { href: "/app/log", label: "Log", icon: IconLog, count: logToday.data ?? undefined, alert: true, countLabel: `${logToday.data ?? 0} new today` },
    { href: "/app/excuses", label: "Excuses", icon: IconNote, count: excusesPending.data || undefined },
  ];
  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const role = org.title || (org.role === "admin" ? "Admin" : isLead ? org.lead_label : org.member_label);

  return (
    <div className="min-h-dvh bg-bg md:flex">
      {/* Desktop: full-height sticky ink-navy sidebar. */}
      <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col overflow-y-auto bg-nav px-3 pb-4 pt-6 text-nav-text md:flex">
        <Link href="/app" aria-label="PLARE home" className="mb-6 self-start rounded-md px-2"><Wordmark tone="nav" className="text-[21px]" /></Link>
        <GroupSwitcher me={me} org={org} selectOrg={selectOrg} onCreate={() => setCreating(true)} />

        <nav aria-label="Main" className="mt-6 flex flex-col gap-0.5">
          {nav.map((n) => {
            const on = active(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                className={`relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-[15px] transition-[background-color,color,scale] duration-150 active:scale-[0.98] ${on ? "bg-nav-active font-semibold text-nav-text" : "font-medium text-nav-muted hover:bg-nav-hover hover:text-nav-text"}`}>
                {on && <span aria-hidden className="absolute inset-y-2 -left-3 w-1 rounded-r-full bg-gold" />}
                <n.icon width={19} height={19} className={on ? "text-gold" : ""} />
                {n.label}
                {n.count ? <CountPill n={n.count} alert={n.alert} label={n.countLabel} /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-nav-line pt-3">
          <div className="flex items-center gap-2.5 px-2 pb-2">
            <Avatar name={me.name} className="size-8 bg-nav-active! text-[11px] text-nav-text! ring-nav-line!" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-tight">{me.name}</p>
              <p className="truncate text-[12px] font-medium text-nav-muted">{role}{me.is_demo ? ", demo" : ""}</p>
            </div>
          </div>
          <Link href="/app/settings" aria-current={pathname === "/app/settings" ? "page" : undefined}
            className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-nav-muted transition-colors duration-150 hover:bg-nav-hover hover:text-nav-text">
            <IconBell width={17} height={17} />Notifications
          </Link>
          <ThemeToggle className="min-h-9! w-full justify-start! px-2.5! text-[13px] font-medium! text-nav-muted! hover:bg-nav-hover! hover:text-nav-text!" />
          <Button variant="ghost" className="min-h-9! w-full justify-start! px-2.5! text-[13px] font-medium! text-nav-muted! hover:bg-nav-hover! hover:text-nav-text!" onClick={onSignOut}>
            <IconLogout width={17} height={17} />Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(60px+env(safe-area-inset-bottom))] md:pb-0">
        <MobileTopBar me={me} org={org} onOpenAccount={() => setSheet(true)} />
        {org.is_demo && (
          <p className="border-b border-gold/30 bg-gold-soft px-4 py-1.5 text-center text-xs font-medium text-gold-ink">
            Demo group. Real names, but every record here is made up for the presentation.
          </p>
        )}
        <GmReminderBanner />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>

      {/* Phones: compact bottom navigation above the home indicator. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line/70 bg-surface/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden">
        {nav.map((n) => {
          const on = active(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
              className={`relative flex min-h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[12px] transition-[color,scale] duration-150 active:scale-95 ${on ? "font-bold text-text" : "font-medium text-muted"}`}>
              {on && <span aria-hidden className="absolute top-0 h-[3px] w-7 rounded-b-full bg-gold" />}
              <n.icon width={22} height={22} className={on ? "text-accent-2" : ""} />
              <span className="max-w-full truncate px-0.5">{n.short ?? n.label}</span>
              {n.count ? (
                <span aria-label={n.countLabel} title={n.countLabel} className={`absolute right-[calc(50%-20px)] top-2 min-w-4 rounded-full px-1 text-center text-[11px] font-bold leading-4 tabular-nums ${n.alert ? "bg-danger text-white" : "bg-gold text-gold-fg"}`}>
                  {n.count > 99 ? "99+" : n.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <AccountSheet open={sheet} onClose={() => setSheet(false)} me={me} org={org} selectOrg={selectOrg} onCreate={() => setCreating(true)} onSignOut={onSignOut} />
      <CreateGroupDialog open={creating} onClose={() => setCreating(false)} onCreated={async (id) => { await refresh(); selectOrg(id); }} />
    </div>
  );
}

/**
 * In-app reminder banner for GM messages and open BP check-ins. Checks once a minute (and after
 * navigation or sending a GM) for unread reminders the API created, and always has a dismiss button.
 */
function GmReminderBanner() {
  const pathname = usePathname();
  const [notes, setNotes] = useState<AppNotification[]>([]);

  useEffect(() => {
    let live = true;
    const load = () => api<AppNotification[]>("/notifications")
      .then((all) => live && setNotes(all.filter((n) => (n.category === "gm" || n.category === "bp") && !n.read)))
      .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    window.addEventListener("plare:notifications", load);
    return () => {
      live = false;
      clearInterval(id);
      window.removeEventListener("plare:notifications", load);
    };
  }, [pathname]);

  const note = notes[0];
  if (!note) return null;
  const dismiss = () => {
    setNotes([]);
    post("/notifications/read", { ids: notes.map((n) => n.id) }).catch(() => {});
  };
  return (
    <div role="status" className="flex items-center gap-3 border-b border-gold/30 bg-gold-soft px-4 py-2.5 text-sm text-text md:px-10">
      <IconSun width={18} height={18} className="shrink-0 text-gold-ink" />
      <p className="min-w-0 flex-1"><span className="font-semibold">{note.title}.</span> <span className="text-muted">{note.body}</span></p>
      {pathname !== note.link && note.link && (
        <Link href={note.link} className="shrink-0 font-semibold text-accent underline underline-offset-2">{note.category === "bp" ? "Take photo" : "Send it"}</Link>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss reminder" className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-text">
        <IconClose width={16} height={16} />
      </button>
    </div>
  );
}
