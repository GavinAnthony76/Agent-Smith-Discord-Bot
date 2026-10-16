import { Activity, RefreshCw } from 'lucide-react';
import { getGetPlatformSystemStatusQueryKey, useGetPlatformSystemStatus } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shell';
import { errMsg } from '@/lib/platform';

const TONE: Record<string, string> = {
  HEALTHY: 'chip-live', DEGRADED: 'chip-warn', ERROR: 'chip-warn', DISABLED: '', UNKNOWN: '',
};
const DOT: Record<string, string> = {
  HEALTHY: 'bg-emerald-400', DEGRADED: 'bg-amber-400', ERROR: 'bg-red-500', DISABLED: 'bg-slate-500', UNKNOWN: 'bg-slate-600',
};

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString() : 'Not observed');

/** Observed health only — statuses come from live checks reported by the API, never configuration flags. */
export function SystemHealthPanel({ guildId, poll = false }: { guildId: string; poll?: boolean }) {
  const q = useGetPlatformSystemStatus(guildId, {
    query: {
      queryKey: getGetPlatformSystemStatusQueryKey(guildId),
      enabled: !!guildId,
      // Paused automatically while the tab is hidden (refetchIntervalInBackground defaults to false).
      refetchInterval: poll ? 30000 : false,
    },
  });
  return (
    <section className="panel" data-testid="panel-system-health">
      <div className="panel-head">
        <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold">Observed health</h2>
          <p className="font-mono text-[11px] text-muted-foreground" data-testid="text-health-checked">
            {q.data ? `checked ${fmt(q.data.checkedAt)} · heartbeat ${fmt(q.data.lastHeartbeat)}` : 'live checks'}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={q.isFetching} onClick={() => q.refetch()} data-testid="button-refresh-health">
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <div className="p-4 space-y-4">
        {q.isLoading && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>}
        {q.isError && <ErrorState message={`Health checks could not be loaded; status is UNKNOWN. ${errMsg(q.error)}`} onRetry={() => q.refetch()} />}
        {q.data && (
          <>
            {q.data.components.length === 0
              ? <p className="text-sm text-muted-foreground">No components reported. Treat status as UNKNOWN.</p>
              : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {q.data.components.map((c) => (
                    <li key={c.key} className="tile p-3" data-testid={`health-${c.key}`}>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[c.status] ?? DOT.UNKNOWN}`} aria-hidden="true" />
                        <span className="truncate text-sm font-medium">{c.label}</span>
                        <span className={`chip ml-auto text-[10px] ${TONE[c.status] ?? ''}`} data-testid={`status-health-${c.key}`}>{c.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{c.detail}</p>
                      {typeof c.durationMs === 'number' && <p className="font-mono text-[10px] text-muted-foreground">{c.durationMs} ms</p>}
                    </li>
                  ))}
                </ul>
              )}
            <div>
              <p className="eyebrow mb-1.5">Recent errors</p>
              {q.data.recentErrors.length === 0
                ? <p className="text-xs text-muted-foreground">None recorded.</p>
                : (
                  <ul className="space-y-1 font-mono text-[11px]">
                    {q.data.recentErrors.map((e) => (
                      <li key={e.referenceId} className="flex flex-wrap gap-x-3 text-muted-foreground" data-testid={`error-${e.referenceId}`}>
                        <span className="text-foreground">{e.referenceId}</span><span>{e.operation}</span><span>stage {e.stage}</span><span>{fmt(e.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
