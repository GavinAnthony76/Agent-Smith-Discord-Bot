import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerStatus } from '../src/worker-status.js';

async function harness(t, isDiscordReady = () => false) {
  const status = createWorkerStatus({ isDiscordReady });
  const { port } = await status.listen({ port: 0, host: '127.0.0.1' });
  t.after(() => status.close());
  const get = (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
  return { status, get };
}

test('hosting liveness succeeds while Discord login is waiting; readiness does not', async t => {
  const { status, get } = await harness(t);
  for (const phase of ['starting', 'waiting_for_discord', 'connecting']) {
    status.setPhase(phase);
    for (const path of ['/', '/api', '/api/', '/healthz', '/api/healthz']) {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: phase, ready: false });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    for (const path of ['/readyz', '/api/readyz']) {
      const response = await get(path);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: phase, ready: false });
    }
  }
});

test('ready is true only after startup completes and Discord remains connected', async t => {
  let connected = true;
  const { status, get } = await harness(t, () => connected);
  assert.deepEqual(status.snapshot(), { status: 'starting', ready: false });
  status.setPhase('ready');
  let response = await get('/api/readyz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'connected', ready: true });
  connected = false;
  response = await get('/api/readyz');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'disconnected', ready: false });
  assert.equal((await get('/api')).status, 200, 'alive is not the same as connected');
  connected = true;
  status.setPhase('stopping');
  response = await get('/api');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'stopping', ready: false });
});

test('status checks cannot mutate state and reveal no supplied secrets or data', async t => {
  const { status, get } = await harness(t);
  const secret = 'synthetic-private-value';
  const response = await get(`/api?token=${secret}`, { method: 'POST', body: secret });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  assert.deepEqual(await response.json(), { error: 'method_not_allowed' });
  assert.deepEqual(status.snapshot(), { status: 'starting', ready: false });
  const check = await get(`/api?token=${secret}`);
  const body = await check.text();
  assert.equal(body.includes(secret), false);
  assert.deepEqual(Object.keys(JSON.parse(body)), ['status', 'ready']);
  const unknown = await get('/api/members');
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'not_found' });
});

test('HEAD checks have the same status without a response body', async t => {
  const { get } = await harness(t);
  const alive = await get('/api', { method: 'HEAD' });
  assert.equal(alive.status, 200);
  assert.equal(await alive.text(), '');
  const ready = await get('/readyz', { method: 'HEAD' });
  assert.equal(ready.status, 503);
  assert.equal(await ready.text(), '');
});

test('invalid phase and port are rejected and close is idempotent', async () => {
  const status = createWorkerStatus();
  assert.throws(() => status.setPhase('secret'), /Invalid worker status phase/);
  await assert.rejects(status.listen({ port: -1 }), /Invalid worker status port/);
  await status.close();
  await status.close();
});
