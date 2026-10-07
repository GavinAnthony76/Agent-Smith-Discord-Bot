import test from 'node:test';
import assert from 'node:assert/strict';
import { loginWhenAllowed } from '../src/gateway-startup.js';

const gateway = (remaining, reset_after = 60000, shards = 1) => ({
  shards, session_start_limit: { remaining, reset_after },
});

test('login occurs once when Discord has sufficient session allowance', async () => {
  let logins = 0;
  const result = await loginWhenAllowed({
    getGateway: async () => gateway(1),
    login: async () => { logins++; return 'connected'; },
    sleep: async () => assert.fail('should not wait'),
  });
  assert.equal(result, 'connected');
  assert.equal(logins, 1);
});

test('the worker waits through exhaustion without attempting Gateway login', async () => {
  const responses = [gateway(0, 45000), gateway(0, 10000), gateway(1)];
  const sleeps = [], logs = [], phases = [];
  let logins = 0, reads = 0;
  await loginWhenAllowed({
    waitForSession: true,
    getGateway: async () => { reads++; return responses.shift(); },
    login: async () => { logins++; },
    sleep: async ms => {
      assert.equal(logins, 0);
      sleeps.push(ms);
    },
    now: () => Date.UTC(2026, 9, 7, 22, 0),
    log: message => logs.push(message),
    onStartupState: phase => phases.push(phase),
  });
  assert.deepEqual(sleeps, [50000, 15000]);
  assert.equal(reads, 3);
  assert.equal(logins, 1);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /No Gateway login attempted/);
  assert.deepEqual(phases, ['waiting_for_discord', 'waiting_for_discord', 'connecting']);
});

test('administrative one-off commands fail clearly rather than wait indefinitely', async () => {
  await assert.rejects(loginWhenAllowed({
    getGateway: async () => gateway(0),
    login: async () => assert.fail('must not identify'),
    sleep: async () => assert.fail('must not wait'),
  }), /allowance exhausted; retry after/);
});

test('a session-budget race rechecks metadata rather than crashing the worker', async () => {
  let logins = 0, resets = 0;
  const sleeps = [];
  const responses = [gateway(1), gateway(0, 10000), gateway(1)];
  await loginWhenAllowed({
    waitForSession: true, log: () => {},
    getGateway: async () => responses.shift(),
    login: async () => {
      if (logins > 0) assert.equal(resets, 1, 'a failed SDK client must be replaced before retry');
      if (++logins === 1) throw new Error('Not enough sessions remaining to spawn 1 shards; only 0 remaining; resets at 2026-10-07T23:41:58.000Z');
    },
    resetAfterSessionLimit: async () => { resets++; },
    sleep: async ms => sleeps.push(ms),
  });
  assert.equal(logins, 2);
  assert.deepEqual(sleeps, [5000, 15000]);
});

test('a failed SDK client is not retried without an explicit replacement', async () => {
  await assert.rejects(loginWhenAllowed({
    waitForSession: true, getGateway: async () => gateway(1),
    login: async () => { throw new Error('Not enough sessions remaining to spawn 1 shards; only 0 remaining; resets at later'); },
    sleep: async () => assert.fail('destroyed client must not retry'),
  }), /Not enough sessions/);
});

test('authentication and unexpected Gateway errors are never silently retried', async () => {
  for (const message of ['An invalid token was provided.', 'Disallowed intents', 'Network unavailable']) {
    await assert.rejects(loginWhenAllowed({
      waitForSession: true,
      getGateway: async () => gateway(1),
      login: async () => { throw new Error(message); },
      sleep: async () => assert.fail('unexpected error must not retry'),
    }), { message });
  }
});

test('invalid session-limit metadata fails closed before identification', async () => {
  for (const value of [null, gateway(-1), gateway(1, -1), gateway(1, 1000, 0), gateway(1, NaN)]) {
    await assert.rejects(loginWhenAllowed({
      waitForSession: true, getGateway: async () => value,
      login: async () => assert.fail('invalid metadata must not identify'),
    }), /invalid Gateway session-limit metadata/);
  }
});

test('long waits are chunked below the Node timer overflow limit', async () => {
  const responses = [gateway(0, 2_148_000_000), gateway(2, 0, 2)];
  const waits = [];
  await loginWhenAllowed({
    waitForSession: true, log: () => {},
    getGateway: async () => responses.shift(), login: async () => {},
    sleep: async ms => waits.push(ms),
  });
  assert.deepEqual(waits, [2_147_000_000, 1_005_000]);
});
