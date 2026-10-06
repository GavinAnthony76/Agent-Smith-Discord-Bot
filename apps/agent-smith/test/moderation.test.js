import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { Confirmations, assertModerator, assertTarget, purgeCandidates, validReason } from '../src/moderation-policy.js';
import { moderationCommand } from '../src/moderation-commands.js';
import { createModeration } from '../src/moderation.js';
import { SpamDetector, createAntiSpam } from '../src/antispam.js';

const rank = value => ({ comparePositionTo: other => value - other.rank, rank: value });
const member = (id, position, permissions = []) => ({
  id, user: { bot: false }, roles: { highest: rank(position) }, permissions: new PermissionsBitField(permissions)
});
test('moderation excludes framework reviewers, protects owners/bots/self and respects role hierarchy', () => {
  const cfg = { owners: ['owner'], approvers: ['reviewer'] };
  assert.doesNotThrow(() => assertModerator('owner', cfg));
  assert.throws(() => assertModerator('reviewer', cfg));
  assert.throws(() => assertModerator('member', cfg));
  const context = { actor: member('owner', 10), bot: member('bot', 9), target: member('member', 1),
    guildOwnerId: 'owner', owners: ['owner'], operation: 'timeout' };
  assert.doesNotThrow(() => assertTarget(context));
  for (const target of [member('owner', 1), { ...member('robot', 1), user: { bot: true } },
    member('high', 10), member('admin', 1, [P.Administrator])]) {
    assert.throws(() => assertTarget({ ...context, target }));
  }
  assert.throws(() => assertTarget({ ...context, actor: member('second-owner', 1), target: member('high', 2) }));
});

test('confirmations bind owner, server and channel; expire; cannot be replayed or stolen', () => {
  let time = 0;
  const store = new Confirmations({ now: () => time, id: () => '11111111-1111-4111-8111-111111111111' });
  const context = { actorId: 'owner', guildId: 'guild', channelId: 'control' };
  const token = store.create({ operation: 'ban' }, context);
  assert.throws(() => store.consume(token, { ...context, actorId: 'other-owner' }));
  assert.throws(() => store.consume(token, { ...context, channelId: 'elsewhere' }));
  assert.throws(() => store.consume(token, { ...context, guildId: 'elsewhere' }));
  assert.equal(store.consume(token, context).operation, 'ban');
  assert.throws(() => store.consume(token, context));
  const expired = store.create({}, context); time = 120000;
  assert.throws(() => store.consume(expired, context));
});

test('cleanup skips pinned and old messages; reasons are mandatory and bounded', () => {
  const now = 20 * 86400000;
  const messages = new Map([
    ['new', { id: 'new', createdTimestamp: now - 1000, pinned: false }],
    ['pinned', { id: 'pinned', createdTimestamp: now - 1000, pinned: true }],
    ['old', { id: 'old', createdTimestamp: now - 14 * 86400000, pinned: false }]
  ]);
  assert.deepEqual(purgeCandidates(messages, now).map(message => message.id), ['new']);
  for (const reason of ['', ' ', 'a'.repeat(401)]) assert.throws(() => validReason(reason));
  assert.equal(validReason(' reason '), 'reason');
});

test('full toolkit serializes, owner visibility defaults are restrictive, and reasons/limits are explicit', () => {
  const command = moderationCommand.toJSON();
  assert.equal(command.default_member_permissions, P.Administrator.toString());
  assert.equal(command.dm_permission, false);
  assert.deepEqual(command.options.map(option => option.name).sort(),
    ['warn', 'history', 'unwarn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge', 'status', 'antispam'].sort());
  for (const option of command.options.filter(option => !['history', 'status'].includes(option.name))) {
    assert.equal(option.options.find(value => value.name === 'reason').required, true);
  }
  assert.equal(command.options.find(option => option.name === 'timeout').options.find(option => option.name === 'minutes').max_value, 40320);
});

test('anti-spam identifies bursts/mass mentions, throttles alerts, and never needs message content', () => {
  let time = 0;
  const detector = new SpamDetector({ now: () => time });
  const message = { guildId: 'guild', author: { id: 'member' }, mentions: { users: { size: 0 } } };
  for (let index = 0; index < 5; index++) assert.equal(detector.observe(message), null);
  assert.match(detector.observe(message).reasons[0], /6 messages/);
  assert.equal(detector.observe(message), null);
  time = 61000;
  assert.match(detector.observe({ ...message, mentions: { everyone: true } }).reasons[0], /Mass mention/);
  assert.equal(detector.observe({ ...message, mentions: { users: { size: 10 } } }), null);
});

test('anti-spam writes audit + private alert but never deletes, times out or changes roles; config persists', async () => {
  const writes = [], sent = [];
  const pool = { query: async (sql, params) => {
    if (sql.startsWith('SELECT')) return { rows: [{ detail: { enabled: true } }] };
    writes.push({ sql, params }); return { rows: [{ id: 42 }] };
  } };
  const guild = { id: 'guild', roles: { everyone: {} }, channels: { fetch: async () => ({
    permissionsFor: () => new PermissionsBitField([]), send: async payload => sent.push(payload)
  }) } };
  const spam = await createAntiSpam({ guild, cfg: { owners: ['owner'], clientId: 'bot' }, pool, resource: async () => 'staff' });
  const message = { guildId: 'guild', channelId: 'lounge', id: 'message', author: { id: 'member', bot: false },
    mentions: { everyone: true }, delete: () => assert.fail('must not delete') };
  await spam.handleMessage({ ...message, author: { id: 'owner' } });
  await spam.handleMessage({ ...message, author: { id: 'bot', bot: true } });
  assert.equal(writes.length, 0);
  await spam.handleMessage(message);
  assert.equal(writes[0].params[2], 'mod.spam-alert');
  assert.match(sent[0].content, /no messages deleted/);
  assert.deepEqual(sent[0].allowedMentions.parse, []);
  spam.setEnabled(false); await spam.handleMessage(message);
  assert.equal(writes.length, 1);
  const disabled = await createAntiSpam({ guild, cfg: { owners: [], clientId: 'bot' },
    pool: { query: async () => ({ rows: [{ detail: { enabled: false } }] }) }, resource: async () => 'staff' });
  assert.equal(disabled.status().enabled, false);
});

test('destructive command makes no change until its requesting owner confirms; audit intent precedes effect', async () => {
  const order = [], replies = [];
  const owner = member('owner', 10, [P.Administrator]);
  const bot = member('bot', 9, [P.KickMembers]);
  const target = { ...member('member', 1), kick: async () => order.push('kick') };
  const guild = { id: 'guild', ownerId: 'owner', roles: { everyone: {} }, members: {
    fetch: async ({ user }) => user === 'owner' ? owner : target, fetchMe: async () => bot
  }, channels: { fetch: async () => ({ permissionsFor: () => new PermissionsBitField([]), send: async () => {} }) } };
  const pool = { query: async (sql, params) => {
    if (sql.startsWith('INSERT')) order.push(params[2]);
    return { rows: [{ id: order.length }] };
  } };
  pool.connect = async () => ({ release() {}, query: async (sql, params) =>
    sql.startsWith('SELECT id FROM audit') ? { rows: [] } : pool.query(sql, params) });
  const mod = createModeration({ guild, cfg: { owners: ['owner'], clientId: 'bot' }, pool,
    resource: async (kind, name) => name, spam: { status: () => ({ enabled: true }) } });
  const base = { guildId: 'guild', channelId: 'smith-controls', user: { id: 'owner', bot: false },
    deferred: false, replied: false, isButton: () => false,
    deferReply: async function () { this.deferred = true; }, editReply: async payload => replies.push(payload),
    reply: async payload => replies.push(payload) };
  const command = { ...base, options: { getSubcommand: () => 'kick', getString: () => 'Repeated harassment', getUser: () => ({ id: 'member' }) } };
  await mod.handle(command);
  assert.deepEqual(order, []);
  const confirmation = replies[0].components[0].toJSON().components[0].custom_id;
  const button = { ...base, isButton: () => true, customId: confirmation, message: { author: { id: 'bot' } },
    deferUpdate: async function () { this.deferred = true; } };
  await mod.handle(button);
  assert.deepEqual(order, ['mod.rate-reserved', 'mod.intent', 'kick', 'mod.result']);
  await mod.handle(button);
  assert.equal(order.filter(value => value === 'kick').length, 1);
});

test('owners cannot purge protected channels and nonowners cannot execute moderation', async () => {
  let changes = 0;
  const replies = [];
  const guild = { id: 'guild', channels: { fetch: async () => ({ id: 'onboarding', guildId: 'guild', type: 0 }) } };
  const mod = createModeration({ guild, cfg: { owners: ['owner'], clientId: 'bot' }, spam: {},
    resource: async (kind, name) => name,
    pool: { query: async sql => {
      if (sql.startsWith('INSERT')) changes++;
      return { rows: [{ kind: 'channel', name: 'onboarding', discord_id: 'onboarding' }] };
    } } });
  const interaction = { guildId: 'guild', channelId: 'smith-controls', user: { id: 'owner', bot: false },
    isButton: () => false, deferReply: async function () { this.deferred = true; },
    editReply: async payload => replies.push(payload), reply: async payload => replies.push(payload),
    options: { getSubcommand: () => 'purge', getString: () => 'Cleanup', getChannel: () => ({ id: 'onboarding' }), getInteger: () => 20 } };
  await mod.handle(interaction);
  assert.match(replies[0].content, /Cleanup is blocked/);
  await mod.handle({ ...interaction, deferred: false, user: { id: 'reviewer', bot: false } });
  assert.match(replies[1].content, /configured owners/);
  assert.equal(changes, 0);
});

test('missing bot permissions refuse destructive operations before confirmation or audit writes', async () => {
  let changes = 0;
  const replies = [];
  const owner = member('owner', 10, [P.Administrator]);
  const bot = member('bot', 9);
  const guild = { id: 'guild', ownerId: 'owner', members: {
    fetch: async () => owner, fetchMe: async () => bot
  } };
  const mod = createModeration({ guild, cfg: { owners: ['owner'], clientId: 'bot' }, spam: {},
    resource: async (kind, name) => name,
    pool: { query: async () => { changes++; return { rows: [] }; } } });
  const interaction = { guildId: 'guild', channelId: 'smith-controls', user: { id: 'owner', bot: false },
    isButton: () => false, deferReply: async function () { this.deferred = true; },
    editReply: async payload => replies.push(payload),
    options: { getSubcommand: () => 'ban', getString: () => 'Harassment', getUser: () => ({ id: 'member' }) } };
  await mod.handle(interaction);
  assert.match(replies[0].content, /Agent Smith needs Ban Members/);
  assert.match(replies[0].content, /not Administrator/);
  assert.equal(changes, 0);
});

test('successful Discord action with failed result recording warns against retry and leaves durable intent', async () => {
  const order = [], replies = [];
  const owner = member('owner', 10, [P.Administrator]);
  const bot = member('bot', 9, [P.ModerateMembers]);
  const target = { ...member('member', 1), timeout: async () => order.push('timeout') };
  const guild = { id: 'guild', ownerId: 'owner', members: {
    fetch: async ({ user }) => user === 'owner' ? owner : target, fetchMe: async () => bot
  } };
  const mod = createModeration({ guild, cfg: { owners: ['owner'], clientId: 'bot' }, spam: {},
    resource: async (kind, name) => name, pool: { query: async (sql, params) => {
      order.push(params[2]);
      if (params[2] === 'mod.result') throw new Error('Database unavailable');
      return { rows: [{ id: 123 }] };
    } } });
  const interaction = { guildId: 'guild', channelId: 'smith-controls', user: { id: 'owner', bot: false },
    isButton: () => false, deferReply: async function () { this.deferred = true; },
    editReply: async payload => replies.push(payload),
    options: { getSubcommand: () => 'timeout', getString: () => 'Harassment', getUser: () => ({ id: 'member' }), getInteger: () => 10 } };
  await mod.handle(interaction);
  assert.deepEqual(order, ['mod.intent', 'timeout', 'mod.result']);
  assert.match(replies[0].content, /Discord action succeeded/);
  assert.match(replies[0].content, /Do NOT retry blindly/);
});