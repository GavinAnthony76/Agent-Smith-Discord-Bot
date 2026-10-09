import {Link} from './_routing';import {AlertTriangle} from 'lucide-react';import {Badge} from '@/components/ui/badge';import {Button} from './_button';import {Skeleton} from './_skeleton';import {SmithMark} from './_branding';import {MetricCard,ModuleCard,ConsoleEvent} from './_smith-ui';import {EmptyState,ErrorState} from './_redesigned-shell';import {errMsg} from './_platform';
export function Overview({guildId}:{guildId:string}){const o={guild:{name:'Hallowed Core · design sample',policy:'hallowed-core',role:'VIEW_ONLY',setupComplete:true},runtimeStatus:{botConnected:null,runtimeActive:false,platformEnabled:false,guildConfigured:false,lastSeenAt:null as string|null,activatedAt:null as string|null,moduleStates:{}},plan:'Design sample',warnings:[] as string[],metrics:[{key:'members',label:'Recorded members (sample)',value:22},{key:'pending',label:'Pending onboarding',value:null,reason:'Not supplied by this preview'},{key:'xp',label:'Recorded XP (sample)',value:4230}],recentActions:[{id:'sample',title:'Configuration reviewed — sample event',createdAt:null as string|null}]};
const mode=String('preview');const prepare={isPending:false,mutate:(_:unknown)=>{}};const q={refetch:()=>{}};
const mods={isLoading:false,isError:false,error:null,refetch:()=>{},data:['onboarding','roles','leveling','economy','tickets','ai','analytics','moderation'].map(moduleKey=>({moduleKey,enabled:true,runtimeStatus:moduleKey==='moderation'?'Configuration foundation; activation pending':'Platform runtime · design sample'}))};
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
          {mods.data?.map((m) => <ModuleCard key={m.moduleKey} guildId={guildId} moduleKey={m.moduleKey} enabled={m.enabled} runtimeStatus={m.runtimeStatus} />)}
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
