import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { useHealthCheck, useGetPlatformSession } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginCard, PublicLayout, RuntimeBadge } from '@/components/shell';
import { SmithMark } from '@/components/branding';
import { MODULE_LABELS } from '@/lib/platform';

function Prose({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-2xl px-4 py-12 rise">
        <h1 className="font-display text-4xl font-bold">{title}</h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
      </article>
    </PublicLayout>
  );
}

export function Landing() {
  const s = useGetPlatformSession().data;
  return (
    <PublicLayout>
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-28 grid gap-10 md:grid-cols-[1.3fr_1fr] items-center">
        <div className="rise">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Discord operations platform · private testing preview</p>
          <h1 className="mt-3 font-display text-5xl md:text-7xl font-bold leading-[0.95]">One careful bot. <span className="grad-text">Every server you run.</span></h1>
          <p className="mt-5 max-w-xl text-muted-foreground">Agent Smith is being upgraded from a guarded community bot to a server-scoped operations dashboard. Authentication, configuration and audit foundations are built; several module adapters remain in development. Multi-server operation is not yet verified. Install only into an approved test server.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" data-testid="button-hero-dashboard"><Link href="/dashboard">Open dashboard</Link></Button>
            {s?.installUrl && <Button asChild size="lg" variant="outline" data-testid="button-hero-invite"><a href={s.installUrl} target="_blank" rel="noreferrer">Add to Discord</a></Button>}
          </div>
        </div>
        <div className="glass overflow-hidden text-sm text-slate-300"><SmithMark banner className="h-28" /><div className="p-5">
          <p className="eyebrow">Guarded by design</p>
          {['Sign in with Discord OAuth', 'Servers filtered by your permissions', 'CSRF-protected writes', 'Revision-checked saves', 'Audit entry on every change'].map((l) => <p key={l} className="mt-3 flex items-center gap-3"><span className="h-1 w-1 shrink-0 rounded-full bg-cyan-300" aria-hidden="true" />{l}</p>)}
        </div></div>
      </section>
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="font-display text-3xl font-bold">Modules</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each module reports its real runtime status in the dashboard. Features still being built are labeled foundation or inactive.</p>
          <div className="mt-6 flex flex-wrap gap-2">{Object.values(MODULE_LABELS).map((l) => <span key={l} className="chip text-sm">{l}</span>)}</div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-14 grid gap-8 md:grid-cols-2">
        <div><h3 className="font-display text-2xl font-bold">Protected by default</h3><p className="mt-2 text-sm text-muted-foreground">Protected roles, the Hallowed Core onboarding and owner-only controls cannot be altered through the dashboard.</p></div>
        <div><h3 className="font-display text-2xl font-bold">No guesswork</h3><p className="mt-2 text-sm text-muted-foreground">If a number is not available, the dashboard says so and why, instead of showing a placeholder.</p></div>
      </section>
    </PublicLayout>
  );
}

export function LoginPage() {
  const q = useGetPlatformSession();
  return (
    <PublicLayout>
      <div className="px-4 py-16">
        {q.isLoading ? <Skeleton className="mx-auto h-64 max-w-md" /> : <LoginCard loginUrl={q.data?.loginUrl} oauthConfigured={!!q.data?.oauthConfigured && q.data?.oauthCallbackRegistered !== false} />}
        {q.data?.oauthCallbackRegistered === false && <p className="mt-4 text-center text-sm">The application owner must register this dashboard’s OAuth callback in the Discord Developer Portal before sign-in can work.</p>}
        {q.data?.authenticated && <p className="mt-4 text-center text-sm">You are signed in. <Link href="/dashboard" className="underline">Open the dashboard</Link></p>}
      </div>
    </PublicLayout>
  );
}

const PLANS = [
  { name: 'Free', body: 'Core moderation, onboarding and roles for a single community.', items: ['Core modules', 'Audit log', 'Standard limits'] },
  { name: 'Pro', body: 'Higher limits and extra modules for active communities.', items: ['Everything in Free', 'Raised record limits', 'AI usage allowance'] },
  { name: 'Ultimate', body: 'Largest limits and priority features for large networks.', items: ['Everything in Pro', 'Highest limits', 'Early access to new modules'] },
];

export function Premium() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-5xl px-4 py-14 rise">
        <h1 className="font-display text-4xl font-bold">Plans</h1>
        <p className="mt-3 notice notice-warn" data-testid="text-billing-notice">Billing is not enabled. There is no checkout, and no final prices have been set. The tiers below are proposed and their contents may change.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PLANS.map((p, i) => (
            <div key={p.name} className={`panel p-5 ${i === 1 ? 'md:-translate-y-2 border-cyan-300/40' : ''}`} data-testid={`plan-${p.name.toLowerCase()}`}>
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Proposed</p>
              <h2 className="font-display text-2xl font-bold">{p.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
              <ul className="mt-4 space-y-1 text-sm">{p.items.map((x) => <li key={x}>{x}</li>)}</ul>
              <Button disabled className="mt-5 w-full" variant="outline">Not available yet</Button>
            </div>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}

export function Docs() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-12 rise">
        <h1 className="font-display text-4xl font-bold">Documentation</h1>
        <h2 className="mt-8 font-display text-2xl font-bold">Getting started</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Invite Smith to your server with the Add to Discord button.</li>
          <li>Sign in with Discord. Only servers you can manage appear.</li>
          <li>Run the 9-step setup to choose modules, a log channel and a welcome channel.</li>
          <li>Fine-tune each module from the sidebar.</li>
        </ol>
        <h2 className="mt-8 font-display text-2xl font-bold">Modules</h2>
        <ul className="mt-3 divide-y divide-white/10 rounded-2xl border text-sm">
          {Object.entries(MODULE_LABELS).map(([k, l]) => <li key={k} className="flex justify-between p-3"><span>{l}</span><span className="font-mono text-xs text-muted-foreground">{k}</span></li>)}
        </ul>
        <h2 className="mt-8 font-display text-2xl font-bold">Runtime status</h2>
        <p className="mt-2 text-sm text-muted-foreground">Every module shows a status such as <RuntimeBadge status="live" /> or <RuntimeBadge status="foundation (inactive)" />. Foundation means the settings are stored but the bot does not act on them yet.</p>
        <h2 className="mt-8 font-display text-2xl font-bold">Saving safely</h2>
        <p className="mt-2 text-sm text-muted-foreground">Each save carries a revision number. If someone else changed the same item first, your save is rejected so nothing is overwritten silently.</p>
      </div>
    </PublicLayout>
  );
}

export function Status() {
  const s = useGetPlatformSession();
  const h = useHealthCheck();
  const row = (label: string, state: 'ok' | 'bad' | 'load', text: string) => (
    <li className="flex items-center justify-between p-4" data-testid={`status-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <span>{label}</span>
      {state === 'load' ? <Skeleton className="h-5 w-20" /> : <RuntimeBadge status={text} />}
    </li>
  );
  return (
    <PublicLayout>
      <div className="mx-auto max-w-xl px-4 py-12 rise">
        <h1 className="font-display text-4xl font-bold">Status</h1>
        <p className="mt-2 text-sm text-muted-foreground">Live readings from this deployment, taken when the page loaded.</p>
        <ul className="mt-6 divide-y divide-white/10 panel">
          {row('API', h.isLoading ? 'load' : h.isError ? 'bad' : 'ok', h.isError ? 'unreachable' : 'active')}
          {row('Discord bot', s.isLoading ? 'load' : 'ok', s.data?.botConnected === true ? 'Production Gateway connected' :
            s.data?.botConnected === false ? 'Production Gateway disconnected' : 'Production Gateway unverified; preview is REST-only')}
          {row('Discord OAuth', s.isLoading ? 'load' : 'ok', !s.data?.oauthConfigured ? 'credentials not configured' : s.data?.oauthCallbackRegistered === true ? 'callback registered; Discord sign-in available' : s.data?.oauthCallbackRegistered === false ? 'callback registration required' : 'callback not verified')}
        </ul>
      </div>
    </PublicLayout>
  );
}

export function Privacy() {
  return (
    <Prose title="Privacy">
      <p>When you sign in, Smith receives your Discord user ID, username and avatar, and the list of servers you belong to, so it can decide which dashboards you may open.</p>
      <p>Smith stores server configuration you save, and an audit log of changes made through the dashboard. Session cookies are used for sign-in and are not shared with third parties.</p>
      <p>Server owners can ask for configuration data to be removed by removing Smith from the server. This page is a plain-language summary and may be updated as the platform develops.</p>
    </Prose>
  );
}

export function Terms() {
  return (
    <Prose title="Terms">
      <p>Use Smith only on servers you are authorized to manage, and in line with Discord's terms and community guidelines.</p>
      <p>Features marked foundation or inactive are provided as-is and may not act on your settings yet. Paid plans are not currently offered.</p>
      <p>We may change or discontinue features as the platform develops. This is a summary and may be replaced by a fuller agreement before billing begins.</p>
    </Prose>
  );
}
