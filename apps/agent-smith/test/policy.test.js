import test from 'node:test';
import assert from 'node:assert/strict';
import { maySelfJoin,canReview,assertAssignableRole } from '../src/policy.js';
import { frameworks,interests,categories } from '../src/blueprint.js';
import { config,assertWriteTarget,TARGET_GUILD_ID } from '../src/config.js';
test('each framework is available as first selection only after acceptance',()=>{
  for(const requested of frameworks){
    assert.equal(maySelfJoin({accepted:true,existing:[],requested}),true);
    assert.throws(()=>maySelfJoin({accepted:false,existing:[],requested}));
    for(const first of frameworks) assert.throws(()=>maySelfJoin({accepted:true,existing:[first],requested}));
  }
});
test('second and third frameworks cannot be self granted',()=>{
  assert.throws(()=>maySelfJoin({accepted:true,existing:['Faith','Gaming'],requested:'Tech'}));
  assert.throws(()=>maySelfJoin({accepted:true,existing:[],requested:'Administrator'}));
});
test('review authority comes exclusively from human ID allowlists',()=>{
  const cfg={owners:['owner'],approvers:['reviewer']};
  assert.equal(canReview('owner',cfg),true);assert.equal(canReview('reviewer',cfg),true);
  assert.equal(canReview('AI',cfg),false);assert.equal(canReview('Administrator',cfg),false);
});
test('interest roles never gate a category',()=>{
  for(const cat of categories) assert.ok([null,'Member','staff',...frameworks].includes(cat.gate));
  assert.equal(new Set(Object.values(interests).flat()).size,Object.values(interests).flat().length);
});
test('wrong target and absent owner configuration fail closed',()=>{
  const env={DISCORD_TOKEN:'test',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_GUILD_ID:TARGET_GUILD_ID,BOOTSTRAP_CONFIRM_GUILD_ID:TARGET_GUILD_ID,DATABASE_URL:'postgres://test',OWNER_IDS:'333333333333333333'};
  assert.throws(()=>config({...env,OWNER_IDS:''}));
  assert.throws(()=>config({...env,DISCORD_GUILD_ID:'222222222222222222'}),/DISCORD_GUILD_ID/);
  assert.equal(config(env).guildId,env.DISCORD_GUILD_ID);
});
test('connections and writes require both IDs to equal the fixed Hallowed Core target',()=>{
  const env={DISCORD_TOKEN:'test',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_GUILD_ID:TARGET_GUILD_ID,BOOTSTRAP_CONFIRM_GUILD_ID:TARGET_GUILD_ID,DATABASE_URL:'postgres://test',OWNER_IDS:'333333333333333333'};
  assert.equal(TARGET_GUILD_ID,'1556423230590423042');
  assert.throws(()=>config({...env,BOOTSTRAP_CONFIRM_GUILD_ID:''}),/BOOTSTRAP_CONFIRM_GUILD_ID/);
  assert.throws(()=>config({...env,BOOTSTRAP_CONFIRM_GUILD_ID:'555555555555555555'}),/BOOTSTRAP_CONFIRM_GUILD_ID/);
  assert.throws(()=>assertWriteTarget({guildId:'222222222222222222'},env),/DISCORD_GUILD_ID/);
  assert.throws(()=>assertWriteTarget(config(env),{...env,DISCORD_GUILD_ID:'222222222222222222'}),/DISCORD_GUILD_ID/);
  assert.throws(()=>assertWriteTarget(config(env),{...env,BOOTSTRAP_CONFIRM_GUILD_ID:'555555555555555555'}),/BOOTSTRAP_CONFIRM_GUILD_ID/);
  assert.doesNotThrow(()=>assertWriteTarget(config(env),env));
});
test('roles with elevated permissions or unsafe hierarchy cannot be granted',()=>{
  assert.equal(assertAssignableRole({editable:true,permissions:{bitfield:0n}}).editable,true);
  assert.throws(()=>assertAssignableRole({editable:true,permissions:{bitfield:8n}}),/elevated permissions/);
  assert.throws(()=>assertAssignableRole({editable:false,permissions:{bitfield:0n}}),/above/);
  assert.throws(()=>assertAssignableRole(undefined));
});
