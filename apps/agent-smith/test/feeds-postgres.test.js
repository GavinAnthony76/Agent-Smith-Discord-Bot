import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { ChannelType, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createFeeds } from '../src/feeds.js';
import { createFeedStore, feedLock } from '../src/feed-store.js';
import { assertFeedSchema } from '../src/feed-schema-check.js';

test('PostgreSQL feed approval, restart and lost-acknowledgment recovery', {skip:process.env.SMITH_PG_TESTS!=='1'},async t=>{
  const schema=`smith_feeds_${randomUUID().replaceAll('-','')}`;
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
  let pool,worker;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    // No public fallback: otherwise existing live tables can hide a missing
    // migration in this disposable schema (or receive an unintended test write).
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`,max:8});
    await pool.query(`CREATE TABLE feed_items(guild_id text,feed_id text,item_id text,sent_at timestamptz DEFAULT now(),PRIMARY KEY(guild_id,feed_id,item_id));
      CREATE TABLE worker_health(guild_id text,worker text,last_seen_at timestamptz,detail jsonb,PRIMARY KEY(guild_id,worker));
      CREATE TABLE audit(guild_id text,actor text,action text,detail jsonb);`);
    const sql=await readFile(new URL('../src/feed-schema.sql',import.meta.url),'utf8');
    await assert.rejects(assertFeedSchema(pool),{code:'SMITH_FEED_SCHEMA_MISSING'});
    await pool.query(sql);await pool.query(sql);
    await assertFeedSchema(pool);
    const guildId='guild',botId='smith',owner='owner';
    const audit=(db,actor,action,detail)=>db.query('INSERT INTO audit VALUES($1,$2,$3,$4)',[guildId,actor,action,JSON.stringify(detail)]);
    const validateURL=async()=>{};
    const store=createFeedStore({pool,guildId,audit,validateURL});
    let items=[],sends=0,threads=0,sendMode='ok',threadMode='ok',ready=true;
    let permissions=P.ViewChannel|P.SendMessages;
    const messages=new Map();
    const channel={id:'news',guildId,type:ChannelType.GuildText,
      permissionsFor:()=>new PermissionsBitField(permissions),
      messages:{async fetch({message}) {return messages.get(message);}},
      async send(options) {
        sends++;assert.deepEqual(options.allowedMentions,{parse:[]});assert.equal(options.enforceNonce,true);
        const message={id:String(10000000000000000n+BigInt(sends)),content:options.content,author:{id:botId},
          async startThread(){threads++;if(threadMode==='lost')throw new Error('Thread acknowledgment lost.');return {id:'thread'};}};
        messages.set(message.id,message);
        if(sendMode==='lost')throw new Error('Send acknowledgment lost.');
        return message;
      }};
    const guild={id:guildId,channels:{async fetch(){return channel;}},
      members:{async fetchMe(){return {permissions:new PermissionsBitField(permissions)};}}};
    const ctx={guild,pool,client:{user:{id:botId},isReady:()=>ready},resource:async()=>channel.id,audit,
      validateURL,fetchFeed:async()=>items,drafts:[{id:'gaming',url:'https://news.com/rss',channel:'gaming-news',enabled:true}]};
    const due=()=>pool.query('UPDATE feed_sources SET next_poll_at=now()');
    const state=async id=>(await pool.query('SELECT * FROM feed_deliveries WHERE item_id=$1',[id])).rows[0];
    const item=id=>({id,title:`Title ${id}`,link:`https://news.com/${id}`,content:`Title ${id}\n<https://news.com/${id}>`});
    worker=createFeeds(ctx);
    await t.test('import is disabled, additive migration preserves legacy history, and approval is explicit',async()=>{
      await store.seed(ctx.drafts);await store.seed(ctx.drafts);
      assert.equal((await store.list())[0].enabled,false);
      await pool.query('INSERT INTO feed_items(guild_id,feed_id,item_id) VALUES($1,$2,$3)',[guildId,'gaming','old']);
      items=[item('old'),item('new')];await worker.drain();assert.equal(sends,0);
      await worker.approve('gaming',true,owner);
      await worker.drain();assert.equal(sends,1);assert.equal((await state('new')).state,'delivered');
      assert.equal(threads,0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM feed_items')).rows[0].n,2);
    });
    await t.test('restart deduplicates stable IDs and links without changing approval',async()=>{
      await worker.stop();worker=createFeeds(ctx);await due();await worker.drain();assert.equal(sends,1);
      items=[{...item('new'),id:'changed-guid'}];await due();await worker.drain();assert.equal(sends,1);
      assert.equal((await store.list())[0].enabled,true);
    });
    await t.test('send succeeds remotely but acknowledgment is lost: hold without retry across restart',async()=>{
      sendMode='lost';items=[item('lost-send')];await due();await worker.drain();
      assert.equal(sends,2);assert.equal((await state('lost-send')).state,'uncertain');
      sendMode='ok';await worker.stop();worker=createFeeds(ctx);await due();await worker.drain();
      assert.equal(sends,2);
      const receipt=(await state('lost-send')).delivery_id;
      await assert.rejects(worker.resolve('gaming',receipt,owner,{messageId:'99999999999999999'}));
      await worker.resolve('gaming',receipt,owner,{messageId:[...messages.keys()].at(-1)});
      assert.equal((await state('lost-send')).state,'delivered');
      await due();await worker.drain();assert.equal(sends,2);
    });
    function loseAck(pattern) {
      let lost=false;
      return {...pool,query:pool.query.bind(pool),async connect() {
        const db=await pool.connect();
        return {async query(sql,params) {
          const result=await db.query(sql,params);
          if(!lost&&pattern.test(sql)){lost=true;throw new Error('Database acknowledgment lost.');}
          return result;
        },release:db.release.bind(db)};
      }};
    }
    await t.test('lost advisory-lock acknowledgment does not leave a pooled session holding the source lock',async()=>{
      const w=createFeeds({...ctx,pool:loseAck(/SELECT pg_try_advisory_lock/)});
      await assert.rejects(w.drain(),/acknowledgment lost/);await w.stop();
      const db=await pool.connect();
      try {
        const result=await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[feedLock(guildId,'gaming')]);
        assert.equal(result.rows[0].acquired,true);
      } finally {await db.query('SELECT pg_advisory_unlock(hashtext($1))',[feedLock(guildId,'gaming')]);db.release();}
    });
    await t.test('durable reservation survives lost acknowledgment before send',async()=>{
      items=[item('reserve-lost')];
      const w=createFeeds({...ctx,pool:loseAck(/INSERT INTO feed_deliveries/)});
      await due();await w.drain();await w.stop();
      assert.equal(sends,2);assert.equal((await state('reserve-lost')).state,'sending');
      await due();await worker.drain();assert.equal(sends,2);
      assert.equal((await state('reserve-lost')).state,'uncertain');
    });
    await t.test('lost confirmation write acknowledgment does not repeat a delivered post',async()=>{
      items=[item('confirm-lost')];
      const w=createFeeds({...ctx,pool:loseAck(/WITH confirmed AS/)});
      await due();await w.drain();await w.stop();
      assert.equal(sends,3);assert.equal((await state('confirm-lost')).state,'delivered');
      await due();await worker.drain();assert.equal(sends,3);
    });
    await t.test('process crash after reservation is held even while source is disabled; explicit skip never reposts',async()=>{
      const source=(await store.list())[0];
      await store.reserve(pool,source,item('crashed'),'news');
      await worker.approve('gaming',false,owner);await worker.drain();
      const d=await state('crashed');assert.equal(d.state,'uncertain');
      await worker.resolve('gaming',d.delivery_id,owner,{skip:true});
      await worker.approve('gaming',true,owner);items=[item('crashed')];await due();await worker.drain();
      assert.equal((await state('crashed')).state,'skipped');assert.equal(sends,3);
    });
    await t.test('editing disables approval; optional threads check permissions and never repeat uncertain creation',async()=>{
      await worker.save({id:'gaming',url:'https://news.com/rss',destination:'gaming-news',threads:true},owner);
      assert.equal((await store.list())[0].enabled,false);assert.equal((await store.list())[0].approved_at,null);
      items=[item('thread-denied')];await due();await worker.drain();assert.equal(sends,3);
      await worker.approve('gaming',true,owner);await worker.drain();
      assert.equal(sends,4);assert.equal(threads,0);assert.equal((await state('thread-denied')).thread_state,'permission-denied');
      permissions|=P.CreatePublicThreads|P.SendMessagesInThreads;threadMode='lost';items=[item('thread-lost')];
      await due();await worker.drain();assert.equal(threads,1);assert.equal((await state('thread-lost')).thread_state,'uncertain');
      await worker.stop();worker=createFeeds(ctx);await due();await worker.drain();assert.equal(threads,1);assert.equal(sends,5);
      const receipt=(await state('thread-lost')).delivery_id;
      await worker.resolve('gaming',receipt,owner,{skip:true});
      assert.equal((await state('thread-lost')).state,'delivered');
      assert.equal((await state('thread-lost')).thread_state,'disabled');
      threadMode='ok';items=[item('thread-ok')];await due();await worker.drain();
      assert.equal((await state('thread-ok')).thread_state,'created');assert.equal(threads,2);
    });
    await t.test('all three existing framework destinations work without permission or channel writes',async()=>{
      for(const [id,destination] of [['faith','faith-news'],['tech','tech-news']]) {
        await worker.save({id,url:'https://news.com/rss',destination},owner);
        await worker.approve(id,true,owner);
      }
      items=[item('frameworks')];await due();await worker.drain();
      assert.equal((await store.list()).length,3);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM feed_deliveries WHERE item_id='frameworks' AND state='delivered'")).rows[0].n,3);
    });
    await t.test('source lock prevents overlapping polls; reconnects pause posts; errors stay visible',async()=>{
      const db=await pool.connect();
      try {
        await db.query('SELECT pg_advisory_lock(hashtext($1))',[feedLock(guildId,'gaming')]);
        const before=sends;items=[item('lock')];await due();await worker.drain();
        assert.equal((await state('lock'))?.feed_id!=='gaming',true);
        assert.ok(sends>=before);
      } finally {await db.query('SELECT pg_advisory_unlock(hashtext($1))',[feedLock(guildId,'gaming')]);db.release();}
      ready=false;const before=sends;items=[item('offline')];await due();await worker.drain();assert.equal(sends,before);
      ready=true;const w=createFeeds({...ctx,fetchFeed:async()=>{throw new Error('Bounded fetch failed.');}});
      await due();await w.drain();await w.stop();
      assert.equal((await store.list('gaming'))[0].last_error,'Bounded fetch failed.');
      assert.match(await worker.status('gaming'),/receipt/);
    });
  } finally {
    await worker?.stop();await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
