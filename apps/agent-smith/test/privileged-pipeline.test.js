import test from 'node:test';
import assert from 'node:assert/strict';
import { withPrivilegedPipeline } from '../src/privileged-pipeline.js';
import { config, TARGET_GUILD_ID } from '../src/config.js';
import { assertTarget } from '../src/moderation-policy.js';

test('pipeline validates and persists intent before API, then persists result', async () => {
  const order = [], events = [];
  await withPrivilegedPipeline({ action: { target: 'single' },
    validate: async () => order.push('validate'),
    record: async (event, detail) => { order.push(event); events.push(detail); } },
  async () => order.push('api'));
  assert.deepEqual(order, ['validate','security.intent','api','security.result']);
  assert.equal(events[0].attempt, events[1].attempt);
});
test('failed authorization and failed intent storage never execute', async () => {
  let writes = 0;
  await assert.rejects(withPrivilegedPipeline({ action:{}, validate:async()=>{throw new Error('deny');},
    record:async()=>{} }, async()=>writes++), /deny/);
  await assert.rejects(withPrivilegedPipeline({ action:{}, validate:async()=>{},
    record:async()=>{throw new Error('storage down');} }, async()=>writes++), /storage/);
  await assert.rejects(withPrivilegedPipeline({action:{},validate:async()=>{}},async()=>writes++), /not configured/);
  assert.equal(writes,0);
});
test('uncertain API and post-acknowledgement audit failures remain explicit', async () => {
  const events=[];
  await assert.rejects(withPrivilegedPipeline({action:{},validate:async()=>{},
    record:async(event,detail)=>events.push([event,detail])},async()=>{throw new Error('lost acknowledgement');}));
  assert.equal(events[1][1].status,'failed-or-uncertain');
  await assert.rejects(withPrivilegedPipeline({action:{},validate:async()=>{},
    record:async event=>{if(event==='security.result')throw new Error('storage');}},async()=>{}), /Do not retry blindly/);
});
test('secure identity and protected operator allowlist cannot be changed at runtime', () => {
  const cfg=config({DISCORD_TOKEN:'test',DISCORD_CLIENT_ID:'100000000000000001',
    DISCORD_GUILD_ID:TARGET_GUILD_ID,BOOTSTRAP_CONFIRM_GUILD_ID:TARGET_GUILD_ID,
    OWNER_IDS:'100000000000000002',OWNER_DISCORD_ID:'100000000000000002',DATABASE_URL:'test'});
  assert.throws(()=>{cfg.ownerDiscordId='100000000000000003';});
  assert.throws(()=>cfg.owners.push('100000000000000003'));
});
test('all member moderation targets short-circuit protected identities before role reads', () => {
  for(const operation of ['warn','timeout','untimeout','kick','ban','unban']) {
    const target={id:'owner', get roles(){throw new Error('hierarchy read before immunity');}};
    assert.throws(()=>assertTarget({target,ownerDiscordId:'owner',owners:['operator'],operation}),/immune/);
    assert.throws(()=>assertTarget({target:{id:'operator'},ownerDiscordId:'owner',owners:['operator'],operation}),/immune/);
  }
});
