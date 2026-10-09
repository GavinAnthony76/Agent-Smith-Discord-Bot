import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  getGetPlatformModulesQueryKey,
  getGetPlatformOverviewQueryKey,
  getListPlatformGuildsQueryKey,
  useGetPlatformModules,
  useGetPlatformOverview,
  useGetPlatformResources,
  useGetPlatformSession,
  useListPlatformGuilds,
  useSavePlatformSetup,
  usePerformPlatformAction,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { AuthGate, DashboardTopbar, EmptyState, ErrorState, GuildShell, RuntimeBadge } from '@/components/shell';
import { CollectionPanel, ModulePanel } from '@/components/panels';
import { EntitlementsPanel } from '@/components/plans';
import { FieldInput } from '@/components/fields';
import { ConsoleEvent, MetricCard, ModuleCard } from '@/components/smith-ui';
import { SmithMark } from '@/components/branding';
import { MODULE_LABELS, PAGES, errMsg, guildIconUrl, initials, useCsrf } from '@/lib/platform';
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
  if (page === 'setup') return <SetupWizard guildId={guildId} />;
  return <ModuleAndCollections guildId={guildId} page={page} />;
}

function ModuleAndCollections({ guildId, page }: { guildId: string; page: string }) {
  const def = PAGES[page];
  const mods = useGetPlatformModules(guildId, { query: { enabled: !!def.module, queryKey: getGetPlatformModulesQueryKey(guildId) } });
  const res = useGetPlatformResources(guildId);
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
  const { request } = useCsrf();
  const { toast } = useToast();
  const qc = useQueryClient();
  const mode = useGetPlatformSession().data?.runtimeMode;
  const prepare = usePerformPlatformAction({ request, mutation: {
    onSuccess: result => {
      toast({title:'Live-test resources prepared',description:result.message});
      qc.invalidateQueries({queryKey:getGetPlatformModulesQueryKey(guildId)});
      qc.invalidateQueries({queryKey:getGetPlatformOverviewQueryKey(guildId)});
    },
    onError: error => toast({title:'Preparation held',description:errMsg(error),variant:'destructive'}),
  }});
  const q = useGetPlatformOverview(guildId, { query: { queryKey: getGetPlatformOverviewQueryKey(guildId), refetchInterval: 20000 } });
  const mods = useGetPlatformModules(guildId);
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
          {guildId === '1555330318569971743' && o.guild.role === 'OWNER' && (
            <div className="border-t pt-3 space-y-2">
              <p>Create a disposable cosmetic role, private ticket category, public test panel, onboarding entry and 5-credit shop item in LMOC TEST only.</p>
              <Button disabled={prepare.isPending || mode !== 'production' || !o.runtimeStatus?.runtimeActive}
                data-testid="button-prepare-live-test" onClick={() => prepare.mutate({
                  guildId,data:{action:'acceptance-prepare',target:guildId,confirmed:true},
                })}>{prepare.isPending ? 'Preparing…' : 'Prepare LMOC TEST live-test resources'}</Button>
              {mode !== 'production' && <p className="text-xs text-muted-foreground">This action requires the published dashboard and its existing Gateway. Preview cannot write to Discord.</p>}
            </div>
          )}
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

const STEPS: { title: string; body: string; modules?: string[] }[] = [
  { title: 'Review access', body: 'Confirm the server and the permissions Smith sees for you.' },
  { title: 'Safety modules', body: 'Moderation, automod, onboarding and role controls.', modules: ['moderation', 'automod', 'onboarding', 'roles'] },
  { title: 'Community modules', body: 'Member progression and engagement.', modules: ['leveling', 'economy', 'achievements', 'rewards'] },
  { title: 'Support and events', body: 'Tickets, greetings and scheduled events.', modules: ['tickets', 'welcome', 'events'] },
  { title: 'Integrations', body: 'External feeds, AI and analytics.', modules: ['feeds', 'youtube', 'ai', 'analytics'] },
  { title: 'Log channel', body: 'Where Smith posts moderation and audit entries.' },
  { title: 'Welcome channel', body: 'Where new members are greeted.' },
  { title: 'Review', body: 'Check everything before saving.' },
  { title: 'Launch', body: 'Save the configuration and finish setup.' },
];

function SetupWizard({ guildId }: { guildId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { request } = useCsrf();
  const guilds = useListPlatformGuilds();
  const mods = useGetPlatformModules(guildId);
  const res = useGetPlatformResources(guildId);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [logId, setLogId] = useState('');
  const [welcomeId, setWelcomeId] = useState('');
  const [done, setDone] = useState(false);
  const save = useSavePlatformSetup({
    request,
    mutation: {
      onSuccess: () => {
        setDone(true);
        qc.invalidateQueries({ queryKey: getListPlatformGuildsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPlatformModulesQueryKey(guildId) });
        qc.invalidateQueries({ queryKey: getGetPlatformOverviewQueryKey(guildId) });
        toast({ title: 'Setup saved' });
      },
      onError: (e) => toast({ title: 'Setup failed', description: errMsg(e), variant: 'destructive' }),
    },
  });
  const guild = guilds.data?.find((g) => g.id === guildId);
  if (mods.isLoading) return <Skeleton className="h-80" />;
  if (mods.isError) return <ErrorState message={errMsg(mods.error)} onRetry={() => mods.refetch()} />;
  const selected = picked ?? mods.data?.filter((m) => m.enabled).map((m) => m.moduleKey) ?? [];
  const toggle = (k: string) => setPicked(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  const s = STEPS[step];
  const chName = (id: string) => res.data?.channels.find((c) => c.id === id)?.name;
  const field = (type: 'channel') => ({ key: 'c', label: '', type });

  if (done) return (
    <div className="panel p-8 text-center" data-testid="setup-done">
      <Check className="mx-auto h-8 w-8 text-primary" />
      <h2 className="mt-3 font-display text-2xl font-bold">Setup saved</h2>
      <Button asChild className="mt-4"><Link href={`/dashboard/${guildId}/overview`}>Go to overview</Link></Button>
    </div>
  );

  return (
    <div className="panel" data-testid="setup-wizard">
      <div className="flex gap-1 p-4 border-b border-white/10">{STEPS.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-gradient-to-r from-cyan-300 to-violet-500' : 'bg-white/10'}`} />)}</div>
      <div className="p-5 space-y-4 min-h-64">
        <p className="font-mono text-xs text-muted-foreground" data-testid="text-step-count">Step {step + 1} of {STEPS.length}</p>
        <h2 className="font-display text-2xl font-bold">{s.title}</h2>
        <p className="text-sm text-muted-foreground">{s.body}</p>
        {step === 0 && (
          <dl className="grid grid-cols-2 gap-3 text-sm max-w-md">
            <dt className="text-muted-foreground">Server</dt><dd>{guild?.name ?? guildId}</dd>
            <dt className="text-muted-foreground">Your role</dt><dd>{guild?.role ?? 'Unknown'}</dd>
            <dt className="text-muted-foreground">Policy</dt><dd>{guild?.policy ?? 'Unknown'}</dd>
          </dl>
        )}
        {s.modules && (
          <ul className="space-y-2">
            {s.modules.map((k) => {
              const m = mods.data?.find((x) => x.moduleKey === k);
              return (
                <li key={k} className="tile flex items-start gap-3 p-3">
                  <Checkbox checked={selected.includes(k)} onCheckedChange={() => toggle(k)} disabled={!m} id={`mod-${k}`} data-testid={`checkbox-module-${k}`} />
                  <label htmlFor={`mod-${k}`} className="flex-1 text-sm"><span className="font-medium">{MODULE_LABELS[k]}</span>{!m && <span className="ml-2 text-xs text-muted-foreground">not reported</span>}</label>
                  {m && <RuntimeBadge status={m.runtimeStatus} />}
                </li>
              );
            })}
          </ul>
        )}
        {step === 5 && <div className="max-w-sm"><FieldInput field={field('channel')} value={logId} onChange={(v) => setLogId(String(v ?? ''))} resources={res.data} /></div>}
        {step === 6 && <div className="max-w-sm"><FieldInput field={field('channel')} value={welcomeId} onChange={(v) => setWelcomeId(String(v ?? ''))} resources={res.data} /></div>}
        {(step === 7 || step === 8) && (
          <dl className="space-y-2 text-sm" data-testid="setup-review">
            <div><dt className="text-muted-foreground">Modules to enable</dt><dd>{selected.length ? selected.map((k) => MODULE_LABELS[k] ?? k).join(', ') : 'None'}</dd></div>
            <div><dt className="text-muted-foreground">Log channel</dt><dd>{logId ? `#${chName(logId) ?? logId}` : 'Not set'}</dd></div>
            <div><dt className="text-muted-foreground">Welcome channel</dt><dd>{welcomeId ? `#${chName(welcomeId) ?? welcomeId}` : 'Not set'}</dd></div>
          </dl>
        )}
      </div>
      <div className="flex justify-between border-t border-white/10 p-4">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="button-setup-back"><ChevronLeft className="h-4 w-4" />Back</Button>
        {step < STEPS.length - 1
          ? <Button onClick={() => setStep(step + 1)} data-testid="button-setup-next">Next<ChevronRight className="h-4 w-4" /></Button>
          : <Button disabled={save.isPending} onClick={() => save.mutate({ guildId, data: { modules: selected, logChannelId: logId || null, welcomeChannelId: welcomeId || null } })} data-testid="button-setup-finish">{save.isPending ? 'Saving' : 'Finish setup'}</Button>}
      </div>
    </div>
  );
}
