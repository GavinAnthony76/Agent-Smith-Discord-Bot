import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createConversationLookups } from '../src/conversation-lookups.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixture = options => {
  const client = new EventEmitter();
  client.isReady = () => true;
  const guild = { id: 'g' };
  return { client, guild, lookups: createConversationLookups({ client, guild, ...options }) };
};

test('only callers admitted before dispatch share a fresh request; no completed authorization cache', async () => {
  const { lookups } = fixture();
  const result = deferred(), started = deferred(), secondStarted = deferred();
  let calls = 0;
  const read = () => {
    calls++;
    if (calls === 1) started.resolve();
    else secondStarted.resolve();
    return result.promise;
  };
  const a = lookups.run(scope => scope.read('channels', read));
  await started.promise;
  const b = lookups.run(scope => scope.read('channels', read));
  await secondStarted.promise;
  assert.equal(calls, 2); // b cannot join a request already in flight.
  result.resolve('fresh');
  assert.deepEqual(await Promise.all([a, b]), ['fresh', 'fresh']);
  await lookups.run(scope => scope.read('channels', async () => { calls++; return 'new'; }));
  assert.equal(calls, 3);
  lookups.stop();
});

test('each relevant Discord update invalidates shared public metadata and in-flight freshness', async () => {
  const { lookups, client, guild } = fixture();
  const events = ['channelCreate', 'channelUpdate', 'channelDelete', 'roleCreate', 'roleUpdate', 'roleDelete',
    'guildMemberUpdate', 'guildMemberRemove', 'guildUpdate', 'threadCreate', 'threadUpdate', 'threadDelete',
    'threadMembersUpdate', 'guildScheduledEventCreate', 'guildScheduledEventUpdate', 'guildScheduledEventDelete',
    'guildUnavailable', 'guildAvailable', 'guildDelete'];
  for (const event of events) {
    await lookups.run(scope => scope.publicRewards(async () => ({ rows: [{ title: 'public', price: 1 }] })));
    const version = lookups.version;
    client.emit(event, { guild });
    assert.equal(lookups.snapshot().cached, 0, event);
    assert.throws(() => lookups.assertFresh(version), /freshness/, event);
  }
  const version = lookups.version;
  client.emit('channelUpdate', { guild: { id: 'other-guild' } });
  lookups.assertFresh(version);
  lookups.stop();
  for (const event of events) assert.equal(client.listenerCount(event), 0, event);
});

test('an update during a shared request fails all readers and does not populate any cache', async () => {
  const { lookups, client, guild } = fixture();
  const response = deferred(), start = deferred();
  let calls = 0;
  const read = () => { calls++; start.resolve(); return response.promise; };
  const a = lookups.run(scope => scope.read('roles', read));
  const b = lookups.run(scope => scope.read('roles', read));
  const assertions = [assert.rejects(a, /freshness/), assert.rejects(b, /freshness/)];
  await start.promise;
  assert.equal(calls, 1);
  client.emit('roleUpdate', { guild });
  response.resolve('stale snapshot');
  await Promise.all(assertions);
  assert.equal(lookups.snapshot().cached, 0);
  lookups.stop();
});

test('public rewards have a bounded TTL/size, defensive copies and no member or arbitrary row fields', async () => {
  let time = 100;
  const { lookups } = fixture({ now: () => time, publicTtlMs: 50000 });
  let calls = 0;
  const read = async () => {
    calls++;
    return { rows: Array.from({ length: 150 }, () => ({ title: 'x'.repeat(200), price: 1, userId: 'secret' })) };
  };
  const a = await lookups.run(scope => scope.publicRewards(read));
  assert.equal(a.rows.length, 100);
  assert.equal(a.rows[0].title.length, 100);
  assert.equal(JSON.stringify(a).includes('secret'), false);
  a.rows[0].title = 'changed';
  const b = await lookups.run(scope => scope.publicRewards(read));
  assert.equal(calls, 1);
  assert.equal(b.rows[0].title, 'x'.repeat(100));
  time += 30000;
  await lookups.run(scope => scope.publicRewards(read));
  assert.equal(calls, 2);
  assert.equal(lookups.snapshot().cached, 1);
  lookups.stop();
});

test('timeouts return promptly but retain admission until underlying reads settle; no retry queue', async () => {
  const { lookups } = fixture({ timeoutMs: 15, maxActive: 1 });
  const response = deferred();
  let calls = 0, after = 0;
  const timed = lookups.run(async scope => {
    await scope.read('member', () => { calls++; return response.promise; });
    after++;
    return 'late private response';
  });
  await assert.rejects(timed, /deadline/);
  assert.equal(lookups.snapshot().active, 1);
  await assert.rejects(lookups.run(() => { calls++; }), /budget/);
  assert.equal(calls, 1);
  response.resolve('late member');
  await tick();
  assert.equal(after, 0);
  assert.equal(lookups.snapshot().active, 0);
  assert.equal(lookups.snapshot().timeouts, 1);
  lookups.stop();
});

test('one failed read cannot release its slot while sibling database requests remain pending', async () => {
  const { lookups } = fixture({ timeoutMs: 20, maxActive: 1 });
  const response = deferred();
  const request = lookups.run(scope => Promise.all([
    scope.read('database', async () => { throw new Error('offline database'); }),
    scope.read('database', () => response.promise),
  ]));
  await assert.rejects(request, /deadline/);
  assert.equal(lookups.snapshot().active, 1);
  await assert.rejects(lookups.run(() => {}), /budget/);
  response.resolve();
  await tick();
  assert.equal(lookups.snapshot().active, 0);
  assert.equal(lookups.snapshot().reads.database.failures, 1);
  lookups.stop();
});

test('rate budget refuses conversation-only work without queuing or intercepting core reads', async () => {
  let time = 100;
  const { lookups } = fixture({ now: () => time, maxStarts: 2, windowMs: 1000 });
  let conversationCalls = 0, coreCalls = 0;
  const conversation = () => lookups.run(scope => scope.read('member', async () => ++conversationCalls));
  await conversation(); await conversation();
  await assert.rejects(conversation(), /budget/);
  // Existing audits/commands call their managers directly; no global monkey patch/lock.
  const coreRead = async () => ++coreCalls;
  await coreRead();
  assert.equal(coreCalls, 1);
  assert.equal(conversationCalls, 2);
  time += 1000;
  await conversation();
  assert.equal(conversationCalls, 3);
  lookups.stop();
});

test('disconnects, reconnects, unready clients and shutdown never authorize an old snapshot', async () => {
  const { lookups, client } = fixture();
  for (const event of ['shardDisconnect', 'shardReconnecting', 'shardResume', 'shardReady', 'invalidated']) {
    const version = lookups.version;
    client.emit(event);
    assert.throws(() => lookups.assertFresh(version), /freshness/);
  }
  client.isReady = () => false;
  await assert.rejects(lookups.run(() => 'not safe'), /budget/);
  client.isReady = () => true;
  const pending = deferred(), started = deferred();
  const request = lookups.run(scope => scope.read('member', () => { started.resolve(); return pending.promise; }));
  await started.promise;
  const assertion = assert.rejects(request, /freshness/);
  lookups.stop();
  pending.resolve('late');
  await assertion;
  await assert.rejects(lookups.run(() => 'not safe'), /budget/);
});

test('conversation yields REST headroom and rate-limit backoff to core workflows', async () => {
  let time = 100;
  const { lookups, client } = fixture({ now: () => time });
  // Attach another limiter with an existing REST emitter to test its listener.
  lookups.stop();
  client.rest = new EventEmitter();
  const bounded = createConversationLookups({ client, guild: { id: 'g' }, now: () => time });
  let calls = 0;
  const conversation = () => bounded.run(scope => scope.read('member', async () => ++calls));
  client.rest.globalReset = 1000;
  client.rest.globalRemaining = 9;
  await assert.rejects(conversation(), /budget/);
  assert.equal(calls, 0);
  client.rest.globalRemaining = 20;
  await conversation();
  client.rest.handlers = new Map([['sdk-route', { limited: true }]]);
  await assert.rejects(conversation(), /budget/);
  assert.equal(calls, 1);
  client.rest.handlers.clear();
  client.rest.emit('rateLimited', { retryAfter: 2000 });
  await assert.rejects(conversation(), /budget/);
  // Core REST remains callable and is neither wrapped nor held in a Smith queue.
  client.rest.get = async () => 'core read';
  assert.equal(await client.rest.get('/audit'), 'core read');
  assert.equal(calls, 1);
  time += 2250;
  await conversation();
  assert.equal(calls, 2);
  assert.equal(bounded.snapshot().backoffs, 1);
  bounded.stop();
  assert.equal(client.rest.listenerCount('rateLimited'), 0);
});
