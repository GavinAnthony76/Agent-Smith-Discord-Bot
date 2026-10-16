import { Link } from 'wouter';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import {
  getGetPlatformModulesQueryKey,
  getGetPlatformOverviewQueryKey,
  getGetPlatformResourcesQueryKey,
  useGetPlatformModules,
  useGetPlatformOverview,
  useGetPlatformResources,
  useGetPlatformSession,
  useListPlatformGuilds,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AuthGate, DashboardTopbar, EmptyState, ErrorState, GuildShell } from '@/components/shell';
import { SetupFlow } from '@/components/setup-flow';
import { SystemHealthPanel } from '@/components/system-status';
import { CollectionPanel, ModulePanel } from '@/components/panels';
import { EntitlementsPanel } from '@/components/plans';
import { ConsoleEvent, MetricCard, ModuleCard } from '@/components/smith-ui';
import { SmithMark } from '@/components/branding';
import { PAGES, errMsg, guildIconUrl, initials } from '@/lib/platform';
import NotFound from '@/pages/not-found';

export function ServerSelector() {
  return (
    <AuthGate>
      <div className="min-h-[100dvh]">
        <DashboardTopbar />
        <SelectorBody />
      </div>
    </AuthGate>
  );
}

function SelectorBody() {
  const session = useGetPlatformSession().data;
  const q = useListPlatformGuilds();
  return (
    <main className="mx-auto max-w-4xl p-4 md:p-10 rise">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="eyebrow">Server selector</p><h1 className="font-display text-3xl font-bold">Your servers</h1>
          <p className="text-sm text-muted-foreground">Only servers where you can manage Smith and the bot is installed appear here.</p>
        </div>
        {session?.installUrl && <Button asChild variant="outline" className="ml-auto" data-testid="button-install-bot"><a href={session.installUrl} target="_blank" rel="noreferrer"><Plus className="h-4 w-4 mr-1" />Add Smith to a server</a></Button>}
      </div>
      <div className="mt-6 space-y-2">
        {q.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
        {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} />}
        {q.data?.length === 0 && <EmptyState title="No authorized servers with Smith installed" body="Invite Smith to a server you manage, then return here. If Smith is already there, you may lack the Manage Server permission or an assigned dashboard role." action={session?.installUrl ? <Button asChild><a href={session.installUrl} target="_blank" rel="noreferrer">Invite Smith</a></Button> : undefined} />}
        {q.data?.map((g) => (
          <Link key={g.id} href={`/dashboard/${g.id}/${g.setupComplete ? 'overview' : 'setup'}`} data-testid={`card-guild-${g.id}`}
            className="flex items-center gap-4 panel tile-hover p-4">
            <Avatar className="h-12 w-12 rounded-lg"><AvatarImage src={guildIconUrl(g.id, g.icon) ?? undefined} /><AvatarFallback className="rounded-lg">{initials(g.name)}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-bold">{g.name}</p>
              <p className="text-xs text-muted-foreground">Role: {g.role} · Policy: {g.policy}</p>
            </div>
            <Badge variant={g.setupComplete ? 'secondary' : 'default'}>{g.setupComplete ? 'Configured' : 'Needs setup'}</Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </main>
  );
}

export function GuildPage({ guildId, page }: { guildId: string; page: string }) {
  if (!PAGES[page]) return <NotFound />;
  return (
    <AuthGate>
      <GuildShell guildId={guildId} page={page}>
        <GuildPageBody guildId={guildId} page={page} />
      </GuildShell>
    </AuthGate>
  );
}

function GuildPageBody({ guildId, page }: { guildId: string; page: string }) {
  if (page === 'overview') return <OverviewPage guildId={guildId} />;
  if (page === 'setup') return <SetupFlow guildId={guildId} />;
  return <ModuleAndCollections guildId={guildId} page={page} />;
}

function ModuleAndCollections({ guildId, page }: { guildId: string; page: string }) {
  const def = PAGES[page];
  const mods = useGetPlatformModules(guildId, { query: { enabled: !!def.module, queryKey: getGetPlatformModulesQueryKey(guildId) } });
  const needsResources = page !== 'audit';
  const res = useGetPlatformResources(guildId, { query: { enabled: needsResources, queryKey: getGetPlatformResourcesQueryKey(guildId) } });
  const mod = def.module ? mods.data?.find((m) => m.moduleKey === def.module) : undefined;
  return (
    <div className="space-y-6">
      {page === 'onboarding' && <div className="notice notice-info" data-testid="notice-hallowed-core">The protected Hallowed Core onboarding remains the existing flow. Changes here configure the platform module and do not replace it.</div>}
      {page === 'roles' && res.data && (
        <section className="panel p-4" data-testid="panel-role-flags">
          <h2 className="font-display text-xl font-bold">Role flags</h2>
          <p className="text-xs text-muted-foreground mb-3">Protected roles cannot be self-assigned or rewarded. Rewardable roles can be granted by rewards and leveling.</p>
          {res.data.roles.length === 0 ? <p className="text-sm text-muted-foreground">No roles were reported for this server.</p> : (
            <div className="flex flex-wrap gap-1.5">
              {res.data.roles.map((r) => (
                <span key={r.id} className="chip" data-testid={`role-flag-${r.id}`}>
                  @{r.name}
                  {r.protected && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">protected</Badge>}
                  {r.rewardable && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">rewardable</Badge>}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
      {res.isError && <ErrorState message={`Live channel and role lists failed to load: ${errMsg(res.error)}`} onRetry={() => res.refetch()} />}
      {page === 'audit' && <SystemHealthPanel guildId={guildId} />}
      {page === 'settings' && <EntitlementsPanel guildId={guildId} />}
      {def.module && mods.isLoading && <Skeleton className="h-72" />}
      {def.module && mods.isError && <ErrorState message={errMsg(mods.error)} onRetry={() => mods.refetch()} />}
      {def.module && mods.data && !mod && <EmptyState title="Module not reported" body={`The platform did not return a "${def.module}" module for this server.`} />}
      {mod && <ModulePanel guildId={guildId} mod={mod} resources={res.data} />}
      {def.collections?.filter((c) => !(page === 'settings' && c.key === 'entitlements')).map((c) => <CollectionPanel key={c.key} guildId={guildId} collection={c.key} label={c.label} resources={res.data} />)}
    </div>
  );
}

function OverviewPage({ guildId }: { guildId: string }) {
  const mode = useGetPlatformSession().data?.runtimeMode;
  const q = useGetPlatformOverview(guildId, { query: { queryKey: getGetPlatformOverviewQueryKey(guildId) } });
  const mods = useGetPlatformModules(guildId, { query: { queryKey: getGetPlatformModulesQueryKey(guildId) } });
  if (q.isLoading) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (q.isError || !q.data) return <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} />;
  const o = q.data;
  return (
    <div className="space-y-6">
      <section className="panel overflow-hidden" data-testid="group-system-core">
        <div className="relative h-24 overflow-hidden"><SmithMark banner className="h-24 opacity-80" /><div className="absolute inset-0 bg-gradient-to-t from-[#0E1726] to-transparent" /></div>
        <div className="space-y-3 p-4">
          <p className="eyebrow">System core</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" data-testid="badge-bot">{o.runtimeStatus?.botConnected === true ? 'Production Gateway online' :
              o.runtimeStatus?.botConnected === false ? 'Production Gateway disconnected' : 'Production Gateway unverified'}</Badge>
            <Badge variant="outline">{o.guild.policy === 'hallowed-core' ? 'Legacy/custom runtime' :
              o.runtimeStatus?.runtimeActive ? 'Guild adapter active' : 'Guild adapter inactive'}</Badge>
            <Badge variant="outline">{o.runtimeStatus?.platformEnabled ? 'Platform allowlisted' : 'Platform not activated'}</Badge>
            <Badge variant="outline" data-testid="badge-plan">Plan: {o.plan}</Badge>
            {!o.guild.setupComplete && <Button asChild size="sm" data-testid="button-run-setup"><Link href={`/dashboard/${guildId}/setup`}>Finish server setup</Link></Button>}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-4">
            {[['Environment', mode ?? 'not reported'], ['Database', 'not reported'], ['Workers', 'not reported'], ['Server', o.guild.name ?? guildId]].map(([k, v]) => (
              <div key={k} className="tile p-3"><dt className="eyebrow">{k}</dt><dd className="mt-1 truncate">{String(v)}</dd></div>
            ))}
          </dl>
        </div>
      </section>
      <SystemHealthPanel guildId={guildId} poll />
      {o.guild.policy !== 'hallowed-core' && (
        <div className="panel p-4 text-sm space-y-2" data-testid="guild-runtime-status">
          <p>Configuration: {o.runtimeStatus?.guildConfigured ? 'Present in production' : 'Production presence not confirmed'}</p>
          <p>Last heartbeat: {o.runtimeStatus?.lastSeenAt ? new Date(o.runtimeStatus.lastSeenAt).toLocaleString() : 'Not observed'}</p>
          <p>Analytics activation: {o.runtimeStatus?.activatedAt ? new Date(o.runtimeStatus.activatedAt).toLocaleString() : 'Not activated'}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(o.runtimeStatus?.moduleStates ?? {}).map(([key, active]) =>
              <Badge key={key} variant="outline">{key}: {active ? 'active' : 'inactive'}</Badge>)}
          </div>
          <p className="text-xs text-muted-foreground">{mode === 'production' ? 'Counters below use production data.' :
            'Preview counters below use the development database; production runtime status is reported separately.'}</p>
        </div>
      )}
      {o.warnings.length > 0 && (
        <div className="space-y-2" data-testid="list-warnings">
          {o.warnings.map((w, i) => <div key={i} className="flex gap-2 notice notice-warn"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{w}</div>)}
        </div>
      )}
      {(() => {
        const prog = /xp|level|achiev|reward|econom|credit|coin|shop/i;
        const progression = o.metrics.filter((m) => prog.test(`${m.key} ${m.label}`));
        const community = o.metrics.filter((m) => !prog.test(`${m.key} ${m.label}`));
        const grid = (list: typeof o.metrics) => list.map((m) => <MetricCard key={m.key} testId={`metric-${m.key}`} label={m.label} value={m.value} reason={m.reason} />);
        return (
          <>
            {o.metrics.length === 0 && <EmptyState title="No metrics reported" body="The platform returned no metrics for this server." />}
            {community.length > 0 && <section data-testid="group-community"><p className="eyebrow mb-2">Community</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{grid(community)}</div></section>}
            {progression.length > 0 && <section data-testid="group-progression"><p className="eyebrow mb-2">Progression</p><div className="grid gap-3 sm:grid-cols-2">{grid(progression)}</div></section>}
          </>
        );
      })()}
      <section data-testid="group-modules">
        <p className="eyebrow mb-2">Modules</p>
        {mods.isLoading && <Skeleton className="h-32" />}
        {mods.isError && <ErrorState message={errMsg(mods.error)} onRetry={() => mods.refetch()} />}
        <ul className="grid gap-3 md:grid-cols-2">
          {mods.data?.map((m) => <ModuleCard key={m.moduleKey} guildId={guildId} moduleKey={m.moduleKey} enabled={m.enabled} runtimeStatus={m.runtimeStatus} entitlement={m.entitlement} />)}
        </ul>
      </section>
      <section className="panel">
        <h2 className="panel-head font-display text-xl font-bold">Recent actions</h2>
        {o.recentActions.length === 0
          ? <div className="p-4"><EmptyState title="No recent actions" body="Moderation and configuration actions will be listed here." /></div>
          : <ul className="space-y-3 p-4">{o.recentActions.map((r) => <li key={r.id} data-testid={`action-${r.id}`}><ConsoleEvent title={r.title} time={r.createdAt ? new Date(r.createdAt).toLocaleString() : null} /></li>)}</ul>}
      </section>
    </div>
  );
}

