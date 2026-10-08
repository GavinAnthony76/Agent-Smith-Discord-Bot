import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createLookupWarningStore } from '../src/lookup-warning-store.js';

test('PostgreSQL lookup warning cooldown persists and serializes concurrent reservations', {
  skip: process.env.SMITH_PG_TESTS !== '1',
}, async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  const schema = `lookup_warning_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let pool, held, pending, overlapping;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema} -c application_name=${schema}`, max: 5 });
    await pool.query(`CREATE TABLE bot_settings(guild_id text,key text,value jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(guild_id,key));
      CREATE TABLE audit(guild_id text,actor text,action text,detail jsonb)`);
    const make = p => createLookupWarningStore({ pool: p, guildId: 'test-guild' });
    const store = make(pool);
    assert.equal((await store.settings()).enabled, false);
    await store.configure({ enabled: true, threshold: 5, cooldownMinutes: 15 }, 'test-owner');
    assert.deepEqual(await make(pool).settings(), { enabled: true, threshold: 5, cooldownMinutes: 15, approvedOwner: 'test-owner' });
    assert.equal(await store.reserve(15), true);
    assert.equal(await make(pool).reserve(15), false);
    await pool.query(`UPDATE bot_settings SET value='{"nextAttemptAt":0}' WHERE key='conversation-lookup-warning-attempt'`);

    // Force real overlapping atomic upserts to wait on a held row lock.
    held = await pool.connect();
    await held.query('BEGIN');
    await held.query("SELECT key FROM bot_settings WHERE key='conversation-lookup-warning-attempt' FOR UPDATE");
    pending = store.reserve(15);
    overlapping = make(pool).reserve(15);
    let waiting = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await admin.query(`SELECT count(*)::integer AS n FROM pg_stat_activity
        WHERE application_name=$1 AND wait_event_type='Lock'
        AND query LIKE '%INSERT INTO bot_settings%'`, [schema]);
      if (result.rows[0].n === 2) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await held.query('COMMIT');
    assert.deepEqual((await Promise.all([pending, overlapping])).sort(), [false, true]);
    assert.equal(waiting, true);
    assert.equal(await make(pool).reserve(15), false);

    // Lost acknowledgement may not cause an immediate duplicate warning.
    await pool.query(`UPDATE bot_settings SET value='{"nextAttemptAt":0}' WHERE key='conversation-lookup-warning-attempt'`);
    const uncertainPool = { async query(sql, args) { await pool.query(sql, args); throw new Error('lost acknowledgement'); } };
    await assert.rejects(make(uncertainPool).reserve(15));
    assert.equal(await make(pool).reserve(15), false);
    await store.configure({ enabled: false, threshold: 5, cooldownMinutes: 15 }, 'test-owner');
    assert.equal((await make(pool).settings()).enabled, false);
    assert.equal(await make(pool).reserve(15), false); // disable/re-enable cannot reset cooldown.
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM audit')).rows[0].n, 2);
  } finally {
    await held?.query('ROLLBACK').catch(() => {});
    held?.release();
    await Promise.allSettled([pending, overlapping].filter(Boolean));
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
