import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordAccess } from '../src/platform/discord-access.js';

function fixture({ ghostActor = false, ghostBot = false, pending = false } = {}) {
  const roleId = '100000000000000004', guildId = '100000000000000002';
  const actor = { id: '100000000000000001', user: { bot: false }, pending,
    roles: { cache: new Map([[guildId, {}], ...(ghostActor ? [[roleId, {}]] : [])]) } };
  const bot = { roles: { cache: new Map([[guildId, {}], ...(ghostBot ? [[roleId, {}]] : [])]) } };
  const guild = { id: guildId, ownerId: actor.id,
    roles: { fetch: async () => new Map([[guildId, {}]]) },
    channels: { fetch: async () => new Map() },
    members: { me: bot, fetch: async () => actor, fetchMe: async () => bot } };
  const client = { rest: { get: async () => ({ id: guildId }) }, guilds: { _add: () => guild } };
  return { discord: createDiscordAccess({ client }), guildId, userId: actor.id };
}

test('dashboard authority uses the freshly returned role list, not cached ghost roles', async () => {
  for (const ghost of [{ ghostActor: true }, { ghostBot: true }]) {
    const { discord, ...args } = fixture(ghost);
    assert.equal(await discord.authority(args), null);
  }
  const { discord, ...args } = fixture();
  assert.equal((await discord.authority(args)).role, 'OWNER');
});

test('unresolved or pending membership fails closed even for a claimed guild owner', async () => {
  for (const pending of [true, null]) {
    const { discord, ...args } = fixture({ pending });
    assert.equal(await discord.authority(args), null);
  }
});
