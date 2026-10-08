import { performance } from 'node:perf_hooks';

/** Fixed labels only: never retain IDs, names, SQL, prompts or error bodies. */
export function createLookupMetrics() {
  const counters = {};
  return {
    async read(kind, operation) {
      const metric = counters[kind] ??= { requests: 0, failures: 0, latencyMs: 0 };
      metric.requests++;
      const start = performance.now();
      try { return await operation(); }
      catch (error) { metric.failures++; throw error; }
      finally { metric.latencyMs += performance.now() - start; }
    },
    snapshot() {
      return Object.fromEntries(Object.entries(counters).map(([kind, metric]) =>
        [kind, { ...metric, latencyMs: Math.round(metric.latencyMs) }]));
    },
  };
}

const sharedKinds = new Set(['roles', 'channels', 'events', 'rewards']);
const changes = [
  'channelCreate', 'channelUpdate', 'channelDelete', 'roleCreate', 'roleUpdate', 'roleDelete',
  'guildMemberUpdate', 'guildMemberRemove', 'guildUpdate', 'guildUnavailable', 'guildAvailable', 'guildDelete',
  'threadCreate', 'threadUpdate', 'threadDelete', 'threadMembersUpdate',
  'guildScheduledEventCreate', 'guildScheduledEventUpdate', 'guildScheduledEventDelete',
];
const connections = ['shardDisconnect', 'shardReconnecting', 'shardResume', 'shardReady', 'invalidated'];

/**
 * Per-guild, conversation-only read budget. No core workflow uses this queue.
 * Fresh batches accept callers ONLY before dispatch, never after a REST read
 * has started. Authorization results have no TTL cache.
 */
export function createConversationLookups({
  client, guild, timeoutMs = 5000, maxActive = 2, maxStarts = 60,
  windowMs = 60000, publicTtlMs = 15000, now = Date.now,
} = {}) {
  const metrics = createLookupMetrics();
  const batches = new Map();
  const publicCache = new Map();
  const listeners = [];
  let epoch = 0, stopped = false, active = 0, windowStart = now(), starts = 0, backoffUntil = 0;
  const counts = { coalesced: 0, cacheHits: 0, rejected: 0, timeouts: 0, invalidations: 0, backoffs: 0 };
  function ready() {
    // Leave global REST headroom for permission audits, reconciliation and
    // moderation. These checks affect conversation reads only.
    const rest = client?.rest;
    const globalBusy = rest?.globalDelay ||
      (rest?.globalReset > now() && rest.globalRemaining < 10);
    // The SDK knows exhausted route buckets before it emits rateLimited
    // (that event occurs only when a later request tries to use the bucket).
    const routeBusy = [...(rest?.handlers?.values?.() ?? [])].some(handler => handler.limited === true);
    return !stopped && !globalBusy && !routeBusy && now() >= backoffUntil &&
      guild.available !== false && (typeof client?.isReady !== 'function' || client.isReady());
  }
  const rateLimited = data => {
    counts.backoffs++;
    const delay = Math.max(Number(data?.retryAfter) || 0, Number(data?.timeToReset) || 0,
      Number(data?.sublimitTimeout) || 0, 1000);
    backoffUntil = Math.max(backoffUntil, now() + Math.min(delay, 300000) + 250);
  };
  client?.rest?.on?.('rateLimited', rateLimited);
  function invalidate() {
    epoch++;
    counts.invalidations++;
    publicCache.clear();
    batches.clear();
  }
  for (const event of changes) {
    const listener = (...args) => {
      if (args.some(value => value?.guild?.id === guild.id || value?.guildId === guild.id || value?.id === guild.id))
        invalidate();
    };
    client?.on?.(event, listener);
    listeners.push([event, listener]);
  }
  for (const event of connections) {
    client?.on?.(event, invalidate);
    listeners.push([event, invalidate]);
  }
  function assertFresh(version) {
    if (!ready() || version !== epoch) throw new Error('Conversation lookup freshness is uncertain.');
  }
  function sharedRead(kind, operation) {
    // Sharing before dispatch means every caller requested freshness before
    // the shared request begins. At most four fixed-key batches exist.
    const existing = batches.get(kind);
    if (existing) { counts.coalesced++; return existing.promise; }
    const batch = {};
    batch.promise = new Promise((resolve, reject) => {
      setImmediate(() => {
        if (batches.get(kind) === batch) batches.delete(kind);
        if (!ready() || batch.epoch !== epoch) {
          reject(new Error('Conversation metadata changed before dispatch.'));
          return;
        }
        metrics.read(kind, operation).then(resolve, reject);
      });
    });
    batch.epoch = epoch;
    batches.set(kind, batch);
    return batch.promise;
  }
  return {
    invalidate, assertFresh,
    get version() { return epoch; },
    snapshot() { return { ...counts, active, cached: publicCache.size, reads: metrics.snapshot() }; },
    async run(build) {
      const time = now();
      if (time - windowStart >= windowMs) { windowStart = time; starts = 0; }
      if (!ready() || active >= maxActive || starts >= maxStarts) {
        counts.rejected++;
        throw new Error('Conversation lookup budget unavailable.');
      }
      active++; starts++;
      const version = epoch, expires = time + timeoutMs;
      let expired = false, timer;
      const outstanding = new Set();
      const check = () => {
        assertFresh(version);
        if (expired || now() >= expires) throw new Error('Conversation lookup deadline exceeded.');
      };
      const track = promise => {
        outstanding.add(promise);
        promise.then(() => outstanding.delete(promise), () => outstanding.delete(promise));
        return promise;
      };
      const scope = {
        version, check,
        async read(kind, operation) {
          check();
          const guardedOperation = () => { check(); return operation(); };
          const result = await track(sharedKinds.has(kind) ?
            sharedRead(kind, guardedOperation) : metrics.read(kind, guardedOperation));
          check();
          return result;
        },
        async publicRewards(operation) {
          check();
          // Only public cosmetic reward titles/prices, never resources, grants,
          // inventories, progression, onboarding or other authorization data.
          const cached = publicCache.get('rewards');
          if (cached && cached.expires > now()) { counts.cacheHits++; return structuredClone(cached.value); }
          const result = await scope.read('rewards', operation);
          const value = { rows: result.rows.slice(0, 100).map(row => ({
            title: String(row.title ?? '').slice(0, 100), price: row.price,
          })) };
          check();
          publicCache.set('rewards', { expires: now() + Math.min(publicTtlMs, 30000), value });
          return structuredClone(value);
        },
      };
      const work = Promise.resolve().then(() => build(scope)).then(result => { check(); return result; })
        .finally(async () => {
          // A timed-out HTTP/DB read cannot be canceled by Discord's managers.
          // Keep its admission slot until it actually settles: no retry flood.
          await Promise.allSettled([...outstanding]);
          active--;
        });
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true; counts.timeouts++;
          reject(new Error('Conversation lookup deadline exceeded.'));
        }, timeoutMs);
      });
      try { return await Promise.race([work, deadline]); }
      finally { clearTimeout(timer); }
    },
    stop() {
      stopped = true;
      invalidate();
      for (const [event, listener] of listeners) client?.off?.(event, listener);
      client?.rest?.off?.('rateLimited', rateLimited);
    },
  };
}
