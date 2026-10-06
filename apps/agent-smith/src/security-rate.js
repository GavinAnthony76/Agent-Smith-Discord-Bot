import { securityLimits } from './security-policy.js';

// Reservations are durable and server-wide. Failures consume the cooldown:
// a lost API acknowledgement must not permit another destructive attempt.
export async function reserveDestructiveOperation(pool, guildId, actorId, action) {
  if (!['kick','ban','unban','purge'].includes(action.operation)) return;
  const db = await pool.connect(), limits = securityLimits();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`security-rate:${guildId}:${action.operation}`]);
    const existing = await db.query(`SELECT id FROM audit WHERE guild_id=$1 AND action='mod.rate-reserved'
      AND detail->>'operation'=$2 AND created_at > now()-($3 * interval '1 millisecond') LIMIT 1`,
    [guildId, action.operation, limits.cooldownMs]);
    if (existing.rows.length) throw new Error('This destructive operation is limited to one per server per minute. Check the previous audit result before retrying.');
    await db.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)',
      [guildId, actorId, 'mod.rate-reserved', JSON.stringify({ operation: action.operation, target: action.target, channel: action.channel })]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
  finally { db.release(); }
}
