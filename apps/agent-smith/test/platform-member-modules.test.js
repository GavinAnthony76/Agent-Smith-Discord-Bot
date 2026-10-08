import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { TARGET_GUILD_ID } from '../src/config.js';
import { withSelfRoleWrite, executeSelfRoleWrite } from '../src/platform/role-write.js';
import { assertSelfRoleSafe } from '../src/platform/roles.js';
import { welcomePayload, welcomeRecordId } from '../src/platform/welcome.js';

const guildId='80000000000000001', memberId='90000000000000001', roleId='81000000000000001';
test('self role gate permits one audited exact addition, never foreign/multiple/revocation/Hallowed Core writes', async () => {
  const client={},events=[], plan={client,guildId,memberId,roleId,validate:async()=>{},
    record:async event=>events.push(event)},request={method:'PUT',fullRoute:`/guilds/${guildId}/members/${memberId}/roles/${roleId}`,body:{}};
  assert.throws(()=>withSelfRoleWrite({...plan,guildId:TARGET_GUILD_ID},()=>{}),/policy_unavailable/);
  for(const change of [{method:'DELETE'},{body:{roles:[roleId]}},{fullRoute:request.fullRoute.replace(memberId,roleId)}]){
    await withSelfRoleWrite(plan,async()=>assert.throws(()=>executeSelfRoleWrite(client,{...request,...change},()=>{}),/not_authorized/));
  }
  await withSelfRoleWrite(plan,async()=>{
    assert.equal(await executeSelfRoleWrite(client,request,async()=>true),true);
    assert.throws(()=>executeSelfRoleWrite(client,request,()=>{}),/not_authorized/);
  });
  assert.deepEqual(events,['security.intent','security.result']);
  assert.equal(executeSelfRoleWrite(client,request,()=>{}),null);
});
test('self role gate fails closed when its audit cannot be persisted', async()=>{
  const client={},plan={client,guildId,memberId,roleId,validate:async()=>{},record:async()=>{throw Error('audit unavailable');}};
  let writes=0;
  await assert.rejects(withSelfRoleWrite(plan,()=>executeSelfRoleWrite(client,{method:'PUT',
    fullRoute:`/guilds/${guildId}/members/${memberId}/roles/${roleId}`,body:{}},async()=>writes++)),/audit unavailable/);
  assert.equal(writes,0);
});
test('self assignment rejects hidden raw bits, hierarchy/protected roles and private channel access',()=>{
  const guild={id:guildId,members:{me:{roles:{highest:{position:10}}}},channels:{cache:new Map()}};
  const role={id:roleId,name:'Gamer',position:2,permissions:new PermissionsBitField(P.ViewChannel)};
  assert.doesNotThrow(()=>assertSelfRoleSafe(role,guild));
  for(const bad of [{name:'Moderator'},{managed:true},{position:10},
    {permissions:new PermissionsBitField(P.ManageMessages)},{permissions:new PermissionsBitField(1n<<60n)}])
    assert.throws(()=>assertSelfRoleSafe({...role,...bad},guild),/not_safe/);
  assert.throws(()=>assertSelfRoleSafe(role,guild,[roleId]),/not_safe/);
  guild.channels.cache.set('private',{permissionOverwrites:{cache:new Map([
    [guildId,{deny:new PermissionsBitField(P.ViewChannel)}],[roleId,{allow:new PermissionsBitField(P.ViewChannel)}]
  ])}});
  assert.throws(()=>assertSelfRoleSafe(role,guild),/private_access_requires_review/);
});
test('welcome placeholders and controls are bounded, suppress pings and identify actual joins deterministically',()=>{
  const guild={id:guildId,name:'Test server',memberCount:21},member={id:memberId,displayName:'New member',user:{username:'Member'}};
  const payload=welcomePayload({message:'Hello {user}; {server} has {memberCount}.',
    embedTitle:'Welcome',description:'Read the rules',imageUrl:'https://example.com/banner.png',
    buttons:[{label:'Rules',url:'https://example.com/rules'}],roleBehavior:'ONBOARDING'},member,guild);
  assert.equal(payload.content,'Hello New member; Test server has 21.');
  assert.deepEqual(payload.allowedMentions,{parse:[],repliedUser:false});
  assert.equal(payload.components[0].components[1].custom_id,'smith:onboarding:start');
  assert.equal(welcomeRecordId(guildId,memberId,1),welcomeRecordId(guildId,memberId,1));
  assert.notEqual(welcomeRecordId(guildId,memberId,1),welcomeRecordId(guildId,memberId,2));
  assert.notEqual(welcomeRecordId(guildId,memberId,1),welcomeRecordId(roleId,memberId,1));
});
