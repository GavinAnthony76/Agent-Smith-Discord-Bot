import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, Boxes, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PAGES, MODULE_LABELS } from '@/lib/platform';
import { RuntimeBadge } from '@/components/shell';
import { MODULE_ICONS } from '@/components/module-icons';

const GLOW: Record<string, string> = { ai: 'rgba(124,58,237,.22)', economy: 'rgba(217,70,239,.14)', rewards: 'rgba(217,70,239,.14)', achievements: 'rgba(139,92,246,.2)' };

export function MetricCard({ label, value, reason, testId }: { label: string; value: number | null; reason?: string | null; testId: string }) {
  return (
    <div className="panel p-4" data-testid={testId}>
      <p className="eyebrow">{label}</p>
      {value === null
        ? <><p className="mt-1.5 font-display text-xl text-muted-foreground">Unavailable</p><p className="text-xs text-muted-foreground">{reason ?? 'No data source reported.'}</p></>
        : <p className="mt-1 font-display text-4xl font-bold tracking-tight">{value.toLocaleString()}</p>}
    </div>
  );
}

export function ModuleCard({ guildId, moduleKey, enabled, runtimeStatus, entitlement }: { guildId: string; moduleKey: string; enabled: boolean; runtimeStatus: string; entitlement?: { state: string; minimumPlan: string | null } }) {
  const Icon = MODULE_ICONS[moduleKey] ?? Boxes;
  return (
    <li className="mod-card panel flex flex-col gap-3 p-4" data-on={enabled} data-testid={`module-row-${moduleKey}`}
      style={{ ['--mod-glow' as string]: GLOW[moduleKey] }}>
      <div className="relative z-10 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5"><Icon className="h-5 w-5 text-cyan-300" /></span>
        <div className="min-w-0 flex-1">
          <Link href={`/dashboard/${guildId}/${moduleKey}`} className="font-display text-base font-bold hover:underline">{MODULE_LABELS[moduleKey] ?? moduleKey}</Link>
          <p className="text-xs text-muted-foreground">{PAGES[moduleKey]?.blurb ?? 'No description available.'}</p>
        </div>
      </div>
      <div className="relative z-10 flex flex-wrap items-center gap-1.5">
        <span className={`chip ${enabled ? 'chip-info' : ''}`}>{enabled ? 'Configured on' : 'Configured off'}</span>
        <RuntimeBadge status={runtimeStatus} />
        {entitlement && <span className={`chip ${entitlement.state === 'LOCKED_BY_PLAN' ? 'chip-warn' : ''}`}>
          {entitlement.state.replace(/_/g, ' ').toLowerCase()}{entitlement.minimumPlan ? ` · ${entitlement.minimumPlan}` : ''}
        </span>}
      </div>
      <div className="relative z-10 mt-auto flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Last event: unavailable</span>
        <Button asChild size="sm" variant="outline"><Link href={`/dashboard/${guildId}/${moduleKey}`}>Open<ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
      </div>
    </li>
  );
}

export function FrameworkBadge({ name }: { name: string }) {
  const n = name.toLowerCase();
  const tone = n.includes('faith') ? 'border-amber-300/40 text-amber-200 bg-amber-300/10'
    : n.includes('gam') ? 'border-cyan-300/40 text-cyan-200 bg-cyan-300/10'
    : n.includes('tech') ? 'border-fuchsia-400/40 text-fuchsia-200 bg-violet-500/15' : 'border-white/15 text-slate-300 bg-white/5';
  return <span className={`chip uppercase ${tone}`}>{name}</span>;
}

export function LevelBadge({ level, xp }: { level?: unknown; xp?: unknown }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-0.5 font-mono text-[11px] text-cyan-100">
      {level != null && <span>LEVEL {String(level)}</span>}
      {xp != null && <span className="text-cyan-200/70">{Number(xp).toLocaleString?.() ?? String(xp)} XP</span>}
    </span>
  );
}

export function ConsoleEvent({ title, time, meta, children }: { title: string; time?: string | null; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(0,223,255,.6)]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className="font-medium">{title}</p>{time && <span className="font-mono text-[11px] text-muted-foreground">{time}</span>}</div>
        {meta && <div className="mt-0.5 flex flex-wrap gap-1.5">{meta}</div>}
        {children}
      </div>
    </div>
  );
}

export function AchievementBadge({ title, state, children }: { title: string; state: 'on' | 'off' | 'unknown'; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="badge-medal grid h-12 w-12 shrink-0 place-items-center rounded-2xl" data-state={state}><Trophy className={`h-5 w-5 ${state === 'off' ? 'text-slate-400' : 'text-cyan-300'}`} /></span>
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{title}</p>{children}</div>
    </div>
  );
}

export function MemberRow({ title, children }: { title: string; children?: ReactNode }) {
  const ini = title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-violet-400/40 bg-gradient-to-br from-cyan-400/20 to-violet-500/25 font-mono text-sm">{ini}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
