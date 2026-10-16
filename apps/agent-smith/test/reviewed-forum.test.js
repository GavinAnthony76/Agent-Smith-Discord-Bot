import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits as P, PermissionsBitField, ChannelType } from 'discord.js';
import { assertRoleChannelGrants, capabilities } from '../src/permissions.js';
import { reviewedGamingForum as policy } from '../src/reviewed-forum-policy.js';
import { protectedResources } from '../src/protected-resources.js';
import { seedReviewedForum } from './helpers/reviewed-forum-fixture.js';

function fixture() {
  const role=(id,name,position,permissions=[])=>({id,name,position,managed:false,editable:true,
    permissions:new PermissionsBitField(permissions)});
  const gaming=role(policy.roleId,'Gaming',10);
  const ownerRole=role('owner-role','Owner',100,[P.Administrator]),botRole=role('bot-role','Agent Smith',50);
  const owner={id:'owner',roles:{highest:ownerRole}};
  const bot={id:'smith',permissions:new PermissionsBitField(capabilities.allowed.map(key=>P[key])),
    roles:{highest:botRole,cache:new Collection([[botRole.id,botRole]])}};
  const guild={id:policy.guildId,ownerId:owner.id,
    roles:{cache:new Collection([gaming,ownerRole,botRole].map(role=>[role.id,role]))}};
  const rows=[{kind:'role',name:'Gaming',discord_id:gaming.id}];
  const {forum,parent}=seedReviewedForum({guild,role:gaming,bot,rows});
  const check=()=>assertRoleChannelGrants(gaming,guild,{bot,owner,rows,
    registry:protectedResources({guild,bot,owner,rows})});
  return {guild,role:gaming,owner,bot,rows,forum,parent,check};
}
test('mmo-thread passes only with its exact Owner-reviewed identity and bounded live security',()=>{
  const f=fixture();assert.doesNotThrow(f.check);
});
test('renaming display metadata alone does not invalidate the reviewed resource',()=>{
  const f=fixture();
  for(const name of ['mmo-thread','World of Warcraft','mmo-adventures','Different display label']) {
    f.forum.name=name;assert.doesNotThrow(f.check);
  }
  // Its tracked name is not the identity source either.
  f.rows.find(row=>row.discord_id===f.forum.id).name='updated display metadata';
  assert.doesNotThrow(f.check);
});
test('same display or canonical name on a different resource ID never gains the exception',()=>{
  for(const name of ['mmo-thread','mmo-adventures']) {
    const f=fixture();f.guild.channels.cache.delete(f.forum.id);
    f.forum.id='different-id';f.forum.name=name;f.guild.channels.cache.set(f.forum.id,f.forum);
    assert.throws(f.check,/Owner review required/);
  }
});
test('an additional same-name spoof does not inherit the exception while the approved forum exists',()=>{
  const f=fixture();
  f.guild.channels.cache.set('spoof',{...f.forum,id:'spoof',name:'mmo-adventures'});
  assert.throws(f.check,/unexpected channel/);
});
test('wrong guild, channel guild or reviewed role identity is refused',()=>{
  for(const mutate of [
    f=>{f.guild.id='different-guild';},
    f=>{f.forum.guildId='different-guild';},
    f=>{f.role.id='different-role';},
    f=>{f.role.guild={id:'different-guild'};},
  ]) {const f=fixture();mutate(f);assert.throws(f.check,/Owner review required/);}
});
test('wrong/missing parent or changed forum/category type requires review',()=>{
  for(const mutate of [
    f=>{f.forum.parentId='different-parent';},
    f=>{f.guild.channels.cache.delete(f.parent.id);},
    f=>{f.parent.guildId='different-guild';},
    f=>{f.forum.type=ChannelType.GuildText;},
    f=>{f.parent.type=ChannelType.GuildForum;},
    f=>{f.parent.parentId='unexpected-parent';},
  ]) {const f=fixture();mutate(f);assert.throws(f.check,/Owner review required/);}
});
test('unsafe and unknown allow/deny bits are rejected on both forum and parent',()=>{
  for(const target of ['forum','parent']) for(const bit of [P.ManageRoles,P.Administrator,1n<<62n]) {
    const f=fixture();f[target].permissionOverwrites.cache.get(f.role.id).allow.add(bit);
    assert.throws(f.check,/Owner review required/);
    const g=fixture();g[target].permissionOverwrites.cache.get(g.role.id).deny.add(bit);
    assert.throws(g.check,/Owner review required/);
  }
});
test('protected-resource collisions and unexpected privileged principals cannot expand access',()=>{
  for(const mutate of [
    f=>{f.rows.push({kind:'channel',name:'audit-log',discord_id:f.forum.id});},
    f=>{f.rows.push({kind:'starter-channel',name:'anything',discord_id:f.forum.id});},
    f=>{f.forum.name='smith-controls';},
    f=>{f.forum.permissionOverwrites.cache.set('protected-owner-role',{
      id:'protected-owner-role',type:0,allow:new PermissionsBitField(P.Administrator),deny:new PermissionsBitField()});},
    f=>{f.forum.permissionOverwrites.cache.get(f.guild.id).allow.add(P.ViewChannel);},
    f=>{f.forum.permissionOverwrites.cache.get(f.bot.id).allow.add(P.ManageRoles);},
  ]) {const f=fixture();mutate(f);assert.throws(f.check,/Owner review required/);}
});
test('Smith permission, role hierarchy and protected-role rules remain mandatory',()=>{
  for(const mutate of [
    f=>{f.bot.permissions.remove(P.ManageRoles);},
    f=>{f.bot.permissions.add(P.Administrator);},
    f=>{f.guild.roles.everyone.permissions.add(P.ManageRoles);},
    f=>{f.bot.roles.highest.position=100;},
    f=>{f.role.position=f.bot.roles.highest.position;},
    f=>{f.role.permissions.add(P.ManageGuild);},
    f=>{f.role.managed=true;},
    f=>{f.role.editable=false;},
    f=>{f.bot.roles.cache.set(f.role.id,f.role);},
    f=>{f.forum.permissionsFor=()=>new PermissionsBitField();},
    f=>{f.owner.id='not-the-owner';},
    f=>{f.rows.splice(0,f.rows.length);},
  ]) {const f=fixture();mutate(f);assert.throws(f.check);}
});
test('cached threads retain the reviewed parent checks; missing security context never bypasses them',()=>{
  const f=fixture();f.guild.channels.cache.set('thread',{id:'thread',type:ChannelType.PublicThread,parentId:f.forum.id});
  assert.doesNotThrow(f.check);
  assert.throws(()=>assertRoleChannelGrants(f.role,f.guild),/Owner review required/);
  f.forum.parentId='wrong-parent';assert.throws(f.check,/Owner review required/);
});
