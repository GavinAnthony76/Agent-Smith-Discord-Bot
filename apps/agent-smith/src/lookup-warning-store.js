import { LOOKUP_WARNING_KEY, LOOKUP_WARNING_DEFAULTS, lookupWarningSettings } from './lookup-warning-policy.js';

export function createLookupWarningStore({ pool, guildId }) {
  return {
    async settings() {
      const row = (await pool.query('SELECT value FROM bot_settings WHERE guild_id=$1 AND key=$2',
        [guildId, LOOKUP_WARNING_KEY])).rows[0];
      return row ? { ...lookupWarningSettings(row.value), approvedOwner: row.value.approvedOwner } : { ...LOOKUP_WARNING_DEFAULTS };
    },
    async configure(value, actor) {
      const settings = { ...lookupWarningSettings(value), approvedOwner: actor };
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('INSERT INTO bot_settings(guild_id,key,value) VALUES($1,$2,$3) ON CONFLICT(guild_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
          [guildId, LOOKUP_WARNING_KEY, JSON.stringify(settings)]);
        await db.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)',
          [guildId, actor, 'settings.changed', JSON.stringify({ key: LOOKUP_WARNING_KEY, value: lookupWarningSettings(settings) })]);
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { db.release(); }
      return settings;
    },
    async reserve(cooldownMinutes) {
      // Reserve before any Discord write, including failed/uncertain delivery.
      // A single atomic upsert preserves cooldown across restarts/processes.
      const result = await pool.query(`INSERT INTO bot_settings(guild_id,key,value)
        VALUES($1,'conversation-lookup-warning-attempt',
          jsonb_build_object('nextAttemptAt', extract(epoch FROM clock_timestamp()) * 1000 + $2::bigint))
        ON CONFLICT(guild_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()
        WHERE (bot_settings.value->>'nextAttemptAt')::numeric <= extract(epoch FROM clock_timestamp()) * 1000
        RETURNING key`, [guildId, cooldownMinutes * 60000]);
      return result.rows.length === 1;
    },
  };
}
