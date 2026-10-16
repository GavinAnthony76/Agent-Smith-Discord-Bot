import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField } from 'discord.js';
import { rankDefinitions } from '../src/progression-config.js';
import { auditProgressionRoles } from '../src/progression-worker.js';
import { operationalFailure, safeMemberFailure, diagnosticScope, recentFailures } from '../src/platform/diagnostics.js';
import { PlatformError } from '../src/platform/catalog.js';
import { createDiscordAccess } from '../src/platform/discord-access.js';
import { subsystemObservation } from '../src/operational-health.js';

test('admin operational status mapping and reference IDs never disclose internal errors',()=>{
  for(const status of [400,401,403,404,409,422,429,503,500]) {
    const result=operationalFailure(new PlatformError('test_condition',status));
    assert.equal(result.status,status);assert.ok(result.body.referenceId);assert.ok(result.body.message);
  }
  for(const [error,status] of [
    [Object.assign(new Error('SQL internals must stay private'),{code:'08006'}),503],
    [Object.assign(new Error('Discord unavailable'),{status:502}),503],
    [Object.assign(new Error('Discord limited'),{status:429}),429],
    [Object.assign(new Error('Channel missing'),{code:10003}),404],
    [Object.assign(new Error('Discord permission'),{code:50013}),422],
    [new TypeError('Cannot read cache in private-file.js'),500],
  ]) {
    const result=operationalFailure(error);
    assert.equal(result.status,status);
    assert.doesNotMatch(JSON.stringify(result.body),/SQL|cache|private-file|08006|TypeError/);
  }
});
test('member messages retain safe business guidance but never echo arbitrary exception text',()=>{
  assert.match(safeMemberFailure(new Error('Request already reviewed.')),/Request already reviewed/);
  assert.doesNotMatch(safeMemberFailure(new Error('Cannot read cache; SELECT token FROM private-file.js')),/cache|SELECT|token|private-file/);
});
test('diagnostic failures and references stay guild-scoped',()=>{
  diagnosticScope({requestId:'fixture-reference',guildId:'fixture-A',operation:'setup',stage:'database'},()=>{
    operationalFailure(new Error('private exception'));
  });
  assert.equal(recentFailures('fixture-A')[0].referenceId,'fixture-reference');
  assert.equal(recentFailures('fixture-B').length,0);
});
function rankFixture() {
  const roles=new Collection(rankDefinitions.map((value,index)=>[String(index),{
    id:String(index),name:value.name,managed:false,editable:true,permissions:new PermissionsBitField(),
  }]));
  const parent={id:'parent',permissionOverwrites:{cache:new Collection()}};
  const thread={id:'thread',parentId:parent.id,isThread:()=>true};
  const guild={id:'rank-fixture',roles:{cache:roles,fetch:async()=>roles},
    channels:{cache:new Collection([[parent.id,parent],[thread.id,thread]]),fetch:async()=>{}},
    fetchOnboarding:async()=>({prompts:new Collection()})};
  return {guild,parent,thread,resource:async(kind,name)=>String(rankDefinitions.findIndex(r=>r.name===name)),config:{unlocks:[]}};
}
test('all 21 existing progression ranks pass with cached threads that have no overwrite manager',async()=>{
  const fixture=rankFixture();
  assert.deepEqual(await auditProgressionRoles(fixture),[]);
  assert.equal(subsystemObservation(fixture.guild.id,'progression').status,'HEALTHY');
});
test('progression still refuses a rank permission grant inherited by a thread',async()=>{
  const fixture=rankFixture();
  fixture.parent.permissionOverwrites.cache.set('0',{allow:{bitfield:1n},deny:{bitfield:0n}});
  const errors=await auditProgressionRoles(fixture);
  assert.ok(errors.some(error=>error.includes('Rank changes channel permissions')));
  assert.equal(subsystemObservation(fixture.guild.id,'progression').status,'DEGRADED');
});
test('unverifiable thread parent blocks progression without falsely claiming missing roles',async()=>{
  const fixture=rankFixture();fixture.guild.channels.cache.delete('parent');
  const errors=await auditProgressionRoles(fixture);
  assert.equal(errors.length,21);
  assert.ok(errors.every(error=>error.startsWith('Cannot verify rank permissions')));
});
test('concurrent authority reads coalesce, subsequent reads and mutations remain fresh',async()=>{
  const guildId='80000000000000001',userId='90000000000000001';
  const counts={guild:0,roles:0,bot:0,actor:0,channels:0};
  const cache=new Map([[guildId,{}]]);
  const actor={id:userId,user:{bot:false},pending:false,roles:{cache}};
  const bot={roles:{cache}};
  const guild={id:guildId,ownerId:userId,
    roles:{fetch:async()=>{counts.roles++;await new Promise(resolve=>setTimeout(resolve,8));return cache;}},
    channels:{fetch:async()=>{counts.channels++;}},
    members:{me:bot,fetchMe:async()=>{counts.bot++;return bot;},fetch:async()=>{counts.actor++;return actor;}}};
  const client={rest:{get:async()=>{counts.guild++;return {id:guildId};}},guilds:{_add:()=>guild}};
  const access=createDiscordAccess({client});
  const [a,b]=await Promise.all([access.authority({guildId,userId}),access.authority({guildId,userId})]);
  assert.equal(a,b);assert.deepEqual(counts,{guild:1,roles:1,bot:1,actor:1,channels:0});
  await access.authority({guildId,userId});
  assert.equal(counts.guild,2);
  await access.authority({guildId,userId,write:true});
  assert.equal(counts.guild,3);assert.equal(counts.channels,1);
});
