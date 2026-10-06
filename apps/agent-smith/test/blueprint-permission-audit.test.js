import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { overwrites } from '../src/discord.js';
import { compareBlueprintPermissions, communityHelpRestriction as policy } from '../src/blueprint-permission-audit.js';

function fixture() {
  const role = { id: policy.memberRoleId, name: 'Member' };
  const guild = { id: policy.guildId, ownerId: 'owner', roles: { cache: new Map([[role.id, role]]) } };
  const expected = overwrites(guild, { owners: ['owner'], approvers: ['reviewer'] }, 'smith', 'Member', { Member: role.id });
  const entries = expected.map(x => ({ ...x, allow: new PermissionsBitField(x.allow), deny: new PermissionsBitField(x.deny) }));
  const everyone = entries.find(x => x.id === guild.id);
  everyone.deny.add(P.SendMessages);
  const channel = { id: policy.channelId, name: 'community-help', type: ChannelType.GuildForum,
    parentId: policy.parentId, permissionOverwrites: { cache: new Map(entries.map(x => [x.id, x])) } };
  const rows = [
    { kind: 'channel', name: 'community-help', discord_id: channel.id },
    { kind: 'channel', name: 'SHARED HUB', discord_id: channel.parentId },
    { kind: 'role', name: 'Member', discord_id: role.id }
  ];
  return { guild, channel, expected, botId: 'smith', rows, everyone, role };
}
const compare = f => compareBlueprintPermissions(f);
const snapshot = f => [...f.channel.permissionOverwrites.cache.values()].map(x =>
  [x.id, x.type, x.allow.bitfield, x.deny.bitfield]);

test('approved restriction passes read-only, reports its reason, and keeps Member posting grants', () => {
  const f = fixture(), before = snapshot(f);
  f.channel.edit = () => assert.fail('Audit must not edit Discord');
  f.channel.permissionOverwrites.set = () => assert.fail('Audit must not write overwrites');
  assert.equal(compare(f).matches, true);
  assert.match(compare(f).reviewed, /Owner-approved restriction.*SendMessages/);
  assert.deepEqual(snapshot(f), before);
  const member = f.channel.permissionOverwrites.cache.get(f.role.id);
  assert.equal(member.allow.has([P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads]), true);
  f.everyone.deny.remove(P.SendMessages);
  assert.deepEqual(compare(f), { matches: true, reviewed: null }); // Original blueprint remains valid.
});

test('restriction cannot be copied by name, guild, channel, parent, type, or Member identity', () => {
  for (const mutate of [
    f => { f.guild.id = 'another-guild'; },
    f => { f.channel.id = 'another-channel'; },
    f => { f.channel.name = 'introductions'; },
    f => { f.channel.parentId = 'another-parent'; },
    f => { f.channel.type = ChannelType.GuildText; },
    f => { f.role.name = 'Selection: Tech'; },
    f => { f.guild.roles.cache.clear(); },
    ...[0, 1, 2].map(index => f => { f.rows[index].discord_id = 'replacement'; }),
    ...[0, 1, 2].map(index => f => { f.rows.splice(index, 1); })
  ]) {
    const f = fixture(); mutate(f);
    assert.deepEqual(compare(f), { matches: false, reviewed: null });
  }
});

test('every added raw allow or deny bit still fails, including unnamed bits', () => {
  for (let index = 0n; index < 64n; index++) {
    const bit = 1n << index;
    for (const principal of ['everyone', 'member', 'smith', 'reviewer']) {
      for (const field of ['allow', 'deny']) {
        const f = fixture();
        const id = principal === 'everyone' ? f.guild.id : principal === 'member' ? f.role.id : principal;
        const entry = f.channel.permissionOverwrites.cache.get(id);
        if (entry[field].bitfield & bit) continue;
        // This is the existing Smith-only ManageRoles compatibility rule.
        if (principal === 'smith' && field === 'allow' && bit === P.ManageRoles) continue;
        entry[field] = new PermissionsBitField(entry[field].bitfield | bit);
        assert.equal(compare(f).matches, false, `${principal} ${field} bit ${index}`);
      }
    }
  }
});

test('removed grants, removed visibility denial, wrong principal types and extra entries fail', () => {
  for (const mutate of [
    f => f.everyone.deny.remove(P.ViewChannel),
    f => { f.everyone.type = 1; },
    f => { f.channel.permissionOverwrites.cache.get(f.role.id).type = 1; },
    f => f.channel.permissionOverwrites.cache.get(f.role.id).allow.remove(P.SendMessages),
    f => f.channel.permissionOverwrites.cache.delete('smith'),
    f => f.channel.permissionOverwrites.cache.delete('reviewer'),
    ...[0, 1].map(type => f => f.channel.permissionOverwrites.cache.set('unreviewed', {
      id: 'unreviewed', type, allow: new PermissionsBitField(), deny: new PermissionsBitField()
    }))
  ]) {
    const f = fixture(); mutate(f);
    const before = snapshot(f);
    assert.deepEqual(compare(f), { matches: false, reviewed: null });
    assert.deepEqual(snapshot(f), before);
  }
});

test('existing Smith Manage Permissions treatment is unchanged and cannot extend to Member', () => {
  const f = fixture();
  f.channel.permissionOverwrites.cache.get('smith').allow.add(P.ManageRoles);
  assert.equal(compare(f).matches, true);
  f.channel.permissionOverwrites.cache.get(f.role.id).allow.add(P.ManageRoles);
  assert.equal(compare(f).matches, false);
});
