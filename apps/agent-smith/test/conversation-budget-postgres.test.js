import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createBudgetStore } from '../src/conversation-budget-store.js';
import { createConversationBudget, tokenReservation } from '../src/conversation-budget.js';

// Explicit development-only disposable schema; never fall back to public.
test('PostgreSQL budget persists across services and serializes overlapping reservations', {
  skip: process.env.SMITH_PG_TESTS !== '1',
}, async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  const schema = `budget_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema} -c application_name=${schema}`, max: 5 });
    await pool.query(await readFile(new URL('../src/conversation-budget-schema.sql', import.meta.url), 'utf8'));
    await pool.query('CREATE TABLE audit(guild_id text,actor text,action text,detail jsonb)');
    const defaults = { requests: 1, tokens: 10000, timezone: 'America/Chicago' };
    const make = p => createConversationBudget({ store: createBudgetStore({ pool: p, guildId: 'test-guild' }), defaults });
    const first = make(pool), second = make(pool);
    let entered, release;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    const releasePromise = new Promise(resolve => { release = resolve; });
    const heldPool = { connect: async () => {
      const db = await pool.connect();
      return { release: (...args) => db.release(...args), query: async (sql, args) => {
        const result = await db.query(sql, args);
        if (sql.includes('INSERT INTO conversation_budget_reservations')) { entered(); await releasePromise; }
        return result;
      } };
    } };
    const pending = make(heldPool).reserve([{ content: 'hello' }], 128);
    await enteredPromise;
    let finished = false;
    const overlapping = second.reserve([{ content: 'hello' }], 128).then(value => { finished = true; return value; });
    // Observe the actual PostgreSQL waiter, not merely a recorded lock call.
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      const result = await admin.query(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
        WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name=$1
        AND a.query LIKE '%pg_advisory_xact_lock%'`, [schema]);
      if (result.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    release();
    const reservation = await pending;
    assert.equal((await overlapping).allowed, false);
    assert.equal(waiting, true);
    assert.equal(finished, true);
    assert.equal(reservation.allowed, true);
    await first.settle(reservation, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 });
    await first.settle(reservation, { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 });
    const restarted = make(pool);
    assert.equal((await restarted.status()).measuredTokens, 20);
    assert.equal((await restarted.reserve([{ content: 'hello' }], 128)).allowed, false);
    const original = await first.status();
    await first.configure({ requests: 10, tokens: 10000, timezone: 'UTC' }, 'owner');
    assert.equal(new Date((await first.status()).period.endsAt).toISOString(), new Date(original.period.endsAt).toISOString());
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM audit')).rows[0].n, 1);

    // Model a lost COMMIT acknowledgement: the persisted reservation survives,
    // but admission throws, so callers cannot start a paid request.
    let lost = false;
    const lostAckPool = { connect: async () => {
      const db = await pool.connect();
      return { release: (...args) => db.release(...args), query: async (sql, args) => {
        const result = await db.query(sql, args);
        if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('lost commit acknowledgement'); }
        return result;
      } };
    } };
    await assert.rejects(make(lostAckPool).reserve([{ content: 'hello' }], 128));
    assert.equal((await restarted.status()).requests, 2);
    const amount = tokenReservation([{ content: 'hello' }], 128);
    assert.equal((await restarted.status()).estimatedTokens, amount);

    // Late settlement stays in the expired original window; no daily refund.
    await pool.query("UPDATE conversation_budget_periods SET ends_at=clock_timestamp()-interval '1 second',starts_at=clock_timestamp()-interval '1 day'");
    assert.equal((await restarted.status()).requests, 0);
    assert.equal((await restarted.reserve([{ content: 'hello' }], 128)).allowed, true);
    await first.settle(reservation, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 });
    assert.equal((await restarted.status()).estimatedTokens, amount);
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
