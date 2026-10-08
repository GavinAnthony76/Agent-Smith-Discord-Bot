import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { buildConversationContext } from '../src/conversation-context.js';
import { createLookupMetrics } from '../src/conversation-lookups.js';
import { createConversationLookups } from '../src/conversation-lookups.js';
import { EventEmitter } from 'node:events';
import { createConversationHandlers } from '../src/conversation-handler.js';
import { conversationSettings } from '../src/conversation-settings.js';

function fixture() {
  const guildId = 'g', userId = 'u';
  const permissions = new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.SendMessagesInThreads]);
  const roles = new Map([['member', { id: 'member', name: 'Member' }], ['gaming', { id: 'gaming', name: 'Gaming' }],
    ['wow', { id: 'wow', name: 'Interest: World of Warcraft' }]]);
  const member = { id: userId, user: { id: userId, bot: false }, pending: false, displayName: 'Member', permissions: new PermissionsBitField(0n), roles: { cache: roles } };
  const bot = { id: 'bot', permissions };
  const channels = new Map();
  const add = (id, name, parentId, visible = true, type = 0) => {
    const channel = { id, name, parentId, type, guildId, isThread: () => type === 12,
      permissionsFor: actor => actor.id === 'bot' || visible ? permissions : new PermissionsBitField(0n) };
    channels.set(id, channel); return channel;
  };
  add('gc', 'GAMING', null, true, 4); add('fc', 'FAITH', null, false, 4);
  add('shared', 'general'); add('wow-channel', 'mmo-adventures', 'gc'); add('secret-faith', 'private-faith', 'fc', false);
  const guild = { id: guildId, name: 'Hallowed Core', ownerId: 'owner',
    members: { me: bot, fetch: async () => member, fetchMe: async () => bot },
    roles: { cache: roles, fetch: async () => roles }, channels: { cache: channels, fetch: async id => id ? channels.get(id) : channels } };
  const cfg = { owners: ['owner'], token: 'credential-should-not-appear', databaseUrl: 'private-db' };
  const queries = [];
  const resourceRows = [{ kind: 'role', name: 'Member', discord_id: 'member' }, { kind: 'role', name: 'Gaming', discord_id: 'gaming' },
    { kind: 'role', name: 'Faith', discord_id: 'faith' }, { kind: 'role', name: 'Interest: World of Warcraft', discord_id: 'wow' }];
  const pool = { query: async (sql, args) => {
    assert.match(sql, /^SELECT /);
    assert.equal(args[0], guildId);
    queries.push(sql);
    if (sql.includes('FROM resources')) return { rows: resourceRows };
    if (sql.includes('FROM community_shop')) return { rows: [{ title: 'Community badge', price: 100 }] };
    if (sql.includes('FROM onboarding_state')) return { rows: [{ legacy_enabled: false }] };
    assert.equal(args[1], userId);
    if (sql.includes('FROM community_inventory')) return { rows: [{ title: 'Helpful member badge' }] };
    if (sql.includes('FROM members')) return { rows: [{ accepted_at: new Date(), primary_framework: 'Gaming', private_notes: 'private-moderation-sentinel' }] };
    if (sql.includes('FROM grants')) return { rows: [] };
    if (sql.includes('FROM progression_balances')) return { rows: [{ framework: 'Gaming', xp: 100, faith_approved: 2 }, { framework: 'Faith', xp: 9999, faith_approved: 2 }] };
    throw new Error('Unexpected data source');
  } };
  return { guild, cfg, pool, userId, channelId: 'shared', member, channels, queries };
}

test('member context is read-only, own-profile scoped and excludes hidden frameworks and private data', async () => {
  const f = fixture();
  const context = await buildConversationContext(f);
  assert.deepEqual(context.member.frameworks, ['Gaming']);
  assert.deepEqual(context.member.interests, ['World of Warcraft']);
  assert.equal(context.member.progression.length, 1);
  assert.equal(context.member.progression[0].xp, 100);
  assert.ok(context.channels.some(channel => channel.id === 'wow-channel'));
  for (const forbidden of ['credential-should-not-appear', 'private-db', 'private-moderation-sentinel', 'private-faith', '9999'])
    assert.equal(JSON.stringify(context).includes(forbidden), false, forbidden);
  assert.equal(f.queries.some(sql => /moderation|cases|warnings/.test(sql)), false);
});

test('unsafe members/channels fail closed and unjoined private threads are not enumerated', async () => {
  const f = fixture();
  f.channels.set('private-thread', { id: 'private-thread', guildId: 'g', type: 12, name: 'secret thread',
    isThread: () => true, permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory]) });
  const context = await buildConversationContext(f);
  assert.equal(context.channels.some(channel => channel.id === 'private-thread'), false);
  f.member.pending = true;
  await assert.rejects(buildConversationContext(f), /not eligible/);
  f.member.pending = false;
  await assert.rejects(buildConversationContext({ ...f, channelId: 'secret-faith' }), /not authorized/);
});

test('a visible framework role without a recorded approval does not invent crossover consent', async () => {
  const f = fixture();
  f.member.roles.cache.delete('gaming');
  const context = await buildConversationContext(f);
  assert.deepEqual(context.member.frameworks, []);
  assert.equal(context.channels.some(channel => channel.id === 'wow-channel'), false);
  assert.equal(context.member.progression.length, 0);
});

test('private-thread context requires actual membership, not only inherited View Channel', async () => {
  const f = fixture();
  const thread = { id: 'thread', name: 'private discussion', guildId: 'g', type: 12,
    isThread: () => true, parentId: 'wow-channel',
    permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads]),
    members: { fetch: async () => { throw new Error('not joined'); } } };
  f.channels.set('thread', thread);
  await assert.rejects(buildConversationContext({ ...f, channelId: 'thread' }), /not joined/);
});

test('content-free baseline measures two context builds per answer before metadata reuse', async () => {
  const f = fixture();
  f.guild.scheduledEvents = { fetch: async () => new Map() };
  const lookups = createLookupMetrics();
  for (let i = 0; i < 6; i++) await buildConversationContext({ ...f, lookups });
  const metrics = lookups.snapshot();
  assert.equal(metrics.member.requests, 6);
  assert.equal(metrics.roles.requests, 6);
  assert.equal(metrics.channels.requests, 6);
  assert.equal(metrics.events.requests, 6);
  assert.equal(metrics.database.requests, 36);
  assert.equal(metrics.rewards.requests, 6);
  assert.ok(Object.values(metrics).every(metric => metric.latencyMs >= 0));
  console.log('Offline lookup baseline (3 answers, before reuse):', JSON.stringify(metrics));
});

test('overlapping contexts batch fresh shared reads, never caller roles/approval; repeated reads save public shop queries', async () => {
  const f = fixture();
  const client = new EventEmitter();
  f.guild.scheduledEvents = { fetch: async () => new Map() };
  const lookups = createConversationLookups({ client, guild: f.guild });
  const build = () => lookups.run(scope => buildConversationContext({ ...f, lookups: scope }));
  const pairs = await Promise.all([build(), build()]);
  assert.notEqual(pairs[0], pairs[1]);
  assert.deepEqual(pairs[0], pairs[1]);
  await build(); // Cannot reuse authorization results from the completed burst.
  const measured = lookups.snapshot();
  assert.equal(measured.reads.member.requests, 3);
  assert.equal(measured.reads.botMember.requests, 3);
  assert.equal(measured.reads.roles.requests, 2);
  assert.equal(measured.reads.channels.requests, 2);
  assert.equal(measured.reads.events.requests, 2);
  assert.equal(measured.coalesced, 4);
  assert.equal(measured.cacheHits, 1);
  assert.equal(f.queries.filter(sql => sql.includes('FROM grants')).length, 3);
  assert.equal(f.queries.filter(sql => sql.includes('FROM resources')).length, 3);
  assert.equal(f.queries.filter(sql => sql.includes('FROM community_shop')).length, 1);
  console.log('Offline optimized overlapping lookup sample:', JSON.stringify(measured));
  lookups.stop();
});

test('cached public rewards do not retain member data or authorize a revoked framework', async () => {
  const f = fixture();
  const lookups = createConversationLookups({ guild: f.guild });
  const build = () => lookups.run(scope => buildConversationContext({ ...f, lookups: scope }));
  const original = await build();
  const query = f.pool.query;
  f.pool.query = (sql, args) => sql.includes('FROM members') ?
    Promise.resolve({ rows: [{ primary_framework: 'Gaming', accepted_at: null }] }) : query(sql, args);
  const revoked = await build();
  assert.deepEqual(revoked.member.frameworks, []);
  assert.equal(revoked.channels.some(c => c.id === 'wow-channel'), false);
  assert.notEqual(original.accessSignature, revoked.accessSignature);
  assert.equal(lookups.snapshot().cacheHits, 1);
  lookups.stop();
});

test('deleted SDK cache entries are not disclosed and metadata changes change the authorization signature', async () => {
  const f = fixture();
  const original = await buildConversationContext(f);
  f.channels.get('wow-channel').topic = 'updated topic';
  const updated = await buildConversationContext(f);
  assert.notEqual(original.accessSignature, updated.accessSignature);
  f.guild.channels.fetch = async (id, options) => {
    if (id) { assert.equal(options.force, true); return null; }
    return new Map([...f.channels].filter(([key]) => key !== 'wow-channel'));
  };
  const withoutDeleted = await buildConversationContext(f);
  assert.equal(withoutDeleted.channels.some(c => c.id === 'wow-channel'), false);
  assert.ok(f.guild.channels.cache.has('wow-channel')); // Deliberately stale SDK cache.
  await assert.rejects(buildConversationContext({ ...f, channelId: 'wow-channel' }), /freshness|authorized/);
});

test('private thread and both actors membership are force-fetched again after a membership revocation', async () => {
  const f = fixture();
  let joined = true, reads = 0, threadReads = 0;
  const thread = { id: 'thread', parentId: 'wow-channel', name: 'private', guildId: 'g', type: 12,
    isThread: () => true,
    permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads]),
    members: { fetch: async options => {
      assert.equal(options.force, true); reads++;
      return joined ? { id: options.member } : null;
    } } };
  const fetch = f.guild.channels.fetch;
  f.guild.channels.fetch = async (id, options) => {
    if (id === 'thread') { threadReads++; assert.equal(options.force, true); return thread; }
    return fetch(id);
  };
  const args = { ...f, channelId: 'thread' };
  const initial = await buildConversationContext(args);
  assert.ok(initial.channels.some(c => c.id === 'thread'));
  assert.equal(reads, 2);
  joined = false;
  await assert.rejects(buildConversationContext(args), /membership/);
  assert.equal(threadReads, 2);
  assert.equal(reads, 3);
});

test('bot permission revocation is refreshed rather than authorized using guild.members.me', async () => {
  const f = fixture();
  let reads = 0;
  f.guild.members.fetchMe = async options => {
    assert.equal(options.force, true); reads++;
    return { id: 'revoked-bot', permissions: new PermissionsBitField(0n) };
  };
  f.channels.get('shared').permissionsFor = actor => actor.id === 'revoked-bot' ?
    new PermissionsBitField(0n) : new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory, P.SendMessages]);
  await assert.rejects(buildConversationContext(f), /not authorized/);
  assert.equal(reads, 1);
});

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function handlerFixture(f, options = {}) {
  const outputs = [];
  let cleared = 0, answers = 0;
  const model = deferred(), started = deferred();
  const service = { reserve: () => ({ allowed: true }), stop() {},
    clear() { cleared++; },
    answer: async () => { answers++; started.resolve(); return model.promise; } };
  const channel = f.channels.get(f.channelId);
  channel.sendTyping = async () => {};
  const message = { id: 'request', guildId: f.guild.id, channelId: f.channelId, channel,
    author: { id: f.userId, bot: false }, content: '<@999> Explain server events',
    reply: async payload => { outputs.push(payload); return { id: 'reply' }; } };
  const client = new EventEmitter();
  const handlers = createConversationHandlers({ ...f, client, cfg: { ...f.cfg, clientId: '999' } },
    { settings: conversationSettings({}), service, lookupOptions: options });
  return { handlers, message, outputs, model, started, client, get cleared() { return cleared; }, get answers() { return answers; } };
}

test('actual fresh pre-send context suppresses an AI answer after channel access is revoked', async () => {
  const f = fixture();
  f.channelId = 'wow-channel';
  const h = handlerFixture(f);
  const handling = h.handlers.handleMessage(h.message);
  await h.started.promise;
  f.member.roles.cache.delete('gaming');
  h.client.emit('guildMemberUpdate', { guild: f.guild });
  h.model.resolve('Private gaming direction from the old context');
  await handling;
  assert.equal(h.outputs.length, 0);
  assert.equal(h.cleared, 1);
  h.handlers.stop();
});

test('a timed-out member lookup cannot later call the model or send any response', async () => {
  const f = fixture();
  const pending = deferred();
  f.guild.members.fetch = () => pending.promise;
  const h = handlerFixture(f, { timeoutMs: 15 });
  await h.handlers.handleMessage(h.message);
  assert.equal(h.answers, 0);
  pending.resolve(f.member);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.answers, 0);
  assert.equal(h.outputs.length, 0);
  assert.equal(h.cleared, 1);
  h.handlers.stop();
});

test('a timed-out pre-send lookup cannot leak a generated answer on late completion', async () => {
  const f = fixture();
  const pending = deferred();
  let reads = 0;
  f.guild.members.fetch = async () => ++reads === 1 ? f.member : pending.promise;
  const h = handlerFixture(f, { timeoutMs: 25 });
  const handling = h.handlers.handleMessage(h.message);
  await h.started.promise;
  h.model.resolve('Generated private information');
  await handling;
  pending.resolve(f.member);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.outputs.length, 0);
  assert.equal(h.cleared, 1);
  h.handlers.stop();
});

test('shutdown during generation prevents a late reply', async () => {
  const f = fixture();
  const h = handlerFixture(f);
  const handling = h.handlers.handleMessage(h.message);
  await h.started.promise;
  h.handlers.stop();
  h.model.resolve('Late answer');
  await handling;
  assert.equal(h.outputs.length, 0);
  assert.equal(h.cleared, 1);
});

test('same-guild concurrent users share only metadata, not members or recorded approvals', async () => {
  const f = fixture();
  const other = { ...f.member, id: 'other', displayName: 'Other member',
    user: { id: 'other', bot: false }, roles: { cache: new Map([['member', f.member.roles.cache.get('member')]]) } };
  f.guild.members.fetch = async ({ user, force }) => {
    assert.equal(force, true);
    return user === f.userId ? f.member : other;
  };
  const query = f.pool.query;
  f.pool.query = (sql, args) => {
    if (args[1] === 'other') return Promise.resolve({ rows: [] });
    return query(sql, args);
  };
  const lookups = createConversationLookups({ guild: f.guild });
  const [approved, unapproved] = await Promise.all([
    lookups.run(scope => buildConversationContext({ ...f, lookups: scope })),
    lookups.run(scope => buildConversationContext({ ...f, userId: 'other', lookups: scope })),
  ]);
  assert.deepEqual(approved.member.frameworks, ['Gaming']);
  assert.deepEqual(unapproved.member.frameworks, []);
  assert.equal(unapproved.channels.some(c => c.id === 'wow-channel'), false);
  assert.equal(unapproved.member.cosmeticBadges.length, 0);
  assert.equal(lookups.snapshot().reads.roles.requests, 1);
  assert.equal(lookups.snapshot().reads.member.requests, 2);
  lookups.stop();
});

test('invalidation between multipart replies prevents remaining old-context fragments', async () => {
  const f = fixture();
  const h = handlerFixture(f);
  h.message.reply = async payload => {
    h.outputs.push(payload);
    h.client.emit('channelUpdate', { guild: f.guild });
    return { id: 'first-fragment' };
  };
  const handling = h.handlers.handleMessage(h.message);
  await h.started.promise;
  h.model.resolve('Safe initial answer. '.repeat(200));
  await handling;
  assert.equal(h.outputs.length, 1);
  assert.equal(h.cleared, 1);
  h.handlers.stop();
});
