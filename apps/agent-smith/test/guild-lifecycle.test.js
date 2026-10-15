import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { TARGET_GUILD_ID } from '../src/config.js';
import { LMOC_TEST_ID, assertProductionGuildWritable } from '../src/platform/guild-lifecycle.js';
import { createActivation, previewRuntimeStatus } from '../src/platform/activation.js';
import { createPlatformRuntime } from '../src/platform/runtime.js';
import { createPlatformService } from '../src/platform/service.js';
import { seedReviewedConfiguration } from '../src/platform/release-config.js';
import { withPlatformCommunication, communicationGuard } from '../src/platform/transport.js';
import { installSecurityGate } from '../src/security-gate.js';

const staleEnv={PLATFORM_PUBLIC_URL:'https://example.invalid',
  PLATFORM_ENABLED_GUILD_IDS:LMOC_TEST_ID,PLATFORM_LMOC_CONFIG_SHA256:'stale'};
const noIO=async()=>{throw Error('Unexpected IO for archived guild.');};

test('only Hallowed Core can authorize production guild mutations',()=>{
  assert.doesNotThrow(()=>assertProductionGuildWritable(TARGET_GUILD_ID));
  for(const id of [LMOC_TEST_ID,'80000000000000001'])
    assert.throws(()=>assertProductionGuildWritable(id),{code:'guild_reference_only'});
});

test('archived guild cannot refresh, dispatch, consume analytics, seed or report active from stale state',async()=>{
  const client={isReady:()=>true,guilds:{cache:new Map([[LMOC_TEST_ID,{id:LMOC_TEST_ID}]])}};
  const activation=createActivation({client,pool:{query:noIO},env:staleEnv});
  assert.equal(await activation.refresh(LMOC_TEST_ID),false);
  assert.equal(await activation.active(LMOC_TEST_ID),false);
  assert.equal(await activation.acceptsEvent(LMOC_TEST_ID,Date.now()),false);
  const status=await activation.status(LMOC_TEST_ID);
  assert.equal(status.botConnected,false);
  assert.equal(status.runtimeActive,false);
  assert.equal(status.platformEnabled,false);
  assert.equal(status.lifecycle,'historical-reference-only');
  assert.deepEqual(await seedReviewedConfiguration({pool:{connect:noIO},client,env:staleEnv}),
    {skipped:true,reason:'historical_reference_only'});
  const preview=await previewRuntimeStatus({PLATFORM_RUNTIME_STATUS_URL:'https://example.invalid'})(LMOC_TEST_ID);
  assert.equal(preview.runtimeActive,false);
  assert.equal(preview.statusUnavailable,false);
});

test('all standard runtime entry points ignore LMOC and unapproved guilds with zero event IO',async()=>{
  const queries=[];
  const client=new EventEmitter();
  client.isReady=()=>true;
  client.user={id:'70000000000000001'};
  const ids=[LMOC_TEST_ID,'80000000000000001',TARGET_GUILD_ID];
  client.guilds={cache:new Map(ids.map(id=>[id,{id}]))};
  client.rest={get:noIO,post:noIO,put:noIO,delete:noIO};
  const runtime=createPlatformRuntime({client,pool:{
    query:async(sql,params)=>{queries.push({sql,params});return {rows:[],rowCount:0};},
    connect:noIO,
  },cfg:{guildId:TARGET_GUILD_ID,clientId:client.user.id},env:staleEnv});
  try {
    await runtime.initialize();
    assert.equal(queries.length,1);
    assert.match(queries[0].sql,/guild_archived_reference_only/);
    queries.length=0;
    for(const id of ids) {
      const guild={id};
      client.emit('guildCreate',guild);
      client.emit('guildDelete',guild);
      client.emit('guildMemberAdd',{guild});
      client.emit('guildMemberRemove',{guild});
      client.emit('messageCreate',{guildId:id});
      assert.equal(await runtime.handleMessage({guildId:id}),false);
      assert.equal(await runtime.handleInteraction({guildId:id}),false);
    }
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(queries,[]);
  } finally {runtime.stop();}
  assert.equal(client.listenerCount('messageCreate'),0);
});

test('dashboard cannot adopt historical configuration or authorize any unapproved write',async()=>{
  const service=createPlatformService({pool:{query:noIO},discord:{authority:noIO},env:staleEnv});
  assert.deepEqual(await service.adopt({id:LMOC_TEST_ID}),{id:LMOC_TEST_ID});
  for(const id of [LMOC_TEST_ID,'80000000000000001'])
    await assert.rejects(service.authorize('90000000000000001',id,'settings',true),
      {code:'guild_reference_only'});
});

test('archived conversation scopes and REST write adapters cannot bypass guild policy',async()=>{
  assert.throws(()=>withPlatformCommunication({guild:{id:LMOC_TEST_ID}},()=>
    communicationGuard({method:'POST',fullRoute:'/channels/123/messages'})),{code:'guild_reference_only'});
  let writes=0;
  const client={rest:{request:async()=>{writes++;}},channels:{cache:new Map([
    ['80000000000000003',{guildId:LMOC_TEST_ID}],
  ])}};
  installSecurityGate({client,guild:{id:TARGET_GUILD_ID},cfg:{},readResources:noIO,writeAudit:noIO});
  for(const route of [`/guilds/${LMOC_TEST_ID}/roles`,'/channels/80000000000000003/messages'])
    await assert.rejects(client.rest.request({method:'POST',fullRoute:route,body:{}}),
      {code:'guild_reference_only'});
  assert.equal(writes,0);
});
