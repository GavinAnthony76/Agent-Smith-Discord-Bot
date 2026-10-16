import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Circle, Loader2, X } from 'lucide-react';
import {
  getGetPlatformModulesQueryKey,
  getGetPlatformOverviewQueryKey,
  getGetPlatformResourcesQueryKey,
  getGetPlatformSetupStateQueryKey,
  getGetPlatformSystemStatusQueryKey,
  getListPlatformGuildsQueryKey,
  useGetPlatformModules,
  useGetPlatformResources,
  useGetPlatformSetupState,
  usePreviewPlatformSetup,
  useSavePlatformSetup,
  type PlatformSetupState,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { ErrorState, RuntimeBadge } from '@/components/shell';
import { FieldInput } from '@/components/fields';
import { MODULE_LABELS, errMsg, useCsrf } from '@/lib/platform';

const STAGE_TONE: Record<string, string> = {
  READY: 'chip-live', DEGRADED: 'chip-warn', FAILED: 'chip-warn', BLOCKED: 'chip-warn',
};

function StepIcon({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === 'unknown') return <span className="font-mono text-[11px] font-bold text-muted-foreground">?</span>;
  if (/ok|done|pass|complete|success|ready|healthy/.test(s)) return <Check className="h-4 w-4 text-emerald-400" />;
  if (/fail|error|block/.test(s)) return <X className="h-4 w-4 text-red-400" />;
  if (/run|progress|active/.test(s)) return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (/warn|degrad|skip/.test(s)) return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function Stages({ state }: { state: PlatformSetupState }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="list-setup-stages">
      {state.steps.map((st, i) => {
        const failed = /fail|error|block/i.test(st.status);
        return (
          <li key={st.key} className={`tile p-3 ${failed ? 'ring-1 ring-red-500/60' : ''}`} data-testid={`stage-${st.key}`}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              <StepIcon status={st.status} />
              <span className="truncate text-sm font-medium">{st.label}</span>
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">{st.status}</p>
            {st.message && <p className={`mt-1 text-xs ${failed ? 'text-red-300' : 'text-muted-foreground'}`}>{st.message}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function PreviewList({ title, items, testId }: { title: string; items: string[]; testId: string }) {
  return (
    <div className="tile p-3" data-testid={testId}>
      <p className="eyebrow mb-1.5">{title}</p>
      {items.length === 0 ? <p className="text-xs text-muted-foreground">Nothing</p> :
        <ul className="space-y-0.5 text-sm">{items.map((x) => <li key={x}>· {x}</li>)}</ul>}
    </div>
  );
}

export function SetupFlow({ guildId }: { guildId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { request } = useCsrf();
  const stateQ = useGetPlatformSetupState(guildId, { query: { queryKey: getGetPlatformSetupStateQueryKey(guildId), enabled: !!guildId } });
  const mods = useGetPlatformModules(guildId, { query: { queryKey: getGetPlatformModulesQueryKey(guildId), enabled: !!guildId } });
  const res = useGetPlatformResources(guildId, { query: { queryKey: getGetPlatformResourcesQueryKey(guildId), enabled: !!guildId } });
  const [picked, setPicked] = useState<string[] | null>(null);
  const [logId, setLogId] = useState('');
  const [welcomeId, setWelcomeId] = useState('');
  const [preview, setPreview] = useState<PlatformSetupState | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const revalidate = () => qc.invalidateQueries({ queryKey: getGetPlatformSetupStateQueryKey(guildId) });
  const resetPreview = () => { setPreview(null); setConfirmed(false); };

  const previewM = usePreviewPlatformSetup({ request, mutation: {
    onSuccess: (s) => { setPreview(s); setConfirmed(false); setLastError(null); },
    onError: (e) => { setLastError(errMsg(e)); revalidate(); },
  } });
  const save = useSavePlatformSetup({ request, mutation: {
    onSuccess: (r) => {
      setDone(true); resetPreview(); setLastError(null);
      for (const k of [getListPlatformGuildsQueryKey(), getGetPlatformModulesQueryKey(guildId), getGetPlatformOverviewQueryKey(guildId),
        getGetPlatformSystemStatusQueryKey(guildId), getGetPlatformSetupStateQueryKey(guildId)]) qc.invalidateQueries({ queryKey: k });
      toast({ title: 'Setup applied', description: r.message });
    },
    onError: (e) => {
      // Preview is now stale: require a new preview before any resume.
      setLastError(errMsg(e)); resetPreview(); revalidate();
      toast({ title: 'Setup stopped', description: 'Review the failed check, run a new preview, then resume.', variant: 'destructive' });
    },
  } });

  if (stateQ.isLoading || mods.isLoading) return <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-72" /></div>;
  if (stateQ.isError) return <ErrorState message={`Setup state could not be loaded. ${errMsg(stateQ.error)}`} onRetry={() => stateQ.refetch()} />;
  if (mods.isError) return <ErrorState message={errMsg(mods.error)} onRetry={() => mods.refetch()} />;
  const state = stateQ.data!;
  const selected = picked ?? mods.data?.filter((m) => m.enabled).map((m) => m.moduleKey) ?? [];
  const toggle = (k: string) => { resetPreview(); setPicked(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]); };
  const input = { modules: selected, logChannelId: logId || null, welcomeChannelId: welcomeId || null };
  const failed = state.state === 'FAILED' || state.state === 'DEGRADED';
  const blocked = state.classification === 'BLOCKED';
  // Only CONFIGURING may reflect a live lease; the server enforces lease + revision, so we never disable preflight on state names.
  const busy = state.state === 'CONFIGURING';
  const localPending = previewM.isPending || save.isPending;
  const shown = preview ?? state;
  const field = { key: 'c', label: '', type: 'channel' as const };

  return (
    <div className="space-y-5" data-testid="setup-flow">
      <section className="panel">
        <div className="panel-head flex-wrap">
          <div>
            <p className="eyebrow">Setup state</p>
            <h2 className="font-display text-2xl font-bold" data-testid="text-setup-state">{state.state.replace(/_/g, ' ')}</h2>
          </div>
          <span className={`chip ${STAGE_TONE[state.classification] ?? ''}`} data-testid="text-setup-classification">{state.classification.replace(/_/g, ' ')}</span>
          <span className={`chip ${STAGE_TONE[state.state] ?? ''}`}>{state.retrySafe ? 'Retry safe' : 'Retry not safe'}</span>
          <p className="ml-auto font-mono text-[11px] text-muted-foreground">
            rev {state.revision}{state.updatedAt ? ` · ${new Date(state.updatedAt).toLocaleString()}` : ''}{state.referenceId ? ` · ref ${state.referenceId}` : ''}
          </p>
        </div>
        <div className="p-4 space-y-3">
          <Stages state={state} />
          {failed && (
            <div className="notice notice-warn" data-testid="notice-setup-failed">
              Setup stopped before making additional changes. Review the failed check and resume when ready.
              {state.referenceId && <span className="font-mono"> Reference: {state.referenceId}</span>}
              {!state.retrySafe && <p className="mt-1">Automatic retry is not safe for this failure. Resolve the failed check first, then run a fresh preview.</p>}
            </div>
          )}
          {blocked && <div className="notice notice-warn">Setup is blocked by a preflight check. No changes will be made until it passes.</div>}
          {busy && <div className="notice notice-info">A configuration attempt may be in progress; the server will reject overlapping runs. <Button size="sm" variant="outline" onClick={() => stateQ.refetch()} data-testid="button-refresh-setup">Refresh state</Button></div>}
          {lastError && <div className="notice notice-warn" data-testid="text-setup-error">{lastError}</div>}
        </div>
      </section>

      {done || (state.state === 'READY' && state.classification === 'ALREADY_CONFIGURED' && !picked) ? (
        <section className="panel p-6 text-center" data-testid="setup-done">
          <Check className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-2 font-display text-xl font-bold">{done ? 'Setup applied' : 'Already configured'}</h2>
          <p className="text-sm text-muted-foreground">Existing defaults are preserved. Check observed health on the overview.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild><Link href={`/dashboard/${guildId}/overview`}>Go to overview</Link></Button>
            {!done && <Button variant="outline" onClick={() => setPicked(selected)} data-testid="button-review-setup">Review configuration</Button>}
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head"><h2 className="font-display text-xl font-bold">Configuration</h2>
            <p className="ml-auto text-xs text-muted-foreground">Setup creates no Discord roles or channels. It adds missing dashboard configuration only.</p></div>
          <div className="grid gap-5 p-4 lg:grid-cols-[1fr_320px]">
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {(mods.data ?? []).map((m) => (
                <li key={m.moduleKey} className="tile flex items-center gap-2.5 p-2.5">
                  <Checkbox id={`mod-${m.moduleKey}`} checked={selected.includes(m.moduleKey)} onCheckedChange={() => toggle(m.moduleKey)} data-testid={`checkbox-module-${m.moduleKey}`} />
                  <label htmlFor={`mod-${m.moduleKey}`} className="flex-1 truncate text-sm">{MODULE_LABELS[m.moduleKey] ?? m.moduleKey}</label>
                  <RuntimeBadge status={m.runtimeStatus} />
                </li>
              ))}
            </ul>
            <div className="space-y-3">
              {res.isError && <ErrorState message={`Channel list unavailable. ${errMsg(res.error)}`} onRetry={() => res.refetch()} />}
              <div><p className="eyebrow mb-1">Log channel (reused)</p><FieldInput field={field} value={logId} onChange={(v) => { resetPreview(); setLogId(String(v ?? '')); }} resources={res.data} /></div>
              <div><p className="eyebrow mb-1">Welcome channel (reused)</p><FieldInput field={field} value={welcomeId} onChange={(v) => { resetPreview(); setWelcomeId(String(v ?? '')); }} resources={res.data} /></div>
              <Button className="w-full" variant={preview ? 'outline' : 'default'} disabled={localPending}
                onClick={() => previewM.mutate({ guildId, data: input })} data-testid="button-preview-setup">
                {previewM.isPending ? 'Running preflight' : failed ? 'Run new preview before resume' : 'Run preflight preview'}
              </Button>
            </div>
          </div>
          {preview && (
            <div className="border-t border-white/10 p-4 space-y-3" data-testid="setup-preview">
              <div className="flex flex-wrap items-center gap-2">
                <p className="eyebrow">Preflight preview</p>
                <span className={`chip ${STAGE_TONE[preview.classification] ?? ''}`}>{preview.classification.replace(/_/g, ' ')}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">rev {preview.revision}{preview.previewHash ? ` · ${preview.previewHash.slice(0, 12)}` : ''}</span>
              </div>
              {preview.steps.length > 0 && <Stages state={preview} />}
              <div className="grid gap-2 md:grid-cols-3">
                <PreviewList title="Will create (dashboard config)" items={shown.preview.willCreate} testId="preview-create" />
                <PreviewList title="Will reuse" items={shown.preview.willReuse} testId="preview-reuse" />
                <PreviewList title="Will not change" items={shown.preview.willNotChange} testId="preview-unchanged" />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} disabled={preview.classification === 'BLOCKED'} data-testid="checkbox-confirm-setup" />
                I reviewed this preview. Native Hallowed rules, access and existing defaults stay as they are.
              </label>
              <div className="flex justify-end">
                <Button disabled={!confirmed || save.isPending || !preview.previewHash || preview.classification === 'BLOCKED'}
                  onClick={() => save.mutate({ guildId, data: { ...input, confirmed: true, expectedRevision: preview.revision, previewHash: preview.previewHash } })}
                  data-testid="button-setup-finish">
                  {save.isPending ? 'Applying' : failed ? 'Resume setup' : 'Apply setup'}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
