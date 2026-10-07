import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PermissionsBitField } from 'discord.js';
import { createMemberMaintenance } from '../src/maintenance-members.js';
import { createCases } from '../src/maintenance-cases.js';
import { createReports } from '../src/maintenance-reports.js';
import { createEconomy } from '../src/community-economy.js';
import { registerSecurityConfiguration } from '../src/security-policy.js';
import { frameworks,interests } from '../src/blueprint.js';
test('isolated PostgreSQL maintenance persistence and recovery', {skip:process.env.SMITH_PG_TESTS!=='1'},async t=>{
 const schema=`smith_test_${randomUUID().replaceAll('-','')}`;
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 let pool;
 try{
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`,max:5});
  await pool.query(`CREATE TABLE members(guild_id text,user_id text,accepted_at timestamptz,primary_framework text,PRIMARY KEY(guild_id,user_id));
   CREATE TABLE requests(id bigserial PRIMARY KEY,guild_id text,user_id text,framework text,status text DEFAULT 'pending',expires_at timestamptz);
   CREATE TABLE resources(guild_id text,kind text,name text,discord_id text,PRIMARY KEY(guild_id,kind,name));
   CREATE TABLE grants(guild_id text,user_id text,framework text,reviewer text,PRIMARY KEY(guild_id,user_id,framework));
   CREATE TABLE bot_settings(guild_id text,key text,value jsonb,PRIMARY KEY(guild_id,key));
   CREATE TABLE audit(id bigserial PRIMARY KEY,guild_id text,actor text,action text,detail jsonb,created_at timestamptz DEFAULT now());`);
  const sql=await readFile(new URL('../src/maintenance-schema.sql',import.meta.url),'utf8');
  const guildId='123456789012345678',uid='223456789012345678',owner='323456789012345678',bot='423456789012345678';
  await pool.query('INSERT INTO members VALUES($1,$2,now(),$3)',[guildId,uid,'Gaming']);
  await pool.query(`INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,'mod.intent',$3)`,[guildId,owner,JSON.stringify({operation:'timeout',target:uid,minutes:20,reason:'Unconfirmed old intent'})]);
  await pool.query(sql);
  await t.test('additive migration is repeatable and does not invent historical success',async()=>{
   await pool.query(sql);
   const r=(await pool.query('SELECT * FROM members')).rows[0];
   assert.equal(r.primary_framework,'Gaming');assert.equal(r.rules_version_accepted,'legacy-unversioned');
   const c=(await pool.query('SELECT * FROM moderation_cases')).rows[0];
   assert.equal(c.status,'uncertain');assert.equal(c.active,false);
  });
  const roleCache=new Map(),held=new Map(),mutations=[];
  for(const name of ['Member','NEW ARRIVAL',...frameworks,...Object.values(interests).flat().map(n=>`Interest: ${n}`)]) {
   const role={id:`role-${name}`,name,editable:true,permissions:new PermissionsBitField(0n)};
   roleCache.set(role.id,role);
   await pool.query("INSERT INTO resources VALUES($1,'role',$2,$3)",[guildId,name,role.id]);
  }
  const member={id:uid,user:{id:uid,bot:false},pending:false,joinedAt:new Date(),roles:{cache:held,
   async add(role){const id=typeof role==='string'?role:role.id;held.set(id,roleCache.get(id));mutations.push(['add',id]);},
   async remove(role){const id=typeof role==='string'?role:role.id;held.delete(id);mutations.push(['remove',id]);}},
   async disableCommunicationUntil(expiry){member.communicationDisabledUntilTimestamp=expiry.getTime();mutations.push(['timeout',expiry.getTime()]);}};
  const guild={id:guildId,ownerId:owner,async fetch(){return guild;},
   roles:{cache:roleCache,async fetch(id){return id?roleCache.get(id):roleCache;}},
   members:{async fetch(input){if(!input)return new Map([[uid,member]]);assert.equal(input.user,uid);return member;}}};
  member.guild=guild;
  const cfg={clientId:bot,ownerDiscordId:owner,owners:[owner],approvers:[]};
  registerSecurityConfiguration(guild,cfg);
  let gate=false,attempt=0,firstReady,releaseFirst,secondPid;
  const locked=async(key,fn)=>{
   const db=await pool.connect();
   try {
    await db.query('BEGIN');const order=gate?++attempt:0;if(order===2)secondPid=db.processID;
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${schema}:${key}`]);
    if(order===1){firstReady();await new Promise(resolve=>{releaseFirst=resolve;});}
    const value=await fn(db);await db.query('COMMIT');return value;
   }
   catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  };
  const audit=(db,actor,action,detail)=>db.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)',[guildId,actor,action,JSON.stringify(detail)]);
  const resource=async(kind,name,db=pool)=>(await db.query('SELECT discord_id FROM resources WHERE guild_id=$1 AND kind=$2 AND name=$3',[guildId,kind,name])).rows[0].discord_id;
  const ctx={guild,cfg,client:{user:{id:bot}},pool,locked,audit,resource};
  const cases=createCases(ctx);ctx.cases=cases;
  const maintenance=createMemberMaintenance(ctx);
  await t.test('staged consent/finish is idempotent and persists intent before interest recovery',async()=>{
   await pool.query("UPDATE members SET onboarding_flow='staged',accepted_at=NULL,rules_version_accepted=NULL WHERE user_id=$1",[uid]);
   await assert.rejects(maintenance.finish(uid));
   await maintenance.accept(uid,'1');
   const initial=(await pool.query('SELECT rules_accepted_at FROM members')).rows[0].rules_accepted_at;
   await maintenance.accept(uid,'1');
   assert.equal((await pool.query('SELECT rules_accepted_at FROM members')).rows[0].rules_accepted_at.getTime(),initial.getTime());
   await pool.query("INSERT INTO bot_settings VALUES($1,'rules-version','\"2\"')",[guildId]);
   await assert.rejects(maintenance.finish(uid),/current rules/);
   await maintenance.accept(uid,'2');
   await pool.query("DELETE FROM bot_settings WHERE key='rules-version'");
   await maintenance.accept(uid,'1');
   await maintenance.finish(uid);await maintenance.finish(uid);
   assert.equal((await pool.query('SELECT onboarding_status FROM members')).rows[0].onboarding_status,'ACTIVE');
   await maintenance.changeInterest(uid,'Street Fighter 6','Gaming',true);
   assert.ok(held.has('role-Interest: Street Fighter 6'));
   held.delete('role-Interest: Street Fighter 6');
   await maintenance.reconcile(uid);
   assert.ok(held.has('role-Interest: Street Fighter 6'));
  });
  await t.test('rejoin restores approved access but never creates crossover approval',async()=>{
   await pool.query('INSERT INTO grants VALUES($1,$2,$3,$4)',[guildId,uid,'Faith',owner]);
   await maintenance.leave(uid);held.clear();await maintenance.ensure(member);await maintenance.reconcile(uid);
   assert.ok(held.has('role-Gaming'));assert.ok(held.has('role-Faith'));assert.ok(!held.has('role-Tech'));
  });
  await t.test('confirmed punishments restore only remaining timeout duration',async()=>{
   const id=await cases.record(owner,'mod.intent',{operation:'timeout',target:uid,minutes:20,reason:'Verified case'});
   assert.equal(await cases.restricted(uid),false);
   await cases.record(owner,'mod.result',{caseId:id,operation:'timeout',target:uid,status:'completed'});
   assert.equal(await cases.restricted(uid),true);
   const expiry=(await pool.query('SELECT expires_at FROM moderation_cases WHERE case_id=$1',[id])).rows[0].expires_at.getTime();
   await cases.restoreTimeout(uid);assert.equal(member.communicationDisabledUntilTimestamp,expiry);
   const calls=mutations.length;await cases.restoreTimeout(uid);assert.equal(mutations.length,calls);
   await assert.rejects(cases.restoreTimeout(owner),/immune/);
   await cases.note(id,owner,'Preserve original expiry');await cases.close(id,owner);
   assert.equal(await cases.restricted(uid),true,'Closing paperwork must not clear actual punishment');
   await cases.record(owner,'mod.result',{caseId:id,operation:'untimeout',target:uid,status:'completed'});
   assert.equal(await cases.restricted(uid),false);
  });
  await t.test('reports persist and reserve a single punishment per report/action',async()=>{
   const reports=createReports(ctx);
   const id=await reports.submit(uid,uid,'Test report narrative','');
   await assert.rejects(reports.reserveAction(id,owner,'warn'),/Claim/);
   await reports.transition(id,owner,'claim');
   await assert.rejects(reports.reserveAction(id,uid,'warn'),/Claim/);
   await reports.reserveAction(id,owner,'warn');
   await assert.rejects(reports.reserveAction(id,owner,'warn'),/already attempted/);
   await reports.finishAction(id,'warn','completed');
   await reports.transition(id,owner,'close');
   await assert.rejects(reports.reserveAction(id,owner,'timeout'),/Claim/);
   assert.equal((await pool.query('SELECT status FROM member_reports WHERE id=$1',[id])).rows[0].status,'closed');
  });
  await t.test('economy daily requests serialize and purchases cannot double-spend',async()=>{
   await pool.query("INSERT INTO bot_settings VALUES($1,'economy-enabled','true')",[guildId]);
   await pool.query("UPDATE members SET onboarding_status='ACTIVE',left_at=NULL");
   const economy=createEconomy(ctx);
   gate=true;
   const firstAcquired=new Promise(resolve=>{firstReady=resolve;});
   const first=economy.daily(uid);await firstAcquired;
   const second=economy.daily(uid);
   let observed=false;
   try{
    for(let i=0;i<60;i++){
     if(secondPid&&(await admin.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",[secondPid])).rowCount){observed=true;break;}
     await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(observed,'The second transaction must actually wait on PostgreSQL, not run sequentially');
   }finally{releaseFirst();gate=false;}
   const results=await Promise.all([first,second]);
   assert.ok(results.some(v=>v.includes('Already processed')));
   assert.equal((await pool.query('SELECT balance FROM community_wallets')).rows[0].balance,10);
   await pool.query('INSERT INTO community_shop VALUES($1,$2,$3,$4,true)',[guildId,'badge','Cosmetic',10]);
   const purchase=await Promise.allSettled([economy.buy(uid,'badge','523456789012345678'),economy.buy(uid,'badge','623456789012345678')]);
   assert.equal(purchase.filter(p=>p.status==='fulfilled').length,1);
   assert.equal((await pool.query('SELECT balance FROM community_wallets')).rows[0].balance,0);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM community_inventory')).rows[0].n,1);
  });
 }finally{
  if(pool)await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
 }
});
