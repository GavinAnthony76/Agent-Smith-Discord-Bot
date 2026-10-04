import pg from 'pg';
import { config } from './config.js';
export const pool = new pg.Pool({ connectionString: config().databaseUrl });
export async function locked(key, fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    const value = await fn(db);
    await db.query('COMMIT'); return value;
  } catch (e) { await db.query('ROLLBACK'); throw e; }
  finally { db.release(); }
}
export async function resource(kind, name, db = pool) {
  const r = await db.query('SELECT discord_id FROM resources WHERE guild_id=$1 AND kind=$2 AND name=$3', [config().guildId, kind, name]);
  if (!r.rows[0]) throw new Error(`Missing ${kind} ${name}; run bootstrap`);
  return r.rows[0].discord_id;
}
export async function audit(db, actor, action, detail) {
  await db.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)', [config().guildId, actor, action, JSON.stringify(detail)]);
}
