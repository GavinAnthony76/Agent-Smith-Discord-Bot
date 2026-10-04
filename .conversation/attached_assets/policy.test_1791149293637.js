import test from 'node:test';
import assert from 'node:assert/strict';
import { maySelfJoin,canReview } from '../src/policy.js';
import { frameworks,interests,categories } from '../src/blueprint.js';
import { config } from '../src/config.js';
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
test('protected server and absent owner configuration fail closed',()=>{
  const env={DISCORD_TOKEN:'test',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_GUILD_ID:'222222222222222222',DATABASE_URL:'postgres://test',OWNER_IDS:'333333333333333333'};
  assert.throws(()=>config({...env,OWNER_IDS:''}));
  assert.throws(()=>config({...env,PROTECTED_GUILD_IDS:env.DISCORD_GUILD_ID}));
  assert.equal(config(env).guildId,env.DISCORD_GUILD_ID);
});
