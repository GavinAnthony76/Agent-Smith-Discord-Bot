import { DEFAULT_PLANS } from './catalog.js';

// Per-server reservation is atomic across instances; no paid checkout involved.
export function meterProvider({ provider, pool, guildId }) {
  return {
    configured: provider.configured,
    async complete(messages, signal, { onUsage = () => {} } = {}) {
      const row = (await pool.query(
        'SELECT plan,limit_overrides FROM platform_entitlements WHERE guild_id=$1', [guildId])).rows[0];
      const plan = Object.hasOwn(DEFAULT_PLANS, row?.plan) ? row.plan : 'FREE';
      const limit = row?.limit_overrides?.ai_monthly_requests ?? DEFAULT_PLANS[plan].ai_monthly_requests;
      const reserved = await pool.query(
        `INSERT INTO platform_ai_periods(guild_id,period,requests)
         SELECT $1,date_trunc('month',now())::date,1 WHERE $2=-1 OR $2>0
         ON CONFLICT(guild_id,period) DO UPDATE SET requests=platform_ai_periods.requests+1
          WHERE $2=-1 OR platform_ai_periods.requests<$2 RETURNING period`,
        [guildId, limit]);
      if (!reserved.rows.length) {
        onUsage?.({ prompt_tokens: 0, completion_tokens: 0 });
        const error = new Error('Monthly allowance exhausted.');
        error.code = 'monthly_ai_budget_exhausted';
        throw error;
      }
      const started = Date.now();
      let usage;
      try {
        return await provider.complete(messages, signal, { onUsage: value => { usage = value; onUsage(value); } });
      } finally {
        const input = usage?.prompt_tokens, output = usage?.completion_tokens;
        const known = Number.isSafeInteger(input) && input >= 0 && input <= 1000000 &&
          Number.isSafeInteger(output) && output >= 0 && output <= 1000000;
        await pool.query(
          `UPDATE platform_ai_periods SET input_tokens=input_tokens+$3,output_tokens=output_tokens+$4,
           missing_usage=missing_usage+$5,latency_ms=latency_ms+$6 WHERE guild_id=$1 AND period=$2`,
          [guildId, reserved.rows[0].period, known ? input : 0, known ? output : 0, known ? 0 : 1,
            Math.min(Date.now() - started, 3600000)]);
      }
    },
  };
}
