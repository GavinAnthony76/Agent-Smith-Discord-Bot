import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getGetPlatformCollectionQueryKey,
  getGetPlatformModulesQueryKey,
  getGetPlatformOverviewQueryKey,
  useCreatePlatformRecord,
  useDeletePlatformRecord,
  useGetPlatformCollection,
  usePerformPlatformAction,
  useUpdatePlatformModule,
  useUpdatePlatformRecord,
  type PlatformModule,
  type PlatformRecord,
  type PlatformResources,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { EmptyState, ErrorState, RuntimeBadge } from '@/components/shell';
import { FieldForm } from '@/components/fields';
import { AchievementBadge, ConsoleEvent, FrameworkBadge, LevelBadge, MemberRow } from '@/components/smith-ui';
import { MODULE_LABELS, RECORD_ACTIONS, errMsg, useCsrf } from '@/lib/platform';

function ModuleForm({ guildId, mod, resources }: { guildId: string; mod: PlatformModule; resources?: PlatformResources }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { request } = useCsrf();
  const [enabled, setEnabled] = useState(mod.enabled);
  const [config, setConfig] = useState<Record<string, unknown>>({ ...mod.configuration });
  const dirty = enabled !== mod.enabled || JSON.stringify(config) !== JSON.stringify(mod.configuration);
  const publish = usePerformPlatformAction({ request, mutation: {
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: getGetPlatformOverviewQueryKey(guildId) });
      toast({ title: 'Onboarding entry published', description: result.message });
    },
    onError: (e) => toast({ title: 'Entry not published', description: errMsg(e), variant: 'destructive' }),
  } });
  const save = useUpdatePlatformModule({
    request,
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPlatformModulesQueryKey(guildId) });
        qc.invalidateQueries({ queryKey: getGetPlatformOverviewQueryKey(guildId) });
        toast({ title: `${MODULE_LABELS[mod.moduleKey] ?? mod.moduleKey} saved` });
      },
      onError: (e) => toast({ title: 'Save failed', description: errMsg(e), variant: 'destructive' }),
    },
  });
  const ro = !mod.editable;
  const locked = mod.entitlement?.state === 'LOCKED_BY_PLAN';
  return (
    <section className="panel" data-testid={`panel-module-${mod.moduleKey}`}>
      <div className="panel-head">
        <div>
          <h2 className="font-display text-xl font-bold">{MODULE_LABELS[mod.moduleKey] ?? mod.moduleKey} configuration</h2>
          <p className="font-mono text-xs text-muted-foreground">revision {mod.revision}</p>
        </div>
        <RuntimeBadge status={mod.runtimeStatus} />
        <label className="ml-auto flex items-center gap-2 text-sm">
          Module enabled
          <Switch checked={enabled} disabled={ro || !!locked && !enabled} onCheckedChange={setEnabled} data-testid="switch-module-enabled" />
        </label>
      </div>
      {locked && <div className="notice notice-warn m-4" data-testid="notice-module-plan-locked">
        {mod.entitlement?.reason ?? 'This feature is not enabled for this community.'} Configuration is preserved.
        Billing is not currently enabled. Plans are currently being finalized.
      </div>}
      <div className="p-4 space-y-4">
        {ro && <p className="notice notice-info" data-testid="text-read-only">Read only. Your role or this server's policy does not allow editing this module.</p>}
        {mod.fields.length === 0
          ? <EmptyState title="No configurable fields" body="This module exposes no settings yet. Its status above shows what the runtime currently does." />
          : <FieldForm fields={mod.fields} values={config} onChange={setConfig} resources={resources} disabled={ro || !!locked} />}
      </div>
      {!ro && (
        <div className="flex justify-end gap-2 border-t border-white/10 p-4">
          {mod.moduleKey === 'onboarding' && mod.runtimeStatus === 'Platform runtime' && <Button variant="outline"
            disabled={dirty || !mod.enabled || publish.isPending || !!locked} data-testid="button-publish-onboarding"
            onClick={() => publish.mutate({ guildId, data: { action: 'onboarding-publish', target: 'onboarding' } })}>
            {publish.isPending ? 'Publishing' : 'Publish start / resume button'}
          </Button>}
          <Button variant="ghost" disabled={!dirty} onClick={() => { setEnabled(mod.enabled); setConfig({ ...mod.configuration }); }} data-testid="button-reset-module">Discard</Button>
          <Button disabled={!dirty || save.isPending || !!locked && enabled} data-testid="button-save-module"
            onClick={() => save.mutate({ guildId, moduleKey: mod.moduleKey, data: { enabled, configuration: config, revision: mod.revision } })}>
            {save.isPending ? 'Saving' : 'Save changes'}
          </Button>
        </div>
      )}
    </section>
  );
}

export function ModulePanel({ guildId, mod, resources }: { guildId: string; mod: PlatformModule; resources?: PlatformResources }) {
  return <ModuleForm key={`${mod.moduleKey}-${mod.revision}`} guildId={guildId} mod={mod} resources={resources} />;
}

function summarize(data: Record<string, unknown>) {
  return Object.entries(data).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object').slice(0, 5);
}


type RecData = Record<string, unknown>;
const has = (v: unknown) => v !== undefined && v !== null && v !== '';
function pick(d: RecData, keys: string[]) { for (const k of keys) if (has(d[k]) && typeof d[k] !== 'object') return [k, d[k]] as const; return undefined; }
function rest(d: RecData, used: string[]) { return Object.entries(d).filter(([k, v]) => !used.includes(k) && has(v) && typeof v !== 'object').slice(0, 5); }
function Kv({ items }: { items: [string, unknown][] }) {
  return <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">{items.map(([k, v]) => <span key={k}><span className="font-mono">{k}</span> {String(v)}</span>)}</p>;
}
function Meta({ r }: { r: PlatformRecord }) {
  return <p className="mt-1 font-mono text-[11px] text-muted-foreground">rev {r.revision}{r.createdAt ? ` · ${new Date(r.createdAt).toLocaleString()}` : ''}</p>;
}
function Title({ r }: { r: PlatformRecord }) { return <p className="truncate font-medium" data-testid={`text-title-${r.id}`}>{r.title}</p>; }

function RecordBody({ collection, r }: { collection: string; r: PlatformRecord }) {
  const d = r.data as RecData;
  if (collection === 'profiles' || collection === 'leaderboard') {
    const fw = pick(d, ['framework', 'primaryFramework']); const lv = pick(d, ['level', 'currentLevel']); const xp = pick(d, ['xp', 'totalXp', 'experience']);
    const st = pick(d, ['status']); const used = ['framework', 'primaryFramework', 'level', 'currentLevel', 'xp', 'totalXp', 'experience', 'status'];
    return (
      <MemberRow title={r.title}>
        <Title r={r} />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {fw && <FrameworkBadge name={String(fw[1])} />}
          {(lv || xp) && <LevelBadge level={lv?.[1]} xp={xp?.[1]} />}
          {st && <span className="chip">{String(st[1])}</span>}
        </div>
        <Kv items={rest(d, used)} /><Meta r={r} />
      </MemberRow>
    );
  }
  if (collection === 'achievements' || collection === 'rewards') {
    const flag = pick(d, ['unlocked', 'earned', 'enabled', 'active']);
    const state = flag ? (flag[1] === true || flag[1] === 'true' ? 'on' : 'off') : 'unknown';
    const when = pick(d, ['unlockedAt', 'earnedAt']);
    return (
      <AchievementBadge title={r.title} state={state}>
        <span className="sr-only" data-testid={`text-title-${r.id}`}>{r.title}</span>
        {flag && <span className="chip mt-1">{['enabled', 'active'].includes(flag[0]) ? 'Definition' : 'Member award'} · {flag[0]}: {String(flag[1])}</span>}
        {when && <p className="text-xs text-muted-foreground">Unlocked {String(when[1])}</p>}
        <Kv items={rest(d, ['unlocked', 'earned', 'enabled', 'active', 'unlockedAt', 'earnedAt'])} /><Meta r={r} />
      </AchievementBadge>
    );
  }
  if (collection === 'shop' || collection === 'inventory' || collection === 'economy') {
    const price = pick(d, ['price', 'cost', 'amount', 'balance']); const stock = pick(d, ['stock', 'quantity']);
    return (
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1"><Title r={r} /><Kv items={rest(d, ['price', 'cost', 'amount', 'balance', 'stock', 'quantity'])} /><Meta r={r} /></div>
        <div className="flex flex-col items-end gap-1">
          {price && <span className="chip chip-info">{String(price[0])} {String(price[1])}</span>}
          {stock && <span className="chip">{String(stock[0])} {String(stock[1])}</span>}
        </div>
      </div>
    );
  }
  if (collection === 'cases' || collection === 'reports') {
    const st = pick(d, ['status', 'state']); const kind = pick(d, ['type', 'action', 'severity', 'reason']);
    const closed = st && /closed|resolved|done/i.test(String(st[1]));
    return (
      <ConsoleEvent title={r.title} time={r.createdAt ? new Date(r.createdAt).toLocaleString() : null}
        meta={<>{st && <span className={`chip ${closed ? 'chip-live' : 'chip-warn'}`}>{String(st[1])}</span>}{kind && <span className="chip">{String(kind[0])} {String(kind[1])}</span>}</>}>
        <span className="sr-only" data-testid={`text-title-${r.id}`}>{r.title}</span>
        <Kv items={rest(d, ['status', 'state', 'type', 'action', 'severity', 'reason'])} /><p className="font-mono text-[11px] text-muted-foreground">rev {r.revision}</p>
      </ConsoleEvent>
    );
  }
  if (collection === 'audit') {
    return (
      <ConsoleEvent title={r.title} time={r.createdAt ? new Date(r.createdAt).toLocaleString() : null}>
        <span className="sr-only" data-testid={`text-title-${r.id}`}>{r.title}</span><Kv items={rest(d, [])} />
      </ConsoleEvent>
    );
  }
  return <><Title r={r} /><Kv items={summarize(d)} /><Meta r={r} /></>;
}

export function CollectionPanel({ guildId, collection, label, resources }: { guildId: string; collection: string; label: string; resources?: PlatformResources }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { request } = useCsrf();
  const q = useGetPlatformCollection(guildId, collection);
  const [editing, setEditing] = useState<PlatformRecord | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [del, setDel] = useState<PlatformRecord | null>(null);
  const [act, setAct] = useState<{ rec: PlatformRecord; action: string; label: string; closes?: boolean } | null>(null);
  const [note, setNote] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetPlatformCollectionQueryKey(guildId, collection) });
    qc.invalidateQueries({ queryKey: getGetPlatformOverviewQueryKey(guildId) });
  };
  const onError = (e: unknown) => toast({ title: 'Action failed', description: errMsg(e), variant: 'destructive' });
  const create = useCreatePlatformRecord({ request, mutation: { onSuccess: () => { refresh(); setEditing(null); toast({ title: 'Record created' }); }, onError } });
  const update = useUpdatePlatformRecord({ request, mutation: { onSuccess: () => { refresh(); setEditing(null); toast({ title: 'Record updated' }); }, onError } });
  const remove = useDeletePlatformRecord({ request, mutation: { onSuccess: () => { refresh(); setDel(null); toast({ title: 'Record deleted' }); }, onError } });
  const perform = usePerformPlatformAction({ request, mutation: { onSuccess: () => { refresh(); setAct(null); setNote(''); toast({ title: 'Action recorded' }); }, onError } });

  const c = q.data;
  const openEdit = (r: PlatformRecord | 'new') => {
    setEditing(r);
    setTitle(r === 'new' ? '' : r.title);
    setData(r === 'new' ? {} : { ...r.data });
  };
  const submit = () => {
    if (!title.trim()) return;
    if (editing === 'new') create.mutate({ guildId, collection, data: { title: title.trim(), data } });
    else if (editing) update.mutate({ guildId, collection, recordId: editing.id, data: { title: title.trim(), data, revision: editing.revision } });
  };
  const actions = RECORD_ACTIONS[collection] ?? [];

  return (
    <section className="panel" data-testid={`panel-collection-${collection}`}>
      <div className="panel-head">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold">{label}</h2>
          {c && <p className="text-xs text-muted-foreground">{c.description}</p>}
        </div>
        {c?.editable && <Button size="sm" className="ml-auto" onClick={() => openEdit('new')} data-testid={`button-new-${collection}`}><Plus className="h-4 w-4 mr-1" />New</Button>}
        {c && !c.editable && <Badge variant="outline" className="ml-auto">Read only</Badge>}
      </div>
      <div className="p-4">
        {q.isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
        {q.isError && <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} />}
        {c && c.records.length === 0 && <EmptyState title={`No ${label.toLowerCase()} yet`} body={c.editable ? 'Create the first record with the New button.' : 'Nothing has been recorded for this server so far.'} />}
        {c && c.records.length > 0 && (
          <ul className="space-y-2">
            {c.records.map((r) => (
              <li key={r.id} className="tile tile-hover group flex flex-wrap items-start gap-3 p-3.5" data-testid={`row-${collection}-${r.id}`}>
                <div className="min-w-0 flex-1"><RecordBody collection={collection} r={r} /></div>
                <div className="flex flex-wrap gap-1">
                  {actions.map((a) => <Button key={a.action} size="sm" variant="outline" onClick={() => setAct({ rec: r, ...a })} data-testid={`button-${a.action}-${r.id}`}>{a.label}</Button>)}
                  {c.editable && <Button size="icon" variant="ghost" onClick={() => openEdit(r)} data-testid={`button-edit-${r.id}`}><Pencil className="h-4 w-4" /></Button>}
                  {c.editable && <Button size="icon" variant="ghost" onClick={() => setDel(r)} data-testid={`button-delete-${r.id}`}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing === 'new' ? `New ${label} record` : 'Edit record'}</DialogTitle><DialogDescription>Fields come from the server definition for this collection.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><label className="text-sm font-medium">Title</label><Input maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-record-title" /></div>
            <FieldForm fields={c?.fields ?? []} values={data} onChange={setData} resources={resources} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={submit} disabled={!title.trim() || create.isPending || update.isPending} data-testid="button-save-record">{create.isPending || update.isPending ? 'Saving' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this record?</AlertDialogTitle><AlertDialogDescription>"{del?.title}" will be removed permanently. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete" onClick={(e) => { e.preventDefault(); if (del) remove.mutate({ guildId, collection, recordId: del.id }); }}>{remove.isPending ? 'Deleting' : 'Delete'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!act} onOpenChange={(o) => { if (!o) { setAct(null); setNote(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{act?.label}</DialogTitle><DialogDescription>{act?.rec.title}{act?.closes ? ' This will be recorded as confirmed.' : ''}</DialogDescription></DialogHeader>
          <Textarea rows={3} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-action-note" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAct(null)}>Cancel</Button>
            <Button data-testid="button-confirm-action" disabled={perform.isPending}
              onClick={() => act && perform.mutate({ guildId, data: { action: act.action, target: act.rec.id, note: note.trim() || undefined, confirmed: act.closes ? true : undefined } })}>
              {perform.isPending ? 'Working' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
