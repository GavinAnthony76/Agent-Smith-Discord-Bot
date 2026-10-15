import { TARGET_GUILD_ID } from '../config.js';
import { PlatformError } from './catalog.js';

export const LMOC_TEST_ID = '1555330318569971743';

// Owner policy: Hallowed Core is the sole active production guild. Environment
// variables and an old installation/configuration are not activation approval.
// A future test guild requires explicit Owner authorization and a policy review.
const authorizedStandardGuilds = Object.freeze([]);
export const standardGuildAuthorized = id => authorizedStandardGuilds.includes(id);
export const historicalGuild = id => id === LMOC_TEST_ID;

export function assertProductionGuildWritable(guildId) {
  if (guildId !== TARGET_GUILD_ID && !standardGuildAuthorized(guildId))
    throw new PlatformError('guild_reference_only', 403);
}

/**
 * Archive operational liveness only. Keep configuration, progress, consent,
 * records, entitlement data, activity and existing audits intact. One atomic,
 * idempotent statement preserves the previous runtime snapshot in the audit.
 * Called by the existing bot at startup, never by a new Gateway or a migration.
 */
export async function archiveHistoricalRuntime(pool, actorId) {
  return pool.query(`WITH previous AS MATERIALIZED (
      SELECT s.* FROM platform_runtime_state s
      JOIN platform_guilds g USING(guild_id)
      WHERE s.guild_id=$1 AND (s.runtime_active OR s.bot_connected
        OR s.module_states <> '{}'::jsonb)
      FOR UPDATE OF s
    ), archived AS (
      UPDATE platform_runtime_state s SET runtime_active=false,
        bot_connected=false,module_states='{}'::jsonb
      FROM previous p WHERE s.guild_id=p.guild_id
      RETURNING s.guild_id,to_jsonb(p)-'guild_id' AS before_state
    )
    INSERT INTO platform_audit(guild_id,actor_user_id,action,module,before_state,after_state)
      SELECT guild_id,$2,'guild_archived_reference_only','settings',before_state,
        '{"lifecycle":"historical-reference-only","runtimeActive":false,"botConnected":false,"moduleStates":{},"reason":"owner_hallowed_core_only"}'::jsonb
      FROM archived RETURNING id`, [LMOC_TEST_ID, actorId]);
}
