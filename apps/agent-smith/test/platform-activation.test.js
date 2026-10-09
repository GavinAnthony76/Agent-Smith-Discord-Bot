import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { platformAllowlist, LMOC_TEST_ID, STANDARD_MODULES, createActivation } from '../src/platform/activation.js';
import { TARGET_GUILD_ID } from '../src/config.js';
import { createPlatformRuntime } from '../src/platform/runtime.js';
import { validateReleaseConfiguration, configurationDigest, loadReviewedConfiguration } from '../src/platform/release-config.js';
import { conversationIdentity, HALLOWED_IDENTITY } from '../src/conversation-identity.js';
import { withSelfRoleWrite, executeSelfRoleWrite } from '../src/platform/role-write.js';

test('standard activation is opt-in and Hallowed Core cannot be allowlisted', () => {
  assert.equal(platformAllowlist({}).has(LMOC_TEST_ID),false);
  const allowed=platformAllowlist({PLATFORM_ENABLED_GUILD_IDS:LMOC_TEST_ID});
  assert.equal(allowed.has(LMOC_TEST_ID),true);
  assert.equal(allowed.has(TARGET_GUILD_ID),false);
  assert.throws(()=>platformAllowlist({PLATFORM_ENABLED_GUILD_IDS:`${LMOC_TEST_ID},${TARGET_GUILD_ID}`}));
  assert.throws(()=>platformAllowlist({PLATFORM_ENABLED_GUILD_IDS:'invalid'}));
  for(const pending of ['moderation','automod','achievements','rewards','feeds','youtube','events'])
    assert.equal(STANDARD_MODULES.includes(pending),false);
});

test('Hallowed Core bypasses every standard event, interaction, AI and startup path', async () => {
  const queries=[];
  const pool={query:async(sql,params)=>{queries.push({sql,params});return{rows:[],rowCount:0};}};
  const client=new EventEmitter();
  client.isReady=()=>true;
  client.user={id:'90000000000000001'};
  client.guilds={cache:new Map([[TARGET_GUILD_ID,{id:TARGET_GUILD_ID}]])};
  client.rest={get:async()=>{throw Error('Standard REST must not be called for Hallowed Core.');}};
  const runtime=createPlatformRuntime({client,pool,cfg:{guildId:TARGET_GUILD_ID,clientId:client.user.id},
    env:{PLATFORM_PUBLIC_URL:'https://example.invalid',PLATFORM_ENABLED_GUILD_IDS:LMOC_TEST_ID}});
  await runtime.initialize();
  client.emit('guildCreate',{id:TARGET_GUILD_ID});
  client.emit('guildDelete',{id:TARGET_GUILD_ID});
  client.emit('guildMemberAdd',{id:'90000000000000002',guild:{id:TARGET_GUILD_ID}});
  client.emit('guildMemberRemove',{id:'90000000000000002',guild:{id:TARGET_GUILD_ID}});
  client.emit('messageCreate',{guildId:TARGET_GUILD_ID});
  assert.equal(await runtime.handleMessage({guildId:TARGET_GUILD_ID}),false);
  assert.equal(await runtime.handleInteraction({guildId:TARGET_GUILD_ID}),false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(queries,[]);
  runtime.stop();
});

test('inactive and unconfigured guilds cannot activate or fabricate a heartbeat', async () => {
  const queries=[];
  const pool={query:async(sql,params)=>{queries.push({sql,params});return{rows:[],rowCount:0};}};
  const client={isReady:()=>true,guilds:{cache:new Map([[LMOC_TEST_ID,{id:LMOC_TEST_ID}]])}};
  const activation=createActivation({pool,client,env:{PLATFORM_ENABLED_GUILD_IDS:LMOC_TEST_ID}});
  assert.equal(await activation.refresh(TARGET_GUILD_ID),false);
  assert.equal(queries.length,0);
  assert.equal(await activation.refresh(LMOC_TEST_ID),false);
  assert.equal(queries.some(q=>/INSERT|UPDATE/.test(q.sql)),false);
  assert.equal((await activation.status(LMOC_TEST_ID)).runtimeActive,false);
});

test('generic whoami uses actual guild and saved personality; Hallowed Core is byte-for-byte preserved', () => {
  const generic=conversationIdentity({name:'LMOC TEST'},{genericServer:true,personalityAdditions:'Short, welcoming replies.'});
  assert.match(generic,/LMOC TEST/);
  assert.match(generic,/Short, welcoming replies/);
  assert.doesNotMatch(generic,/Hallowed Core|Gaming, Tech/);
  assert.equal(conversationIdentity({name:'The Hallowed Core'},{genericServer:false}),HALLOWED_IDENTITY);
});

test('reviewed seed contains only one guild, 15 configurations and no history or identity', async () => {
  const bundle=await loadReviewedConfiguration();
  assert.equal(bundle.guildId,LMOC_TEST_ID);
  assert.equal(bundle.modules.length,15);
  assert.equal(bundle.modules.find(m=>m.moduleKey==='onboarding').configuration.steps.length,6);
  assert.match(configurationDigest(bundle),/^[a-f0-9]{64}$/);
  assert.throws(()=>validateReleaseConfiguration({...bundle,guildId:TARGET_GUILD_ID}));
  assert.throws(()=>validateReleaseConfiguration({...bundle,sessions:[]}));
  assert.throws(()=>validateReleaseConfiguration({...bundle,modules:bundle.modules.slice(1)}));
});

test('cosmetic removal is one audited DELETE, never a PUT or another route', async () => {
  const client={};let writes=0;
  const plan={client,guildId:LMOC_TEST_ID,memberId:'90000000000000001',roleId:'90000000000000002',
    operation:'remove',validate:async()=>{},record:async()=>{}};
  await withSelfRoleWrite(plan,async()=>{
    const request={method:'DELETE',fullRoute:`/guilds/${plan.guildId}/members/${plan.memberId}/roles/${plan.roleId}`,body:{}};
    await executeSelfRoleWrite(client,request,async()=>{writes++;});
    assert.throws(()=>executeSelfRoleWrite(client,request,async()=>{writes++;}));
  });
  assert.equal(writes,1);
  await assert.rejects(withSelfRoleWrite(plan,async()=>executeSelfRoleWrite(client,{
    method:'PUT',fullRoute:`/guilds/${plan.guildId}/members/${plan.memberId}/roles/${plan.roleId}`,body:{},
  },async()=>{writes++;})));
  assert.equal(writes,1);
});
