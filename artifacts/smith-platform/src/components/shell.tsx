import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertTriangle, Inbox, LogOut, Menu, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { SmithMark } from '@/components/branding';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPlatformSessionQueryKey, useGetPlatformSession, useListPlatformGuilds, useLogoutPlatform } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MODULE_ICONS } from '@/components/module-icons';
import { FALLBACK_LOGIN, NAV_GROUPS, PAGES, guildIconUrl, initials, useCsrf, userAvatarUrl } from '@/lib/platform';

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <SmithMark size={30} />
      <span className={`font-display text-lg font-bold tracking-tight ${dark ? 'text-white' : ''}`}>Agent <span className="grad-text">Smith</span></span>
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center" data-testid="empty-state">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5"><Inbox className="h-5 w-5 text-cyan-300/80" /></span>
      <p className="mt-3 font-display text-lg font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-500/[0.07] p-5" data-testid="error-state" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-red-300" />
        <div className="flex-1">
          <p className="font-medium">Could not load this data</p>
          <p className="text-sm text-muted-foreground">{message || 'The platform API did not respond as expected.'}</p>
        </div>
        {onRetry && <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>}
      </div>
    </div>
  );
}

export function RuntimeBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = /foundation|inactive|unsupported|planned|disabled/.test(s)
    ? 'chip-warn'
    : /live|active|running|ok|protected|existing/.test(s)
      ? 'chip-live'
      : '';
  return <span data-testid="badge-runtime" className={`chip ${tone}`}>{status}</span>;
}

/** Labelled readout used in the sidebar and header; shows only what is reported. */
export function StatusPill({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <span className={`chip ${tone}`}><span className="opacity-60">{label}</span>{value}</span>;
}

export function LoginCard({ loginUrl, oauthConfigured = true, title = 'Sign in with Discord' }: { loginUrl?: string; oauthConfigured?: boolean; title?: string }) {
  return (
    <div className="glass mx-auto max-w-md p-8 rise" data-testid="login-card">
      <Logo />
      <h1 className="mt-6 font-display text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Smith only shows servers where you hold management permission and the bot is installed. Authentication happens on Discord; Smith never sees your password.</p>
      {!oauthConfigured && <p className="notice notice-warn mt-4" data-testid="text-oauth-unconfigured">Discord OAuth is not configured on this deployment yet, so sign-in is unavailable.</p>}
      <Button asChild={oauthConfigured} disabled={!oauthConfigured} className="mt-6 w-full" size="lg" data-testid="button-discord-login">
        {oauthConfigured ? <a href={loginUrl || FALLBACK_LOGIN} target={window.self !== window.top ? '_blank' : undefined} rel="noopener noreferrer">Continue with Discord</a> : <span>Continue with Discord</span>}
      </Button>
    </div>
  );
}

export function PublicLayout({ children }: { children: ReactNode }) {
  const { data } = useGetPlatformSession();
  const links = [['/premium', 'Plans'], ['/docs', 'Docs'], ['/status', 'Status']];
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07111F]/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/" data-testid="link-home"><Logo /></Link>
          <nav className="hidden sm:flex gap-5 text-sm">
            {links.map(([h, l]) => <Link key={h} href={h} className="text-muted-foreground hover:text-foreground" data-testid={`link-nav-${l.toLowerCase()}`}>{l}</Link>)}
          </nav>
          <div className="ml-auto flex gap-2">
            {data?.authenticated
              ? <Button asChild size="sm" data-testid="button-open-dashboard"><Link href="/dashboard">Open dashboard</Link></Button>
              : <Button asChild size="sm" variant="outline" data-testid="button-login"><Link href="/login">Log in</Link></Button>}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
          <span className="font-display text-foreground">Agent Smith</span>
          <Link href="/privacy" data-testid="link-privacy">Privacy</Link>
          <Link href="/terms" data-testid="link-terms">Terms</Link>
          <Link href="/docs" data-testid="link-docs">Docs</Link>
          <Link href="/status" data-testid="link-status">Status</Link>
        </div>
      </footer>
    </div>
  );
}

/** Gate: renders children only when the session is authenticated. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { q, session } = useCsrf();
  if (q.isLoading) return <div className="p-10 space-y-3 max-w-xl mx-auto"><Skeleton className="h-10 w-48" /><Skeleton className="h-40" /></div>;
  if (!session?.authenticated) {
    return (
      <div className="min-h-[100dvh] grid place-items-center p-4">
        <div>
          {q.isError && <div className="mb-4 max-w-md mx-auto"><ErrorState message="Could not read the session. You can still try signing in." onRetry={() => q.refetch()} /></div>}
          <LoginCard loginUrl={session?.loginUrl} oauthConfigured={!!session?.oauthConfigured && session?.oauthCallbackRegistered !== false} />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function UserMenu() {
  const qc = useQueryClient();
  const { session, request } = useCsrf();
  const [, nav] = useLocation();
  const logout = useLogoutPlatform({
    request,
    mutation: { onSuccess: () => { qc.clear(); nav('/'); } },
  });
  const u = session?.user;
  if (!u) return null;
  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-7 w-7"><AvatarImage src={userAvatarUrl(u.id, u.avatar) ?? undefined} /><AvatarFallback>{initials(u.username)}</AvatarFallback></Avatar>
      <span className="hidden sm:block text-sm" data-testid="text-username">{u.username}</span>
      <Button size="sm" variant="ghost" aria-label="Log out" onClick={() => logout.mutate()} disabled={logout.isPending} data-testid="button-logout"><LogOut className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Log out</span></Button>
    </div>
  );
}

export function DashboardTopbar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar sticky top-3 z-20 mx-3 mt-3 flex h-14 items-center gap-3 px-4">
      <Link href="/dashboard" data-testid="link-dashboard-home"><Logo /></Link>
      <div className="ml-auto flex items-center gap-3">{children}<UserMenu /></div>
    </header>
  );
}

export function GuildShell({ guildId, page, children }: { guildId: string; page: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const targets = () => Array.from(rail.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') ?? []);
    targets().find(el => el.offsetParent !== null)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const visible = targets().filter(el => el.offsetParent !== null);
      const first = visible[0], last = visible.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [open]);
  const guilds = useListPlatformGuilds();
  const guild = guilds.data?.find((g) => g.id === guildId);
  const session = useGetPlatformSession().data;
  const env = session?.runtimeMode ? String(session.runtimeMode) : 'not reported';
  // Presentation only: a REST-only preview's botOnline=false is not a Gateway verdict.
  const gateway = session?.botConnected === true ? 'connected' :
    session?.botConnected === false ? 'disconnected' :
      session?.runtimeMode === 'production' && session?.botOnline ? 'connected' : 'unverified';
  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Server modules">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="eyebrow px-3 pb-1.5">{g.label}</p>
          <div className="space-y-0.5">
            {g.pages.map((p) => {
              const Icon = MODULE_ICONS[p] ?? ShieldCheck;
              return (
              <Link key={p} href={`/dashboard/${guildId}/${p}`} onClick={() => setOpen(false)} data-testid={`link-nav-${p}`}
                aria-current={p === page ? 'page' : undefined} className="nav-item">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {PAGES[p].title}
              </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="shell-bg lg:grid lg:grid-cols-[16rem_1fr] lg:gap-4 lg:p-3">
      <aside ref={rail} aria-label="Server navigation" className={`rail fixed inset-y-2 left-2 z-40 flex w-64 flex-col transition-transform lg:sticky lg:top-3 lg:inset-auto lg:h-[calc(100dvh-1.5rem)] lg:w-auto lg:translate-x-0 ${open ? 'translate-x-0 visible' : '-translate-x-[110%] invisible lg:visible'}`}>
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          <Link href="/dashboard" data-testid="link-switch-server"><Logo dark /></Link>
          <button className="grid h-10 w-10 place-items-center rounded-full lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        <Link href="/dashboard" className="tile tile-hover mx-3 mt-3 flex items-center gap-2 p-2" data-testid="link-guild-switcher">
          <Avatar className="h-9 w-9 rounded-xl"><AvatarImage src={guild ? guildIconUrl(guild.id, guild.icon) ?? undefined : undefined} /><AvatarFallback className="rounded-xl bg-white/10 text-xs">{initials(guild?.name ?? 'S')}</AvatarFallback></Avatar>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white" data-testid="text-guild-name">{guild?.name ?? 'Server'}</span><span className="block text-[11px] text-muted-foreground">Switch server</span></span>
        </Link>
        {nav}
        <div className="space-y-1.5 border-t border-white/10 p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${gateway === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span data-testid="text-bot-status">Gateway {gateway}</span>
          </div>
          <p className="text-muted-foreground">Database: not reported</p>
          <p className="text-muted-foreground">Environment: {env}</p>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0">
        <header className="topbar sticky top-3 z-20 m-3 flex h-14 items-center gap-3 px-3 lg:m-0">
          <Button size="icon" variant="ghost" className="h-11 w-11 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)} data-testid="button-open-menu"><Menu className="h-5 w-5" /></Button>
          <div className="min-w-0">
            <p className="eyebrow">Control room</p>
            <p className="truncate font-display text-lg font-bold leading-tight">{PAGES[page].title}</p>
          </div>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <StatusPill label="Env" value={env} tone="chip-info" />
            <StatusPill label="Gateway" value={gateway} tone={gateway === 'connected' ? 'chip-live' : 'chip-warn'} />
          </div>
          <div className="ml-auto sm:ml-2"><UserMenu /></div>
        </header>
        <main className="mx-auto max-w-5xl space-y-6 p-3 lg:px-2 lg:py-6 rise">
          <p className="-mt-2 text-sm text-muted-foreground">{PAGES[page].blurb}</p>
          {children}
        </main>
      </div>
    </div>
  );
}
