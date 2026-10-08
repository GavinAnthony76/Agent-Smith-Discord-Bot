import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { buildConversationContext } from '../src/conversation-context.js';

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
    members: { me: bot, fetch: async () => member },
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
    isThread: () => true, parent: f.channels.get('wow-channel'),
    permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory]),
    members: { fetch: async () => { throw new Error('not joined'); } } };
  f.channels.set('thread', thread);
  await assert.rejects(buildConversationContext({ ...f, channelId: 'thread' }), /not joined/);
});
