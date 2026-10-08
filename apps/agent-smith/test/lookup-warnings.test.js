import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLookupWarnings } from '../src/lookup-warnings.js';
import { createLookupWarningStore } from '../src/lookup-warning-store.js';
import { lookupWarningSettings, lookupWarningContent, isLookupWarningContent } from '../src/lookup-warning-policy.js';
import { createSmithControl, smithControlCommand } from '../src/smith-control.js';
import { createConversationLookups, createLookupMetrics } from '../src/conversation-lookups.js';
import { createConversationHandlers } from '../src/conversation-handler.js';
import { conversationSettings } from '../src/conversation-settings.js';
import { installSecurityGate } from '../src/security-gate.js';
import { withLookupWarningNotification, mutationScope } from '../src/security-policy.js';

const owner = '100000000000000001', member = '100000000000000002', guildId = '1556423230590423042';
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
function fixture({ enabled = false } = {}) {
  let time = 0, nextAttempt = 0;
  let saved = { enabled, threshold: 5, cooldownMinutes: 15, approvedOwner: owner };
  const counts = { timeouts: 0, backoffRefusals: 0 };
  const sent = [], attempts = [];
  const cfg = { owners: [owner], ownerDiscordId: owner };
  const guild = { id: guildId, ownerId: owner, async fetch() { return guild; } };
  const store = {
    async settings() { return { ...saved }; },
    async configure(value, actor) { saved = { ...value, approvedOwner: actor }; return { ...saved }; },
    async reserve(minutes) {
      if (time < nextAttempt) return false;
      nextAttempt = time + minutes * 60000;
      attempts.push(time);
      return true;
    },
  };
  const recipient = { bot: false, async send(payload) {
    assert.equal(mutationScope().source, 'conversation-lookups');
    await mutationScope().authorize();
    sent.push(payload);
  } };
  const client = { users: { async fetch(id) { assert.equal(id, owner); return recipient; } } };
  const warnings = createLookupWarnings({ client, guild, cfg, store, now: () => time, snapshot: () => ({ ...counts }) });
  return { counts, sent, attempts, warnings, cfg, guild, store, recipient, client,
    advance(ms = 60000) { time += ms; }, setSaved(value) { saved = value; } };
}

test('defaults, Owner command bounds and fixed content reject unsafe or unbounded settings/data', () => {
  assert.deepEqual(lookupWarningSettings(), { enabled: false, threshold: 5, cooldownMinutes: 60 });
  for (const patch of [{ enabled: 'true' }, { threshold: 4 }, { threshold: 101 }, { threshold: Infinity },
    { cooldownMinutes: 14 }, { cooldownMinutes: 1441 }, { cooldownMinutes: 15.5 }]) {
    assert.throws(() => lookupWarningSettings({ ...lookupWarningSettings(), ...patch }));
  }
  const command = smithControlCommand.toJSON().options.find(value => value.name === 'lookup-warnings');
  assert.equal(command.options[0].required, true);
  assert.equal(command.options[1].min_value, 5);
  assert.equal(command.options[1].max_value, 100);
  assert.equal(command.options[2].min_value, 15);
  assert.equal(command.options[2].max_value, 1440);
  const content = lookupWarningContent({ timeouts: 5, backoffRefusals: 1, prompt: 'PRIVATE', sql: 'SELECT secret', memberId: member });
  assert.equal(isLookupWarningContent(content), true);
  assert.doesNotMatch(content, /PRIVATE|SELECT secret|100000000000000002/);
  assert.equal(isLookupWarningContent(content + '\nPRIVATE'), false);
  assert.equal(isLookupWarningContent(content.replace('timeouts=5', 'timeouts=1000001')), false);
  assert.throws(() => lookupWarningContent({ timeouts: 'private', backoffRefusals: 1 }));
});

test('disabled stays quiet, enabling discards historical failures, and combined recent failures cross threshold once', async t => {
  const f = fixture();
  t.after(() => f.warnings.stop());
  f.counts.timeouts = 50;
  await f.warnings.poll();
  f.advance();
  f.counts.backoffRefusals = 50;
  await f.warnings.poll();
  assert.equal(f.sent.length, 0);
  await f.warnings.configure({ enabled: true, threshold: 5, cooldownMinutes: 15 }, owner);
  f.advance(); f.counts.timeouts += 2;
  await f.warnings.poll();
  assert.equal(f.sent.length, 0);
  f.advance(); f.counts.backoffRefusals += 3;
  await f.warnings.poll();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /timeouts=2; backoff_refusals=3/);
  assert.deepEqual(f.sent[0].allowedMentions, { parse: [] });
  f.advance(); f.counts.timeouts += 20;
  await Promise.all([f.warnings.poll(), f.warnings.poll()]);
  assert.equal(f.sent.length, 1);
  f.advance(15 * 60000);
  await f.warnings.poll(); // no old interval contributes
  assert.equal(f.sent.length, 1);
  f.advance(); f.counts.timeouts += 5;
  await f.warnings.poll();
  assert.equal(f.sent.length, 2);
});

test('rolling window expires isolated failures and ignores events while paused or after shutdown', async t => {
  const f = fixture({ enabled: true });
  t.after(() => f.warnings.stop());
  await f.warnings.poll();
  f.advance(); f.counts.timeouts = 4;
  await f.warnings.poll();
  for (let i = 0; i < 6; i++) { f.advance(); await f.warnings.poll(); }
  f.advance(); f.counts.timeouts++;
  await f.warnings.poll();
  assert.equal(f.sent.length, 0);
  f.advance(10 * 60000); f.counts.timeouts += 100;
  await f.warnings.poll();
  assert.equal(f.sent.length, 0);
  f.warnings.stop();
  f.advance(); f.counts.timeouts += 100;
  await f.warnings.poll();
  assert.equal(f.sent.length, 0);
});

test('failed or uncertain delivery consumes cooldown and is never retried immediately', async t => {
  const f = fixture({ enabled: true });
  t.after(() => f.warnings.stop());
  let sends = 0;
  f.recipient.send = async () => { sends++; throw new Error('PRIVATE provider payload SQL member/channel identifiers'); };
  await f.warnings.poll();
  f.advance(); f.counts.timeouts = 5;
  await f.warnings.poll();
  f.advance(); f.counts.timeouts += 5;
  await f.warnings.poll();
  assert.equal(sends, 1);
  assert.deepEqual(f.warnings.status(), { enabled: true, attempts: 1, sent: 0, failed: 1, checksFailed: 0 });
  assert.doesNotMatch(JSON.stringify(f.warnings.status()), /PRIVATE|SQL|member/);
});

test('cooldown persists across notifier restart and database failures fail closed', async t => {
  const f = fixture({ enabled: true });
  t.after(() => f.warnings.stop());
  await f.warnings.poll();
  f.advance(); f.counts.timeouts = 5;
  await f.warnings.poll();
  assert.equal(f.sent.length, 1);
  f.warnings.stop();
  const restarted = createLookupWarnings({ ...f, snapshot: () => f.counts });
  t.after(() => restarted.stop());
  await restarted.poll();
  f.counts.timeouts += 10;
  await restarted.poll();
  assert.equal(f.sent.length, 1);
  f.store.settings = async () => { throw new Error('PRIVATE SQL'); };
  f.counts.timeouts += 10;
  await restarted.poll();
  assert.equal(f.sent.length, 1);
  assert.equal(restarted.status().checksFailed, 1);
});

test('fresh actual Owner, consent and human recipient checks block delivery without fallbacks', async t => {
  for (const mutate of [
    f => { f.guild.ownerId = member; },
    f => { f.cfg.owners = []; },
    f => { f.cfg.ownerDiscordId = member; },
    f => { f.guild.fetch = async () => { throw new Error('private'); }; },
    f => { f.recipient.bot = true; },
    f => { f.setSaved({ enabled: true, threshold: 5, cooldownMinutes: 15, approvedOwner: member }); },
  ]) {
    const f = fixture({ enabled: true });
    t.after(() => f.warnings.stop());
    await f.warnings.poll();
    mutate(f);
    f.advance(); f.counts.timeouts = 5;
    await f.warnings.poll();
    assert.equal(f.sent.length, 0);
  }
});

test('disable or stop while a recipient lookup is in flight suppresses the later DM', async t => {
  for (const action of ['disable', 'stop']) {
    const f = fixture({ enabled: true });
    t.after(() => f.warnings.stop());
    await f.warnings.poll();
    const started = deferred(), response = deferred();
    f.client.users.fetch = async () => { started.resolve(); return response.promise; };
    f.advance(); f.counts.timeouts = 5;
    const pending = f.warnings.poll();
    await started.promise;
    if (action === 'disable') await f.warnings.configure({ enabled: false, threshold: 5, cooldownMinutes: 15 }, owner);
    else f.warnings.stop();
    response.resolve(f.recipient);
    await pending;
    assert.equal(f.sent.length, 0);
    assert.equal(f.attempts.length, 1);
  }
});

test('consent changed by another process during the final Owner read blocks the eventual send', async t => {
  const f = fixture({ enabled: true });
  t.after(() => f.warnings.stop());
  await f.warnings.poll();
  const started = deferred(), response = deferred();
  let waiting;
  f.recipient.send = async payload => {
    f.guild.fetch = async () => { started.resolve(); await response.promise; return f.guild; };
    waiting = mutationScope().authorize();
    await waiting;
    f.sent.push(payload);
  };
  f.advance(); f.counts.timeouts = 5;
  const pending = f.warnings.poll();
  await started.promise;
  f.setSaved({ enabled: false, threshold: 5, cooldownMinutes: 15, approvedOwner: owner });
  response.resolve();
  await pending;
  assert.equal(f.sent.length, 0);
  assert.equal(f.warnings.status().failed, 1);
});

test('settings are transactional/audited and invalid settings never reach persistence', async () => {
  const queries = [];
  const db = { async query(sql, args) { queries.push({ sql, args }); return { rows: [] }; }, release() { queries.push('release'); } };
  const store = createLookupWarningStore({ guildId, pool: { async connect() { return db; }, query: db.query } });
  await store.configure({ enabled: true, threshold: 5, cooldownMinutes: 15 }, owner);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-2).sql, 'COMMIT');
  assert.equal(queries.at(-1), 'release');
  assert.equal(queries[2].args[2], 'settings.changed');
  queries.length = 0;
  await assert.rejects(store.configure({ enabled: true, threshold: 0, cooldownMinutes: 1 }, owner));
  assert.equal(queries.length, 0);
  db.query = async (sql) => {
    queries.push(sql);
    if (sql.startsWith('INSERT INTO audit')) throw new Error('offline');
    return { rows: [] };
  };
  await assert.rejects(store.configure({ enabled: false, threshold: 5, cooldownMinutes: 15 }, owner));
  assert.ok(queries.includes('ROLLBACK'));
});

test('lookup warning controls require human actual Owner, target server and controls channel', async () => {
  let configured = 0;
  const guild = { id: guildId, ownerId: owner, async fetch() { return guild; } };
  const cfg = { owners: [owner, member], ownerDiscordId: owner };
  const control = createSmithControl({ guild, cfg, pool: {}, resource: async () => 'controls',
    lookupWarnings: { async configure(value, actor) { configured++; assert.equal(actor, owner); return value; } } });
  for (const patch of [
    { user: { id: member, bot: false } }, { channelId: 'general' }, { guildId: 'foreign' },
    { user: { id: owner, bot: true } }, {},
  ]) {
    const replies = [];
    const i = { guildId, user: { id: owner, bot: false }, channelId: 'controls',
      options: { getSubcommand: () => 'lookup-warnings', getBoolean: () => true, getInteger: () => null },
      async deferReply(payload) { assert.equal(payload.flags, 64); i.deferred = true; },
      async editReply(payload) { replies.push(payload); }, async reply(payload) { replies.push(payload); }, ...patch };
    await control.handle(i);
    assert.match(replies[0].content, Object.keys(patch).length ? /Unable to complete/ : /private Owner DM only/);
  }
  assert.equal(configured, 1);
});

test('Owner control status and failed saves never disclose warning consent identities or storage errors', async () => {
  const replies = [];
  const guild = { id: guildId, ownerId: owner, async fetch() { return guild; } };
  const cfg = { owners: [owner], ownerDiscordId: owner };
  const control = createSmithControl({ guild, cfg, resource: async () => 'controls',
    pool: { async query() { return { rows: [{ key: 'conversation-lookup-warnings',
      value: { enabled: true, threshold: 5, cooldownMinutes: 15, approvedOwner: owner } }] }; } },
    lookupWarnings: { async configure() { throw new Error('PRIVATE SQL SELECT secret'); } } });
  let sub = 'status';
  const i = { guildId, channelId: 'controls', user: { id: owner, bot: false },
    options: { getSubcommand: () => sub, getBoolean: () => true, getInteger: () => null },
    async deferReply() { i.deferred = true; }, async editReply(payload) { replies.push(payload); } };
  await control.handle(i);
  sub = 'lookup-warnings';
  await control.handle(i);
  assert.match(replies[0].content, /"threshold":5/);
  assert.match(replies[1].content, /no change is confirmed/);
  for (const reply of replies) assert.doesNotMatch(reply.content, /100000000000000001|PRIVATE|SQL|SELECT secret/);
});

test('lookup counters only classify blocked REST attempts, never mere SDK events or capacity refusals', async t => {
  let time = 0;
  const client = new EventEmitter();
  client.rest = new EventEmitter();
  const lookups = createConversationLookups({ client, guild: { id: guildId }, now: () => time, maxStarts: 1 });
  t.after(() => lookups.stop());
  client.rest.emit('rateLimited', { retryAfter: 1000, url: '/PRIVATE/channel/member', payload: 'private' });
  assert.equal(lookups.snapshot().backoffRefusals, 0);
  await assert.rejects(lookups.run(() => 'answer'));
  assert.equal(lookups.snapshot().backoffRefusals, 1);
  time = 2000;
  await lookups.run(() => 'answer');
  await assert.rejects(lookups.run(() => 'answer'));
  assert.equal(lookups.snapshot().backoffRefusals, 1);
  assert.doesNotMatch(JSON.stringify(lookups.snapshot()), /PRIVATE|private|member/);
  const metrics = createLookupMetrics();
  await assert.rejects(metrics.read('PRIVATE prompt/channel identifier', () => assert.fail('must not read')));
  assert.deepEqual(metrics.snapshot(), {});
});

test('a deadline checked before the timer and REST backoff during a build are each counted once', async t => {
  let time = 0;
  const client = new EventEmitter();
  client.rest = new EventEmitter();
  const lookups = createConversationLookups({ client, guild: { id: guildId }, now: () => time, timeoutMs: 1000 });
  t.after(() => lookups.stop());
  await assert.rejects(lookups.run(async scope => {
    await scope.read('member', async () => { time = 1001; });
  }), /deadline/);
  assert.equal(lookups.snapshot().timeouts, 1);
  await assert.rejects(lookups.run(async scope => {
    await scope.read('member', async () => client.rest.emit('rateLimited', { retryAfter: 1000 }));
  }), /freshness/);
  assert.equal(lookups.snapshot().backoffRefusals, 1);
  assert.equal(lookups.snapshot().timeouts, 1);
});

test('real message lookups time out safely, expose aggregate status privately, and feed Owner warnings only', async t => {
  const f = fixture();
  const client = new EventEmitter();
  client.users = f.client.users;
  const guild = { ...f.guild, members: { me: {} } };
  let answered = 0, replies = 0, id = 0;
  const service = { reserve: () => ({ allowed: true }), answer: async () => { answered++; return 'PRIVATE ANSWER'; },
    clear() {}, stop() {}, status: () => ({ enabled: true }) };
  const response = deferred();
  const handlers = createConversationHandlers({ client, guild, cfg: { ...f.cfg, clientId: '999' }, pool: {} }, {
    settings: conversationSettings({ AI_ENABLED: 'false' }), service,
    lookupOptions: { timeoutMs: 5, maxActive: 10 },
    warningOptions: { store: f.store, now: () => 60000 },
    buildContext: args => args.lookups.read('database', () => response.promise),
  });
  t.after(() => { response.resolve('late private context'); handlers.stop(); });
  await handlers.lookupWarnings.configure({ enabled: true, threshold: 5, cooldownMinutes: 15 }, owner);
  for (let i = 0; i < 5; i++) {
    await handlers.handleMessage({ id: String(++id), guildId, channelId: 'PRIVATE_CHANNEL', author: { id: member },
      content: '<@999> PRIVATE PROMPT', channel: {}, reply: async () => { replies++; } });
  }
  await handlers.lookupWarnings.poll();
  assert.equal(answered, 0);
  assert.equal(replies, 0);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /timeouts=5; backoff_refusals=0/);
  assert.doesNotMatch(f.sent[0].content, /PRIVATE|100000000000000002/);
  const status = [];
  service.status = () => ({ enabled: true, model: 'test' });
  await handlers.appendStatus({ user: { id: owner }, followUp: async p => status.push(p) });
  await handlers.appendStatus({ user: { id: member }, followUp: async p => status.push(p) });
  assert.equal(status[0].flags, 64);
  assert.match(status[0].content, /Lookup warning health/);
  assert.doesNotMatch(status[1].content, /Lookup warning health|Lookup metrics/);
});

test('security gate accepts only exact aggregate Owner DMs and rechecks consent at both writes', async () => {
  const forwarded = [];
  let consent = true;
  const cfg = { ownerDiscordId: owner, owners: [owner] };
  const guild = { id: guildId, ownerId: owner, async fetch() { return guild; } };
  let target = { recipientId: owner };
  const client = { rest: { async request(request) { forwarded.push(request); } },
    channels: { async fetch() { return target; } } };
  installSecurityGate({ client, guild, cfg });
  const content = lookupWarningContent({ timeouts: 5, backoffRefusals: 0 });
  const authorize = async () => { if (!consent) throw new Error('disabled'); };
  const scope = fn => withLookupWarningNotification(owner, content, authorize, fn);
  const createDM = () => client.rest.request({ method: 'POST', fullRoute: '/users/@me/channels', body: { recipient_id: owner } });
  const send = patch => client.rest.request({ method: 'POST', fullRoute: '/channels/200000000000000001/messages',
    body: { content, allowed_mentions: { parse: [] }, ...patch } });
  await scope(createDM);
  await scope(() => send());
  assert.equal(forwarded.length, 2);
  for (const patch of [{ content: content + '\nPRIVATE' }, { embeds: [{ description: 'private' }] },
    { allowed_mentions: { parse: ['everyone'] } }, { components: [{}] }, { poll: { question: 'private' } },
    { attachments: [{ filename: 'private' }] }]) await assert.rejects(scope(() => send(patch)));
  target = { recipientId: member };
  await assert.rejects(scope(() => send()));
  target = { guildId, recipientId: owner };
  await assert.rejects(scope(() => send()), /DM only/);
  target = { recipientId: owner };
  consent = false;
  await assert.rejects(scope(createDM));
  await assert.rejects(scope(() => send()));
  consent = true; guild.ownerId = member;
  await assert.rejects(scope(() => send()));
  assert.equal(forwarded.length, 2);
  assert.throws(() => withLookupWarningNotification(owner, content + '\nPRIVATE', authorize, () => {}));
  assert.equal(mutationScope(), undefined);
});
