import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPlatformEntitlementsQueryKey,
  getGetPlatformModulesQueryKey,
  getGetPlatformOverviewQueryKey,
  useAssignPlatformPlan,
  useGetPlatformEntitlements,
  type PlatformEntitlementView,
  type PlatformEntitlementLimit,
  type PlatformFeatureEntitlement,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { ErrorState } from '@/components/shell';
import { errMsg, useCsrf } from '@/lib/platform';

const PLANS = ['FREE', 'PRO', 'ULTIMATE'] as const;
const STATUSES = ['ACTIVE', 'TRIAL', 'MANUAL', 'SUSPENDED', 'EXPIRED'] as const;
type Plan = (typeof PLANS)[number];
type Status = (typeof STATUSES)[number];

const STATE_TONE: Record<string, string> = {
  ENABLED: 'chip-live', AVAILABLE: 'chip-info', DISABLED: '', LOCKED_BY_PLAN: 'chip-warn', LIMIT_REACHED: 'chip-bad', UNSUPPORTED: 'chip-warn',
};

function limitText(l: PlatformEntitlementLimit) {
  const cap = l.value === null ? 'Not set' : l.value === -1 ? 'Unlimited' : l.value.toLocaleString();
  const used = l.used === null ? 'usage not reported' : `${l.used.toLocaleString()} used`;
  const rem = l.remaining === null ? '' : ` · ${l.remaining.toLocaleString()} remaining`;
  const reset = l.resetAt ? ` · resets ${new Date(l.resetAt).toLocaleString()}` : '';
  return `${used} of ${cap}${rem}${reset}`;
}

function FeatureRow({ f }: { f: PlatformFeatureEntitlement }) {
  return (
    <li className="tile p-3.5 space-y-1.5" data-testid={`feature-${f.featureKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{f.displayName}</p>
        <span className="chip">{f.module}</span>
        <span className={`chip ${STATE_TONE[f.state] ?? ''}`}>{f.state.replace(/_/g, ' ').toLowerCase()}</span>
        <span className="chip">{f.minimumPlan ? `minimum ${f.minimumPlan}` : 'minimum plan not finalized'}</span>
      </div>
      <p className="text-xs text-muted-foreground">{f.description}</p>
      <p className="text-xs text-muted-foreground">
        Entitled: {f.entitled ? 'yes' : 'no'} · Configured on: {f.enabled ? 'yes' : 'no'} · Policy approved: {f.policyApproved ? 'yes' : 'no'}
      </p>
      {f.reason && <p className="text-xs">{f.reason}</p>}
      {f.dependencies.length > 0 && <p className="text-xs text-muted-foreground">Depends on: {f.dependencies.join(', ')}</p>}
      {f.limits.length > 0 && (
        <ul className="space-y-0.5">
          {f.limits.map((l) => (
            <li key={l.key} className="font-mono text-[11px] text-muted-foreground">
              {l.key}: {limitText(l)}
              {l.overLimit && <span className="chip chip-bad ml-2">over limit</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">If downgraded: {f.downgradeBehavior}</p>
    </li>
  );
}

function AssignForm({ guildId, view }: { guildId: string; view: PlatformEntitlementView }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { request } = useCsrf();
  const [plan, setPlan] = useState<Plan>((PLANS as readonly string[]).includes(view.plan) ? (view.plan as Plan) : 'FREE');
  const [status, setStatus] = useState<Status>((STATUSES as readonly string[]).includes(view.status) ? (view.status as Status) : 'ACTIVE');
  const [expiry, setExpiry] = useState(view.assignment?.expiresAt ? view.assignment.expiresAt.slice(0, 10) : '');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const baseRev = useRef(view.assignment?.revision ?? 0);
  const liveRev = view.assignment?.revision ?? 0;
  const stale = liveRev !== baseRev.current;
  const save = useAssignPlatformPlan({
    request,
    mutation: {
      onSuccess: (updated) => {
        baseRev.current = updated.assignment?.revision ?? 0;
        qc.setQueryData(getGetPlatformEntitlementsQueryKey(guildId), updated);
        setPlan(updated.plan as Plan); setStatus(updated.status as Status);
        setExpiry(updated.assignment?.expiresAt ? updated.assignment.expiresAt.slice(0, 10) : '');
        qc.invalidateQueries({ queryKey: getGetPlatformModulesQueryKey(guildId) });
        qc.invalidateQueries({ queryKey: getGetPlatformOverviewQueryKey(guildId) });
        setReason(''); setConfirmed(false); setConflict(null);
        toast({ title: 'Plan assignment saved', description: 'Modules and policy were not changed.' });
      },
      onError: (e) => {
        const m = errMsg(e);
        setConflict(m);
        qc.invalidateQueries({ queryKey: getGetPlatformEntitlementsQueryKey(guildId) });
        toast({ title: 'Assignment not saved', description: m, variant: 'destructive' });
      },
    },
  });
  const ok = reason.trim().length > 0 && confirmed && !save.isPending && !stale && !conflict;
  const sel = 'min-h-[44px] w-full rounded-xl border border-white/10 bg-[rgba(8,17,31,.65)] px-3 text-sm';
  return (
    <form className="space-y-3" data-testid="form-assign-plan" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      save.mutate({ guildId, data: { plan, status, expiresAt: expiry ? new Date(`${expiry}T23:59:59Z`).toISOString() : null, reason: reason.trim(), revision: baseRev.current } });
    }}>
      {(stale || conflict) && (
        <div className="notice notice-warn space-y-2" data-testid="notice-revision-conflict">
          <p>{stale ? `The assignment changed elsewhere (revision ${liveRev}; your form is based on ${baseRev.current}). Reload the latest values before saving.` : conflict}</p>
          <Button type="button" size="sm" variant="outline" data-testid="button-reload-assignment" onClick={() => {
            baseRev.current = liveRev;
            setPlan((PLANS as readonly string[]).includes(view.plan) ? (view.plan as Plan) : 'FREE');
            setStatus((STATUSES as readonly string[]).includes(view.status) ? (view.status as Status) : 'ACTIVE');
            setExpiry(view.assignment?.expiresAt ? view.assignment.expiresAt.slice(0, 10) : '');
            setReason(''); setConfirmed(false);
            setConflict(null);
          }}>Reload latest</Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">Plan
          <select className={sel} value={plan} onChange={(e) => setPlan(e.target.value as Plan)} data-testid="select-plan">{PLANS.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="space-y-1 text-sm">Status
          <select className={sel} value={status} onChange={(e) => setStatus(e.target.value as Status)} data-testid="select-status">{STATUSES.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="space-y-1 text-sm">Expires (optional)
          <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} data-testid="input-expiry" /></label>
      </div>
      <label className="block space-y-1 text-sm">Reason (required)
        <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-reason" /></label>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} data-testid="checkbox-confirm-assign" />
        <span>I confirm this is a manual assignment record. It does not activate modules or approve policy.</span>
      </label>
      <Button type="submit" disabled={!ok || stale} data-testid="button-assign-plan">{save.isPending ? 'Saving' : 'Save assignment'}</Button>
    </form>
  );
}

export function EntitlementsPanel({ guildId }: { guildId: string }) {
  const q = useGetPlatformEntitlements(guildId, { query: { queryKey: getGetPlatformEntitlementsQueryKey(guildId), refetchInterval: 20000 } });
  const v = q.data;
  return (
    <section className="panel" data-testid="panel-entitlements">
      <div className="panel-head">
        <div>
          <h2 className="font-display text-xl font-bold">Plans and entitlements</h2>
          <p className="text-xs text-muted-foreground">Saved plan records, shown separately from what the live runtime can do.</p>
        </div>
      </div>
      <div className="p-4 space-y-4">
        {q.isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
        {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} />}
        {v && (
          <>
            <div className="notice notice-info" data-testid="notice-billing">
              Billing is not currently enabled and plans are still being finalized. There is no checkout or upgrade here. Production access is preserved: a plan assignment never activates modules or approves policy.
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              {[['Current plan', v.plan], ['Effective plan', v.effectivePlan], ['Status', v.status], ['Policy mode', v.policyMode.replace('_', ' ').toLowerCase()]].map(([k, val]) => (
                <div key={k} className="tile p-3"><dt className="eyebrow">{k}</dt><dd className="mt-1" data-testid={`text-${k.toLowerCase().replace(' ', '-')}`}>{val}</dd></div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground" data-testid="text-assignment">
              {v.assignment ? `Assignment source ${v.assignment.source}, assigned ${new Date(v.assignment.assignedAt).toLocaleString()}, expires ${v.assignment.expiresAt ? new Date(v.assignment.expiresAt).toLocaleString() : 'never'}, revision ${v.assignment.revision}.` : 'No manual assignment recorded.'}
            </p>
            {([['Included', (f: PlatformFeatureEntitlement) => f.state !== 'LOCKED_BY_PLAN' && f.state !== 'UNSUPPORTED'],
              ['Locked by plan', (f: PlatformFeatureEntitlement) => f.state === 'LOCKED_BY_PLAN'],
              ['Unsupported', (f: PlatformFeatureEntitlement) => f.state === 'UNSUPPORTED']] as const).map(([label, fn]) => {
              const list = v.features.filter(fn);
              return (
                <div key={label} data-testid={`group-${label.toLowerCase().replace(/ /g, '-')}`}>
                  <p className="eyebrow mb-2">{label} ({list.length})</p>
                  {list.length === 0 ? <p className="text-sm text-muted-foreground">None reported.</p> : <ul className="space-y-2">{list.map((f) => <FeatureRow key={f.featureKey} f={f} />)}</ul>}
                </div>
              );
            })}
            <div className="border-t border-white/10 pt-4" data-testid="section-assign">
              <p className="eyebrow mb-2">Manual assignment</p>
              {v.canAssign
                ? <AssignForm key={guildId} guildId={guildId} view={v} />
                : <p className="notice notice-info" data-testid="text-assign-readonly">Read only. Manual plan changes are restricted to configured application owners in local allowlisted test guilds.</p>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
