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
import { MODULE_LABELS, RECORD_ACTIONS, errMsg, useCsrf } from '@/lib/platform';

function ModuleForm({ guildId, mod, resources }: { guildId: string; mod: PlatformModule; resources?: PlatformResources }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { request } = useCsrf();
  const [enabled, setEnabled] = useState(mod.enabled);
  const [config, setConfig] = useState<Record<string, unknown>>({ ...mod.configuration });
  const dirty = enabled !== mod.enabled || JSON.stringify(config) !== JSON.stringify(mod.configuration);
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
  return (
    <section className="rounded-xl border bg-card" data-testid={`panel-module-${mod.moduleKey}`}>
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <div>
          <h2 className="font-display text-xl font-bold">{MODULE_LABELS[mod.moduleKey] ?? mod.moduleKey} configuration</h2>
          <p className="font-mono text-xs text-muted-foreground">revision {mod.revision}</p>
        </div>
        <RuntimeBadge status={mod.runtimeStatus} />
        <label className="ml-auto flex items-center gap-2 text-sm">
          Module enabled
          <Switch checked={enabled} disabled={ro} onCheckedChange={setEnabled} data-testid="switch-module-enabled" />
        </label>
      </div>
      <div className="p-4 space-y-4">
        {ro && <p className="rounded-md bg-muted p-3 text-sm" data-testid="text-read-only">Read only. Your role or this server's policy does not allow editing this module.</p>}
        {mod.fields.length === 0
          ? <EmptyState title="No configurable fields" body="This module exposes no settings yet. Its status above shows what the runtime currently does." />
          : <FieldForm fields={mod.fields} values={config} onChange={setConfig} resources={resources} disabled={ro} />}
      </div>
      {!ro && (
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="ghost" disabled={!dirty} onClick={() => { setEnabled(mod.enabled); setConfig({ ...mod.configuration }); }} data-testid="button-reset-module">Discard</Button>
          <Button disabled={!dirty || save.isPending} data-testid="button-save-module"
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
    <section className="rounded-xl border bg-card" data-testid={`panel-collection-${collection}`}>
      <div className="flex items-center gap-3 border-b p-4">
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
          <ul className="divide-y rounded-md border">
            {c.records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 p-3" data-testid={`row-${collection}-${r.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate" data-testid={`text-title-${r.id}`}>{r.title}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {summarize(r.data).map(([k, v]) => <span key={k}><span className="font-mono">{k}</span> {String(v)}</span>)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">rev {r.revision}{r.createdAt ? ` · ${new Date(r.createdAt).toLocaleString()}` : ''}</p>
                </div>
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
