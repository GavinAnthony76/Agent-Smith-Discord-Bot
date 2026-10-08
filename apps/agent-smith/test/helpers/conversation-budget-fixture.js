import { randomUUID } from 'node:crypto';
import { createConversationBudget } from '../../src/conversation-budget.js';

function nextMidnight(time, timezone) {
  const date = t => new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const today = date(time);
  let low = time, high = time + 27 * 3600000;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (date(mid) === today) low = mid; else high = mid;
  }
  return high;
}

export function budgetFixture(defaults = { requests: 100, tokens: 10000, timezone: 'America/Chicago' }) {
  let time = Date.parse('2026-10-07T17:00:00Z'), tail = Promise.resolve();
  let state = { settings: null, periods: [], reservations: [], audit: [] };
  const faults = { read: false, reserve: false, settle: false, commit: false };
  let beforeReserve = async () => {};
  const store = {
    async transaction(fn) {
      const previous = tail;
      let unlock;
      tail = new Promise(resolve => { unlock = resolve; });
      await previous;
      const backup = structuredClone(state);
      try {
        const result = await fn({
          async settings(initial) {
            if (faults.read) throw new Error('database unavailable');
            state.settings ??= { ...initial };
            return { ...state.settings };
          },
          async period(timezone) {
            let period = state.periods.find(p => p.endsAt > time);
            if (!period) {
              period = { id: randomUUID(), endsAt: nextMidnight(time, timezone), timezone, blocked: false };
              state.periods.push(period);
            }
            return { ...period };
          },
          async usage(id) {
            const rows = state.reservations.filter(r => r.periodId === id);
            const missing = rows.filter(r => r.measured === null);
            return { requests: rows.length, chargedTokens: rows.reduce((n, r) => n + r.charged, 0),
              measuredTokens: rows.reduce((n, r) => n + (r.measured ?? 0), 0),
              estimatedTokens: missing.reduce((n, r) => n + r.charged, 0), unmeasuredRequests: missing.length };
          },
          async reserve(reservation) {
            await beforeReserve();
            if (faults.reserve) throw new Error('reserve failed');
            state.reservations.push({ ...reservation, charged: reservation.tokens, measured: null });
          },
          async settle(id, measured) {
            if (faults.settle) throw new Error('settlement failed');
            const row = state.reservations.find(r => r.id === id);
            if (row && row.measured === null) {
              row.measured = row.charged = measured;
              if (measured > row.tokens) state.periods.find(p => p.id === row.periodId).blocked = true;
            }
          },
          async configure(settings, actor, previous) {
            state.settings = { ...settings };
            state.audit.push({ actor, previous, settings });
          },
        });
        if (faults.commit) throw new Error('commit failed');
        return result;
      } catch (error) { state = backup; throw error; }
      finally { unlock(); }
    },
  };
  return { budget: createConversationBudget({ store, defaults }), store, faults,
    setTime: value => { time = Date.parse(value); },
    holdReserve: hook => { beforeReserve = hook; }, state: () => state };
}
