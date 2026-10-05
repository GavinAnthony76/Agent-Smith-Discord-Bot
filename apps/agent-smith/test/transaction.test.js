import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocked } from '../src/transaction.js';

function fixture({ commitError, rollbackError, commitCommand = 'COMMIT' } = {}) {
  const calls = [], releases = [];
  const pool = { connect: async () => ({
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql === 'COMMIT' && commitError) throw commitError;
      if (sql === 'ROLLBACK' && rollbackError) throw rollbackError;
      return { command: sql === 'COMMIT' ? commitCommand : sql };
    },
    release: value => releases.push(value)
  }) };
  return { pool, calls, releases };
}

test('acknowledged commit returns result and releases a reusable client', async () => {
  const { pool, calls, releases } = fixture();
  assert.equal(await runLocked(pool, 'member-key', async () => 'ok'), 'ok');
  assert.deepEqual(calls.map(c => c.sql), ['BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))', 'COMMIT']);
  assert.deepEqual(calls[1].args, ['member-key']);
  assert.deepEqual(releases, [false]);
});

for (const code of ['40001', '40P01', '23514', '25P02']) {
  test(`explicit COMMIT rejection ${code} with acknowledged rollback is known failed storage`, async () => {
    const error = Object.assign(new Error('commit rejected'), { code });
    const { pool, releases } = fixture({ commitError: error });
    await assert.rejects(runLocked(pool, 'key', async () => 'ok'), e => e === error && e.transactionOutcome === 'rolled_back');
    assert.deepEqual(releases, [false]);
  });
}

for (const code of [undefined, '08006', '57P01']) {
  test(`uncertain COMMIT ${code} stays uncertain even when ROLLBACK returns successfully`, async () => {
    const error = Object.assign(new Error('lost acknowledgement'), { code });
    const { pool, releases } = fixture({ commitError: error });
    await assert.rejects(runLocked(pool, 'key', async () => 'ok'), e => e === error && e.transactionOutcome === 'unknown');
    assert.deepEqual(releases, [true]);
  });
}

test('rollback failure preserves the original error, marks outcome unknown, and discards the client', async () => {
  const error = new Error('original failure');
  const { pool, releases } = fixture({ rollbackError: new Error('rollback disconnected') });
  await assert.rejects(runLocked(pool, 'key', async () => { throw error; }), e => e === error && e.transactionOutcome === 'unknown');
  assert.deepEqual(releases, [true]);
});

test('COMMIT returning ROLLBACK is not reported as success', async () => {
  const { pool } = fixture({ commitCommand: 'ROLLBACK' });
  await assert.rejects(runLocked(pool, 'key', async () => 'ok'), e => e.transactionOutcome === 'rolled_back');
});
