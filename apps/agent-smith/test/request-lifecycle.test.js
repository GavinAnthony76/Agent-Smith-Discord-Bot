import test from 'node:test';
import assert from 'node:assert/strict';
import { botFixture, replyText } from './helpers/bot-fixture.js';
import { createRequestLifecycle, requestExpired } from '../src/request-lifecycle.js';
import { pendingMessage } from '../src/review.js';
import { assertAutomodAction, AUTOMOD_ACTIONS, smithControlCommand } from '../src/smith-control.js';

test('request expiry defaults to 14 days; member inbox exposes withdrawal and resubmission', async()=>{
  const f=await botFixture();
  await f.dispatch();
  assert(Math.abs(new Date(f.state.requests[0].expires_at).getTime()-Date.now()-14*86400000)<5000);
  const inbox=await f.dispatch({kind:'command',command:'requests'});
  assert.match(replyText(inbox),/pending/);
  assert.equal(inbox.replies[0].components[0].toJSON().components[0].custom_id,'smith:request:withdraw:1');
  const withdrawn=await f.dispatch({kind:'button',customId:'smith:request:withdraw:1'});
  assert.match(replyText(withdrawn),/withdrawn/);
  assert.equal(f.state.requests[0].status,'withdrawn');
  assert.equal(f.state.audits.at(-1).detail.to,'withdrawn');
  const duplicate=await f.dispatch({kind:'button',customId:'smith:request:withdraw:1'});
  assert.match(replyText(duplicate),/no longer pending/);
  await f.dispatch();
  assert.equal(f.state.requests[1].status,'pending');
  assert.equal(f.state.roleAdds.length,0);
  f.database.assertIdle();
});
test('forged withdrawal cannot affect another requester; expired review grants nothing',async()=>{
  const f=await botFixture();f.seed('other');
  await f.dispatch();
  const forged=await f.dispatch({kind:'button',user:'other',customId:'smith:request:withdraw:1'});
  assert.match(replyText(forged),/only your own/);
  assert.equal(f.state.requests[0].status,'pending');
  f.state.requests[0].expires_at='2020-01-01T00:00:00Z';
  const review=await f.dispatch({kind:'command',command:'review',user:'owner',approve:true});
  assert.match(replyText(review),/expired.*No access was granted/);
  assert.equal(f.state.requests[0].status,'expired');
  assert.equal(f.state.roleAdds.length,0);
});
test('approval and withdrawal use the same member lock; only the winning decision survives', {timeout:5000},async()=>{
  const f=await botFixture();await f.dispatch();
  const gate=f.database.holdNextQuery(q=>q.sql==='SELECT * FROM requests WHERE id=$1 FOR UPDATE');
  const waiting=f.database.waitForBlockedLock('advisory:test-guild:member');
  const approve=f.dispatch({kind:'command',command:'review',user:'owner',approve:true});
  let withdraw;
  try {
    await gate.entered;
    withdraw=f.dispatch({kind:'button',customId:'smith:request:withdraw:1'});
    await waiting;
  }finally{gate.release();}
  const [,loser]=await Promise.all([approve,withdraw]);
  assert.match(replyText(loser),/no longer pending/);
  assert.equal(f.state.requests[0].status,'approved');
  assert.equal(f.state.roleAdds.length,1);
  f.database.assertIdle();
});
test('staff cards show age and near-expiry warning',()=>{
  const now=Date.now();
  const card=pendingMessage([{id:'1',framework:'Tech',user_id:'member',
    created_at:new Date(now-13*86400000),expires_at:new Date(now+86400000)}]);
  assert.match(card.content,/13d old/);assert.match(card.content,/expires in 1d/);
  assert.equal(requestExpired({expires_at:new Date(now-1)},now),true);
});
test('expiry sweep saves transition and notification; unconfirmed DMs are not auto-resent',async()=>{
  const uid='100000000000000003',request={id:'1',user_id:uid,framework:'Tech',status:'pending',expires_at:'2020-01-01'};
  const notice={request_id:'1',user_id:uid,framework:'Tech',status:'pending'},events=[];
  let sends=0;
  const pool={query:async(sql,args)=>{
    if(sql.startsWith('SELECT id,user_id FROM requests'))return{rows:request.status==='pending'?[request]:[]};
    if(sql.startsWith('SELECT * FROM requests'))return{rows:request.status==='pending'?[request]:[]};
    if(sql.startsWith('UPDATE requests SET status')){request.status=args[2];return{rows:[request]};}
    if(sql.startsWith('INSERT INTO audit'))events.push(args[2]);
    if(sql.startsWith('SELECT * FROM request_notifications'))return{rows:notice.status==='pending'?[notice]:[]};
    if(sql.includes("SET status='sending'")){notice.status='sending';return{rows:[notice]};}
    if(sql.includes("SET status='uncertain'"))notice.status='uncertain';
    return{rows:[]};
  }};
  const worker=createRequestLifecycle({guild:{id:'guild',members:{fetch:async()=>({send:async()=>{sends++;throw new Error('lost ack');}})}},
    client:{user:{id:'bot'}},pool,locked:async(_key,fn)=>fn(pool)});
  await worker.expire();await worker.expire();
  assert.equal(request.status,'expired');assert.equal(notice.status,'uncertain');
  assert.equal(sends,1);assert.deepEqual(events,['request.transition']);
});
test('automod action allowlist cannot contain punishment, even in tampered settings',()=>{
  assert.deepEqual(AUTOMOD_ACTIONS,['log-only','escalate']);
  for(const action of ['delete','warn','timeout','kick','ban','mass-ban'])assert.throws(()=>assertAutomodAction(action),/disabled/);
  assert.doesNotThrow(()=>smithControlCommand.toJSON());
});
