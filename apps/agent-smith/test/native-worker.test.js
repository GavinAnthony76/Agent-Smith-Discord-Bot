import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { createNativeReconciler } from '../src/native-reconcile.js';
import { TARGET_GUILD_ID } from '../src/config.js';
import { registerSecurityConfiguration } from '../src/security-policy.js';

// Exercise the production coordinator/SQL boundaries and queue, not just its
// pure policy. All storage and Discord calls are injected; no live credentials.
async function fixture(t) {
  const uid = 'test-human';
  const names = ['Member', 'Faith', 'Gaming', 'Tech', 'Selection: Faith', 'Selection: Gaming', 'Selection: Tech'];
  const roles = new Collection(names.map(name => [name, { id: name, name, editable: true, managed: false, permissions: { bitfield: 0n } }]));
  const state = { held: new Set(['Selection: Gaming']), pending: false, record: undefined, grants: [],
    alerts: [], jobs: new Map(), audits: [], writes: [], delivered: [], due: true, failRole: false, failDelivery: false, onAdd: null };
  const channel = { permissionOverwrites: { cache: new Collection() }, send: async payload => {
    if (state.failDelivery) throw new Error('Discord unavailable');
    state.delivered.push(payload);
  } };
  function member() {
    return { id: uid, user: { bot: false }, pending: state.pending, roles: {
      cache: new Collection([...state.held].map(name => [name, roles.get(name)])),
      add: async role => {
        // The real coordinator must have COMMITTED the authorization intent.
        assert.ok(state.record?.primary_framework); assert.ok(state.record?.accepted_at);
        state.held.add(role.id); state.writes.push(role.name);
        if (state.onAdd) { const action = state.onAdd; state.onAdd = null; await action(); }
        if (state.failRole) { state.failRole = false; throw new Error('external success then lost response'); }
      }
    } };
  }
  const guild = { id: TARGET_GUILD_ID,
    roles: { cache: roles, fetch: async id => id ? roles.get(id) : roles },
    channels: { cache: new Collection([['review', channel]]), fetch: async () => channel },
    members: { fetch: async options => options ? member() : new Collection([[uid, member()]]) }
  };
  async function query(sql, args) {
    if (sql.startsWith('SELECT * FROM members')) return { rows: state.record ? [structuredClone(state.record)] : [] };
    if (sql.startsWith('SELECT framework FROM grants')) return { rows: state.grants.map(framework => ({ framework })) };
    if (sql.startsWith('INSERT INTO members')) {
      state.record = { ...state.record, accepted_at: state.record?.accepted_at ?? 'now', primary_framework: args[2] };
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith('INSERT INTO native_jobs')) {
      const prior = state.jobs.get(args[1]); state.jobs.set(args[1], { guild_id: args[0], user_id: args[1], revision: (prior?.revision ?? 0) + 1, attempts: 0 });
      state.due = true; return { rows: [] };
    }
    if (sql.startsWith('SELECT * FROM native_jobs')) return { rows: state.due ? [...state.jobs.values()].map(r => ({ ...r })) : [] };
    if (sql.startsWith('DELETE FROM native_jobs')) {
      if (state.jobs.get(args[1])?.revision === Number(args[2])) state.jobs.delete(args[1]);
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE native_jobs')) {
      const job = state.jobs.get(args[1]); if (job?.revision === Number(args[2])) { job.attempts++; state.due = false; }
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO native_alerts')) {
      if (state.alerts.some(a => a.fingerprint === args[2])) return { rows: [], rowCount: 0 };
      const row = { id: state.alerts.length + 1, guild_id: args[0], user_id: args[1], fingerprint: args[2], reason: args[3], detail: JSON.parse(args[4]) };
      state.alerts.push(row); return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM native_alerts')) return { rows: state.alerts.filter(a => !a.delivered_at) };
    if (sql.startsWith('UPDATE native_alerts')) {
      state.alerts.find(a => a.id === args[1]).delivered_at = 'now'; return { rows: [] };
    }
    throw new Error(`Unexpected SQL in production test: ${sql}`);
  }
  let tail = Promise.resolve();
  const lockKeys = [];
  const dependencies = {
    pool: { query }, resource: async (kind, name) => name, audit: async (_db, _actor, action) => { state.audits.push(action); },
    locked: (key, fn) => {
      lockKeys.push(key);
      const operation = tail.then(async () => {
        const old = { record: state.record && structuredClone(state.record), alerts: structuredClone(state.alerts), audits: [...state.audits] };
        try { return await fn({ query }); }
        catch (e) { state.record = old.record; state.alerts = old.alerts; state.audits = old.audits; throw e; }
      });
      tail = operation.catch(() => {}); return operation;
    }
  };
  guild.ownerId = 'test-owner'; guild.fetch = async () => guild;
  registerSecurityConfiguration(guild, { ownerDiscordId: 'test-owner', owners: ['test-owner'] });
  const worker = await createNativeReconciler({ guild, client: { user: { id: 'test-bot' } } }, dependencies);
  t.after(() => worker.stop());
  return { worker, state, uid, guild, roles, lockKeys };
}
test('production coordinator persists primary before external roles and shares legacy lock key', async t => {
  const f = await fixture(t); await f.worker.reconcile(f.uid);
  assert.deepEqual(f.state.writes, ['Member', 'Gaming']);
  assert.ok(f.lockKeys.every(k => k === `${TARGET_GUILD_ID}:${f.uid}`));
  assert.equal(f.state.audits.filter(a => a === 'native-primary-recorded').length, 1);
});
test('production Owner reconciliation stops before reserving primary or changing access', async t => {
  const f = await fixture(t);
  f.guild.ownerId = f.uid;
  registerSecurityConfiguration(f.guild, { ownerDiscordId:f.uid, owners:[f.uid] });
  const before=structuredClone(f.state.record);
  assert.deepEqual(await f.worker.reconcile(f.uid),{status:'owner-immune'});
  assert.deepEqual(f.state.record,before);
  assert.deepEqual(f.state.writes,[]);
  assert.deepEqual(f.state.audits,[]);
  assert.equal(f.lockKeys.length,0);
});
test('production retries interrupted grants after restart without changing primary to new choice', async t => {
  const f = await fixture(t); f.state.failRole = true;
  await f.worker.enqueue(f.uid); await f.worker.drain();
  assert.equal(f.state.record.primary_framework, 'Gaming'); assert.ok(f.state.held.has('Member'));
  assert.equal(f.state.jobs.get(f.uid).attempts, 1);
  f.state.held.delete('Selection: Gaming'); f.state.held.add('Selection: Tech');
  f.state.due = true; await f.worker.drain();
  assert.deepEqual(f.state.writes, ['Member', 'Gaming']); assert.equal(f.state.jobs.size, 0);
});
test('event arriving during a worker pass is not erased by an older revision', async t => {
  const f = await fixture(t); f.state.onAdd = () => f.worker.enqueue(f.uid);
  await f.worker.enqueue(f.uid); await f.worker.drain();
  assert.equal(f.state.jobs.size, 1); assert.equal(f.state.jobs.get(f.uid).revision, 2);
  await f.worker.drain(); assert.equal(f.state.jobs.size, 0);
  assert.deepEqual(f.state.writes, ['Member', 'Gaming']);
});
test('production multiple-selection alert survives delivery failure and is deduplicated', async t => {
  const f = await fixture(t); f.state.held.add('Selection: Faith'); f.state.failDelivery = true;
  await f.worker.enqueue(f.uid); await f.worker.drain();
  assert.equal(f.state.record, undefined); assert.deepEqual(f.state.writes, []);
  assert.equal(f.state.alerts.length, 1); assert.equal(f.state.alerts[0].delivered_at, undefined);
  f.state.failDelivery = false; await f.worker.enqueue(f.uid); await f.worker.drain();
  assert.equal(f.state.alerts.length, 1); assert.equal(f.state.delivered.length, 1);
  assert.equal(f.state.delivered[0].enforceNonce, true); assert.equal(f.state.alerts[0].delivered_at, 'now');
});
test('startup scan waits for screening and later update initializes safely', async t => {
  const f = await fixture(t); f.state.pending = true; await f.worker.scan();
  assert.equal(f.state.record, undefined); assert.deepEqual(f.state.writes, []);
  f.state.pending = false; await f.worker.enqueue(f.uid); await f.worker.drain();
  assert.deepEqual(f.state.writes, ['Member', 'Gaming']);
});
test('production refuses selection permission/channel drift and arbitrary guilds', async t => {
  const f = await fixture(t); f.roles.get('Selection: Gaming').permissions.bitfield = 8n;
  await assert.rejects(f.worker.reconcile(f.uid)); assert.deepEqual(f.state.writes, []);
  f.roles.get('Selection: Gaming').permissions.bitfield = 0n;
  f.guild.channels.cache.get('review').permissionOverwrites.cache.set('Selection: Gaming', { allow: { bitfield: 1024n } });
  await assert.rejects(f.worker.reconcile(f.uid)); assert.equal(f.state.record, undefined);
  await assert.rejects(createNativeReconciler({ guild: { id: 'other-server' } }, {}));
});