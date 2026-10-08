import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { PlatformChoice, PlatformField, PlatformResources } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STEP_TYPES = ['MESSAGE', 'RULES_ACCEPTANCE', 'ROLE_SELECT', 'QUESTION', 'BUTTON', 'FINALIZATION'];
const NONE = '__none__';

type Step = { type: string; title: string; content: string };

function ChoiceSelect({ choices, value, onChange, disabled, prefix, id }: { choices: PlatformChoice[]; value: string; onChange: (v: string) => void; disabled?: boolean; prefix: string; id: string }) {
  if (!choices.length) {
    return <Input data-testid={`input-${id}`} disabled={disabled} value={value} placeholder={`${prefix} ID (live list unavailable)`} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={disabled}>
      <SelectTrigger data-testid={`select-${id}`}><SelectValue placeholder="Not set" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Not set</SelectItem>
        {choices.map((c) => (
          <SelectItem key={c.id} value={c.id}>{prefix === 'Channel' ? '#' : '@'}{c.name}{c.protected ? ' (protected)' : ''}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiChoice({ choices, value, onChange, disabled, prefix, id }: { choices: PlatformChoice[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; prefix: string; id: string }) {
  if (!choices.length) {
    return <Input data-testid={`input-${id}`} disabled={disabled} value={value.join(', ')} placeholder="Comma separated IDs (live list unavailable)" onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />;
  }
  const toggle = (cid: string) => onChange(value.includes(cid) ? value.filter((v) => v !== cid) : [...value, cid]);
  return (
    <div className="max-h-44 overflow-y-auto rounded-md border bg-background p-2 flex flex-wrap gap-1.5" data-testid={`multi-${id}`}>
      {choices.map((c) => {
        const on = value.includes(c.id);
        return (
          <button key={c.id} type="button" disabled={disabled} onClick={() => toggle(c.id)} data-testid={`chip-${id}-${c.id}`}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'} disabled:opacity-50`}>
            {prefix === 'Channel' ? '#' : '@'}{c.name}
            {c.protected ? ' · protected' : ''}{c.rewardable ? ' · rewardable' : ''}
          </button>
        );
      })}
    </div>
  );
}

export function StepsEditor({ value, onChange, disabled }: { value: Step[]; onChange: (v: Step[]) => void; disabled?: boolean }) {
  const [add, setAdd] = useState('MESSAGE');
  const upd = (i: number, p: Partial<Step>) => onChange(value.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => {
    const n = [...value];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <div className="space-y-2" data-testid="steps-editor">
      {value.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No steps yet. Add the first step below.</p>}
      {value.map((s, i) => (
        <div key={i} className="rounded-md border bg-background p-3 space-y-2" data-testid={`step-${i}`}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground w-5">{i + 1}</span>
            <Select value={s.type} onValueChange={(v) => upd(i, { type: v })} disabled={disabled}>
              <SelectTrigger className="h-8 w-48 font-mono text-xs" data-testid={`select-step-type-${i}`}><SelectValue /></SelectTrigger>
              <SelectContent>{STEP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <div className="ml-auto flex gap-1">
              <Button size="icon" variant="ghost" disabled={disabled || i === 0} onClick={() => move(i, -1)} data-testid={`button-step-up-${i}`}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)} data-testid={`button-step-down-${i}`}><ArrowDown className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))} data-testid={`button-step-remove-${i}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          <Input disabled={disabled} placeholder="Title" value={s.title} onChange={(e) => upd(i, { title: e.target.value })} data-testid={`input-step-title-${i}`} />
          <Textarea disabled={disabled} placeholder="Content" rows={2} value={s.content} onChange={(e) => upd(i, { content: e.target.value })} data-testid={`input-step-content-${i}`} />
        </div>
      ))}
      {!disabled && (
        <div className="flex gap-2">
          <Select value={add} onValueChange={setAdd}>
            <SelectTrigger className="w-52 font-mono text-xs" data-testid="select-new-step-type"><SelectValue /></SelectTrigger>
            <SelectContent>{STEP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={() => onChange([...value, { type: add, title: '', content: '' }])} data-testid="button-add-step"><Plus className="h-4 w-4 mr-1" />Add step</Button>
        </div>
      )}
    </div>
  );
}

function JsonField({ value, onChange, disabled, id }: { value: unknown; onChange: (v: unknown) => void; disabled?: boolean; id: string }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [err, setErr] = useState('');
  return (
    <div>
      <Textarea className="font-mono text-xs" rows={6} disabled={disabled} value={text} data-testid={`input-${id}`}
        onChange={(e) => {
          setText(e.target.value);
          try { onChange(JSON.parse(e.target.value)); setErr(''); } catch { setErr('Invalid JSON, not applied yet'); }
        }} />
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}

export function FieldInput({ field, value, onChange, resources, disabled }: { field: PlatformField; value: unknown; onChange: (v: unknown) => void; resources?: PlatformResources; disabled?: boolean }) {
  const id = field.key;
  const channels = resources?.channels ?? [];
  const roles = resources?.roles ?? [];
  switch (field.type) {
    case 'boolean':
      return <Switch checked={!!value} disabled={disabled} onCheckedChange={onChange} data-testid={`switch-${id}`} />;
    case 'number':
      return <Input type="number" disabled={disabled} min={field.min} max={field.max} value={value === undefined || value === null ? '' : String(value)} data-testid={`input-${id}`}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'text':
      return <Input disabled={disabled} value={typeof value === 'string' ? value : value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value)} data-testid={`input-${id}`} />;
    case 'channel':
      return <ChoiceSelect id={id} prefix="Channel" choices={channels} value={String(value ?? '')} onChange={onChange} disabled={disabled} />;
    case 'role':
      return <ChoiceSelect id={id} prefix="Role" choices={roles} value={String(value ?? '')} onChange={onChange} disabled={disabled} />;
    case 'channels':
      return <MultiChoice id={id} prefix="Channel" choices={channels} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} disabled={disabled} />;
    case 'roles':
      return <MultiChoice id={id} prefix="Role" choices={roles} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} disabled={disabled} />;
    case 'select':
      return (
        <Select value={value == null || value === '' ? undefined : String(value)} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger data-testid={`select-${id}`}><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>{(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    case 'steps':
      return <StepsEditor value={Array.isArray(value) ? (value as Step[]) : []} onChange={onChange} disabled={disabled} />;
    default:
      return <JsonField id={id} value={value} onChange={onChange} disabled={disabled} />;
  }
}

export function FieldForm({ fields, values, onChange, resources, disabled }: { fields: PlatformField[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; resources?: PlatformResources; disabled?: boolean }) {
  return (
    <div className="space-y-5">
      {fields.map((f) => {
        const inline = f.type === 'boolean';
        return (
          <div key={f.key} className={inline ? 'flex items-start justify-between gap-4' : 'space-y-1.5'} data-testid={`field-${f.key}`}>
            <div className="min-w-0">
              <Label className="text-sm font-medium">{f.label}
                {(f.min !== undefined || f.max !== undefined) && <Badge variant="outline" className="ml-2 font-mono text-[10px]">{f.min ?? ''}..{f.max ?? ''}</Badge>}
              </Label>
              {f.description && <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>}
            </div>
            <FieldInput field={f} value={values[f.key]} resources={resources} disabled={disabled} onChange={(v) => onChange({ ...values, [f.key]: v })} />
          </div>
        );
      })}
    </div>
  );
}
