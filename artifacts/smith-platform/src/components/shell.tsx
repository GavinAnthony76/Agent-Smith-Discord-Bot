import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertTriangle, Inbox, LogOut, Menu, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPlatformSessionQueryKey, useGetPlatformSession, useListPlatformGuilds, useLogoutPlatform } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { FALLBACK_LOGIN, NAV_GROUPS, PAGES, guildIconUrl, initials, useCsrf, userAvatarUrl } from '@/lib/platform';

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground"><ShieldCheck className="h-4 w-4" /></span>
      <span className={`font-display text-lg font-bold ${dark ? 'text-sidebar-accent-foreground' : ''}`}>Agent Smith</span>
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-card/60 p-10 text-center" data-testid="empty-state">
      <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 font-display text-lg font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6" data-testid="error-state" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
        <div className="flex-1">
          <p className="font-medium">Could not load this data</p>
          <p className="text-sm text-muted-foreground">{message || 'The platform API did not respond as expected.'}</p>
        </div>
        {onRetry && <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry"><RefreshCw className="h-3.5 w-3.5 mr-1" />Retry</Button>}
      </div>
    </div>
  );
}

export function RuntimeBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = /foundation|inactive|unsupported|planned|disabled/.test(s)
    ? 'bg-amber-100 text-amber-900 border-amber-300'
    : /live|active|running|ok|protected|existing/.test(s)
      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
      : 'bg-muted text-muted-foreground';
  return <span data-testid="badge-runtime" className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] ${tone}`}>{status}</span>;
}

export function LoginCard({ loginUrl, oauthConfigured = true, title = 'Sign in with Discord' }: { loginUrl?: string; oauthConfigured?: boolean; title?: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-card p-8 shadow-sm rise" data-testid="login-card">
      <Logo />
      <h1 className="mt-6 font-display text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Smith only shows servers where you hold management permission and the bot is installed. Authentication happens on Discord; Smith never sees your password.</p>
      {!oauthConfigured && <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="text-oauth-unconfigured">Discord OAuth is not configured on this deployment yet, so sign-in is unavailable.</p>}
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
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
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
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
          <span>Agent Smith</span>
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
      <Button size="sm" variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending} data-testid="button-logout"><LogOut className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Log out</span></Button>
    </div>
  );
}

export function DashboardTopbar({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
      <Link href="/dashboard" data-testid="link-dashboard-home"><Logo /></Link>
      <div className="ml-auto flex items-center gap-3">{children}<UserMenu /></div>
    </header>
  );
}

export function GuildShell({ guildId, page, children }: { guildId: string; page: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const guilds = useListPlatformGuilds();
  const guild = guilds.data?.find((g) => g.id === guildId);
  const session = useGetPlatformSession().data;
  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/50">{g.label}</p>
          {g.pages.map((p) => (
            <Link key={p} href={`/dashboard/${guildId}/${p}`} onClick={() => setOpen(false)} data-testid={`link-nav-${p}`}
              className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${p === page ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60'}`}>
              {PAGES[p].title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[15rem_1fr]">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform md:static md:w-auto md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center justify-between px-4 border-b border-sidebar-border">
          <Link href="/dashboard" data-testid="link-switch-server"><Logo dark /></Link>
          <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        <Link href="/dashboard" className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-sidebar-border p-2 hover:bg-sidebar-accent/60" data-testid="link-guild-switcher">
          <Avatar className="h-8 w-8"><AvatarImage src={guild ? guildIconUrl(guild.id, guild.icon) ?? undefined : undefined} /><AvatarFallback className="bg-sidebar-accent text-xs">{initials(guild?.name ?? 'S')}</AvatarFallback></Avatar>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-sidebar-accent-foreground" data-testid="text-guild-name">{guild?.name ?? 'Server'}</span><span className="block text-[11px] text-sidebar-foreground/60">Switch server</span></span>
        </Link>
        {nav}
        <div className="border-t border-sidebar-border p-3 text-xs flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${session?.botOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span data-testid="text-bot-status">{session?.botOnline ? 'Bot online' : 'Bot offline'}</span>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
          <Button size="icon" variant="ghost" className="md:hidden" onClick={() => setOpen(true)} data-testid="button-open-menu"><Menu className="h-5 w-5" /></Button>
          <p className="font-display text-lg font-bold">{PAGES[page].title}</p>
          <div className="ml-auto"><UserMenu /></div>
        </header>
        <main className="mx-auto max-w-5xl p-4 md:p-8 space-y-6 rise">
          <p className="text-sm text-muted-foreground -mt-2">{PAGES[page].blurb}</p>
          {children}
        </main>
      </div>
    </div>
  );
}
