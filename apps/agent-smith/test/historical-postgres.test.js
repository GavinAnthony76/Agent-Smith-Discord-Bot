import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { historicalFixture,ids } from './helpers/historical-fixture.js';
import { createMemberMaintenance } from '../src/maintenance-members.js';
import { runLocked } from '../src/transaction.js';

// Explicit disposable local database only, never the workspace/live DATABASE_URL.
test('isolated PostgreSQL historical review transactions', {skip:!process.env.SMITH_HISTORY_PG_URL},async t=>{
 const url=new URL(process.env.SMITH_HISTORY_PG_URL);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname.startsWith('/smith_history_test'),
  'Historical tests require a disposable local smith_history_test database');
 const schema=`history_${randomUUID().replaceAll('-','')}`;
 const admin=new pg.Pool({connectionString:url.href});
 let pool;
 try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool=new pg.Pool({connectionString:url.href,options:`-c search_path=${schema},public`,max:6});
  await pool.query(`CREATE TABLE members(guild_id text,user_id text,accepted_at timestamptz,primary_framework text,PRIMARY KEY(guild_id,user_id));
   CREATE TABLE grants(guild_id text,user_id text,framework text,reviewer text,created_at timestamptz DEFAULT now(),PRIMARY KEY(guild_id,user_id,framework));
   CREATE TABLE requests(id bigserial PRIMARY KEY,guild_id text,user_id text,framework text,status text DEFAULT 'pending',expires_at timestamptz);
   CREATE TABLE audit(id bigserial PRIMARY KEY,guild_id text,actor text,action text,detail jsonb,created_at timestamptz DEFAULT now());
   CREATE TABLE resources(guild_id text,kind text,name text,discord_id text,PRIMARY KEY(guild_id,kind,name));
   CREATE TABLE bot_settings(guild_id text,key text,value jsonb,PRIMARY KEY(guild_id,key));`);
  await pool.query(await readFile(new URL('../src/maintenance-schema.sql',import.meta.url),'utf8'));
  const f=historicalFixture(pool,(key,fn)=>runLocked(pool,`${schema}:${key}`,fn)),r=f.review;
  for(const [name,id] of Object.entries(f.roles))await pool.query("INSERT INTO resources VALUES($1,'role',$2,$3)",[ids.guild,name,id]);
  const consent=async()=>{const p=await r.consentPreview(ids.member,'Gaming');await r.consent(ids.member,'Gaming',p.token);};
  const preview=()=>r.preview(ids.member,ids.owner,'Gaming','Faith');
  const record=p=>r.record(ids.member,ids.owner,'Gaming','Faith',p.token);
  await t.test('consent is separate, approval is current, and repeat recording is safe',async()=>{
   await assert.rejects(preview(),/framework-consent/);await consent();
   assert.equal((await pool.query('SELECT * FROM members')).rowCount,0);
   const confirmed=(await pool.query("SELECT * FROM audit WHERE action='historical-framework-consent'")).rows[0];
   const start=new Date();await record(await preview());const end=new Date();
   const member=(await pool.query('SELECT * FROM members')).rows[0];
   assert.equal(member.accepted_at.getTime(),confirmed.created_at.getTime());
   assert.equal(member.primary_framework,'Gaming');
   const grant=(await pool.query('SELECT * FROM grants')).rows[0];
   assert.equal(grant.reviewer,ids.owner);assert.ok(grant.created_at>=start&&grant.created_at<=end);
   const event=(await pool.query("SELECT * FROM audit WHERE action='historical-framework-reviewed'")).rows[0];
   assert.ok(event.created_at>=start&&event.created_at<=end);
   const replay=await preview();await record(replay);await record(replay);
   assert.equal((await pool.query('SELECT * FROM grants')).rowCount,1);
   assert.equal((await pool.query("SELECT * FROM audit WHERE action='historical-framework-reviewed'")).rowCount,1);
   assert.deepEqual(f.mutations,[]);
  });
  await t.test('remaining historical extras survive maintenance after recording',async()=>{
   await pool.query('UPDATE members SET access_authoritative=true');
   await record(await preview());
   assert.equal((await pool.query('SELECT access_authoritative FROM members')).rows[0].access_authoritative,false);
   // No restoration needed: all authorized roles already held.
   f.member.roles.cache.set(f.roles.Member,f.guild.roles.cache.get(f.roles.Member));
   const maintenance=createMemberMaintenance(f);
   const result=await maintenance.reconcile(ids.member);
   assert.equal(result.state,'ONBOARDING_BLOCKED');
   assert.equal(result.reason,'unrecorded-access-needs-human-review');
   assert.ok(f.member.roles.cache.has(f.roles.Tech));assert.deepEqual(f.mutations,[]);
   await pool.query("UPDATE members SET onboarding_flow='staged',rules_version_accepted='1'");
   await maintenance.finish(ids.member);
   assert.equal((await pool.query('SELECT access_authoritative FROM members')).rows[0].access_authoritative,false);
   assert.ok(f.member.roles.cache.has(f.roles.Tech),'Finishing interests cannot revoke pending historical access');
  });
  await t.test('audit failure rolls back member and grant changes without touching roles',async()=>{
   await pool.query('DELETE FROM grants;DELETE FROM members;');
   const p=await preview();
   await pool.query(`CREATE FUNCTION reject_review() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='historical-framework-reviewed' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_review BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_review();`);
   await assert.rejects(record(p),/test audit failure/);
   assert.equal((await pool.query('SELECT * FROM grants')).rowCount,0);
   assert.equal((await pool.query('SELECT * FROM members')).rowCount,0);
   await pool.query('DROP TRIGGER reject_review ON audit;DROP FUNCTION reject_review();');
   assert.deepEqual(f.mutations,[]);
  });
  await t.test('overlapping reviews really wait on PostgreSQL and produce one winning approval',async()=>{
   const p=await preview();
   const blocker=await pool.connect();let first,second;
   try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${schema}:${ids.guild}:${ids.member}`]);
    first=record(p);second=r.record(ids.member,ids.secondary,'Gaming','Faith',p.token);
    // Attach rejection handlers immediately; both will settle after release.
    const resultsPromise=Promise.allSettled([first,second]);
    let observed=false;
    for(let i=0;i<80;i++) {
     const waiters=await admin.query(`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE l.locktype='advisory' AND NOT l.granted AND a.datname=$1`,[url.pathname.slice(1)]);
     if(waiters.rows[0].n>=2){observed=true;break;}
     await new Promise(resolve=>setTimeout(resolve,15));
    }
    assert.ok(observed,'Both Owner decisions must overlap and visibly wait in PostgreSQL');
    // Transaction start timestamps are before this delay; event clock timestamps must be after it.
    const releasedAt=new Date();await blocker.query('COMMIT');
    const results=await resultsPromise;
    assert.equal(results.filter(v=>v.status==='fulfilled').length,1);
    assert.equal(results.filter(v=>v.status==='rejected').length,1);
    assert.match(results.find(v=>v.status==='rejected').reason.message,/state changed/);
    const grant=(await pool.query('SELECT * FROM grants')).rows[0];
    assert.ok([ids.owner,ids.secondary].includes(grant.reviewer));
    assert.ok(grant.created_at>=releasedAt);
    const events=(await pool.query("SELECT * FROM audit WHERE action='historical-framework-reviewed' ORDER BY id DESC")).rows;
    assert.equal(events.filter(e=>e.detail.recordedExtra).length,2,'Earlier completed fixture approval plus exactly one concurrent approval');
    assert.ok(events[0].created_at>=releasedAt);
    assert.equal(events[0].actor,grant.reviewer);
   } finally {
    await blocker.query('ROLLBACK');blocker.release();
    await Promise.allSettled([first,second].filter(Boolean));
   }
  });
  await t.test('fresh primary, request and consent changes defeat stale confirmations',async()=>{
   await pool.query('DELETE FROM grants;UPDATE members SET primary_framework=NULL,accepted_at=NULL;');
   const p=await preview();
   await pool.query("UPDATE members SET primary_framework='Tech'");
   await assert.rejects(record(p),/immutable/);
   await pool.query('UPDATE members SET primary_framework=NULL');
   await pool.query("INSERT INTO requests(guild_id,user_id,framework) VALUES($1,$2,'Faith')",[ids.guild,ids.member]);
   await assert.rejects(record(p),/pending access request/);
   await pool.query('DELETE FROM requests');
   await pool.query("INSERT INTO bot_settings VALUES($1,'rules-version','\"2\"')",[ids.guild]);
   await assert.rejects(record(p),/framework-consent/);
   assert.equal((await pool.query('SELECT * FROM grants')).rowCount,0);
   assert.deepEqual(f.mutations,[]);
  });
 } finally {
  if(pool)await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
 }
});
