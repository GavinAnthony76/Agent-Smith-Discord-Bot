import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { communityChannels, starterChannels } from '../src/community.js';

function fixture() {
  const rules = { id: 'rules-id', name: 'rules', type: ChannelType.GuildText };
  const updates = {
    id: 'updates-id', name: 'moderator-only', type: ChannelType.GuildText,
    permissionsFor: () => new PermissionsBitField(0n),
    permissionOverwrites: { cache: new Map() }
  };
  const guild = {
    features: ['COMMUNITY'], rulesChannelId: rules.id, publicUpdatesChannelId: updates.id,
    channels: { cache: new Map([[rules.id, rules], [updates.id, updates]]) },
    roles: { everyone: { id: 'everyone' }, cache: new Map() }
  };
  return { guild, rules, updates, cfg: { owners: ['owner'], approvers: [] } };
}
test('adoption uses Discord-designated existing rules and private updates identities', () => {
  const f = fixture();
  assert.deepEqual(communityChannels(f.guild, f.cfg, 'bot'), { rules: f.rules, updates: f.updates });
});
test('adoption refuses missing Community, wrong rules identity, duplicates and wrong channel types', () => {
  const f = fixture();
  f.guild.features = [];
  assert.throws(() => communityChannels(f.guild, f.cfg, 'bot'), /Enable Community/);
  f.guild.features = ['COMMUNITY'];
  f.guild.rulesChannelId = 'unrelated';
  assert.throws(() => communityChannels(f.guild, f.cfg, 'bot'), /Rules channel/);
  f.guild.rulesChannelId = f.rules.id;
  f.guild.channels.cache.set('duplicate', { ...f.rules, id: 'duplicate' });
  assert.throws(() => communityChannels(f.guild, f.cfg, 'bot'), /Multiple rules/);
  f.guild.channels.cache.delete('duplicate');
  f.rules.type = ChannelType.GuildVoice;
  assert.throws(() => communityChannels(f.guild, f.cfg, 'bot'), /Rules channel/);
});
test('public or nonstaff-readable Community Updates channel is refused without changing it', () => {
  const f = fixture();
  f.updates.permissionsFor = () => new PermissionsBitField(P.ViewChannel);
  assert.throws(() => communityChannels(f.guild, f.cfg, 'bot'), /not private/);
  f.updates.permissionsFor = () => new PermissionsBitField(0n);
  f.updates.permissionOverwrites.cache.set('member', { id: 'member', allow: new PermissionsBitField(P.ViewChannel) });
  assert.throws(() => communityChannels(f.guild, f.cfg, 'bot'), /outside configured staff/);
  f.updates.permissionOverwrites.cache.clear();
  f.updates.permissionOverwrites.cache.set('owner', { id: 'owner', allow: new PermissionsBitField(P.ViewChannel) });
  assert.doesNotThrow(() => communityChannels(f.guild, f.cfg, 'bot'));
});
test('only uniquely named, correctly typed Discord default starter channels are preserved', () => {
  const f = fixture();
  const general = { id: 'general-id', name: 'general', type: ChannelType.GuildText };
  f.guild.channels.cache.set(general.id, general);
  assert.deepEqual(starterChannels(f.guild), [general]);
  f.guild.channels.cache.set('custom', { id: 'custom', name: 'unrelated', type: ChannelType.GuildText });
  assert.deepEqual(starterChannels(f.guild), [general]);
  f.guild.channels.cache.set('duplicate', { ...general, id: 'duplicate' });
  assert.throws(() => starterChannels(f.guild), /Unexpected/);
  f.guild.channels.cache.delete('duplicate');
  general.type = ChannelType.GuildVoice;
  assert.throws(() => starterChannels(f.guild), /Unexpected/);
});