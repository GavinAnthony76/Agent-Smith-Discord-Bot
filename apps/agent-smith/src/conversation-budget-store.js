import { runLocked } from './transaction.js';
import { randomUUID } from 'node:crypto';

export function createBudgetStore({ pool, guildId }) {
  return {
    transaction(fn) {
      return runLocked(pool, `smith-ai-budget:${guildId}`, async db => {
        const one = async (sql, args) => (await db.query(sql, args)).rows[0];
        return fn({
          async settings(defaults) {
            await db.query(`INSERT INTO conversation_budget_settings(guild_id,request_limit,token_limit,timezone)
              VALUES($1,$2,$3,$4) ON CONFLICT(guild_id) DO NOTHING`,
            [guildId, defaults.requests, defaults.tokens, defaults.timezone]);
            const row = await one('SELECT * FROM conversation_budget_settings WHERE guild_id=$1', [guildId]);
            return { requests: row.request_limit, tokens: row.token_limit, timezone: row.timezone };
          },
          async period(timezone) {
            let row = await one(`SELECT * FROM conversation_budget_periods
              WHERE guild_id=$1 AND ends_at>clock_timestamp() ORDER BY ends_at DESC LIMIT 1`, [guildId]);
            if (!row) {
              row = await one(`INSERT INTO conversation_budget_periods(id,guild_id,starts_at,ends_at,timezone)
                VALUES($1,$2,clock_timestamp(),
                (date_trunc('day',clock_timestamp() AT TIME ZONE $3)+interval '1 day') AT TIME ZONE $3,$3)
                RETURNING *`, [randomUUID(), guildId, timezone]);
            }
            return { id: row.id, endsAt: row.ends_at, timezone: row.timezone, blocked: row.accounting_blocked };
          },
          async usage(periodId) {
            const row = await one(`SELECT count(*)::integer AS requests,
              COALESCE(sum(charged_tokens),0)::bigint AS charged,
              COALESCE(sum(measured_tokens),0)::bigint AS measured,
              COALESCE(sum(charged_tokens) FILTER(WHERE measured_tokens IS NULL),0)::bigint AS estimated,
              count(*) FILTER(WHERE measured_tokens IS NULL)::integer AS unmeasured
              FROM conversation_budget_reservations WHERE guild_id=$1 AND period_id=$2`, [guildId, periodId]);
            return { requests: row.requests, chargedTokens: Number(row.charged), measuredTokens: Number(row.measured),
              estimatedTokens: Number(row.estimated), unmeasuredRequests: row.unmeasured };
          },
          reserve({ id, periodId, tokens }) {
            return db.query(`INSERT INTO conversation_budget_reservations(id,guild_id,period_id,charged_tokens,reserved_tokens)
              VALUES($1,$2,$3,$4,$4)`, [id, guildId, periodId, tokens]);
          },
          settle(id, measured) {
            // Idempotent: late settlement belongs to the original period.
            // If the provider ever exceeds our reservation, record truthfully
            // and freeze that window instead of hiding the accounting anomaly.
            return db.query(`UPDATE conversation_budget_reservations SET
              measured_tokens=$3,charged_tokens=$3,settled_at=clock_timestamp()
              WHERE id=$1 AND guild_id=$2 AND measured_tokens IS NULL`, [id, guildId, measured])
              .then(() => db.query(`UPDATE conversation_budget_periods SET accounting_blocked=true
                WHERE guild_id=$1 AND id=(SELECT period_id FROM conversation_budget_reservations
                WHERE id=$2 AND guild_id=$1 AND measured_tokens>reserved_tokens)`, [guildId, id]));
          },
          async configure(settings, actor, previous) {
            await db.query(`UPDATE conversation_budget_settings SET request_limit=$2,token_limit=$3,timezone=$4
              WHERE guild_id=$1`, [guildId, settings.requests, settings.tokens, settings.timezone]);
            await db.query(`INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)`,
              [guildId, actor, 'conversation_budget_settings', JSON.stringify({ previous, settings })]);
          },
        });
      });
    },
  };
}
