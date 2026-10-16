/**
 * Explicit development-only PostgreSQL/HTTP regression. No Gateway, OAuth,
 * Discord requests or writes to public. Run with:
 * node --test test/stabilization.integration.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';
import { Collection, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createSetupService } from '../src/platform/setup.js';
import { createPlatformHttp } from '../src/platform/http.js';
import { authorizeTenant, MODULE_KEYS } from '../src/platform/catalog.js';
import { capabilities } from '../src/permissions.js';
import { TARGET_GUILD_ID } from '../src/config.js';
import { reviewedGamingForum } from '../src/reviewed-forum-policy.js';
import { seedReviewedForum } from './helpers/reviewed-forum-fixture.js';

if(process.env.NODE_ENV==='production' || process.env.REPLIT_DEPLOYMENT==='1' || !process.env.DATABASE_URL)
  throw new Error('Explicit development database required. Production is prohibited.');
const schema=`stabilization_test_${randomBytes(8).toString('hex')}`;
const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
let pool,server;
const ownerId='90000000000000001',botId='90000000000000002';
const role=(id,name,position)=>({id,name,position,managed:false,editable:true,
  permissions:new PermissionsBitField(),comparePositionTo(other){return this.position-other.position;}});
const everyone=role(TARGET_GUILD_ID,'@everyone',0);
const ownerRole=role('90000000000000003','Owner',100),botRole=role('90000000000000004','Agent Smith',50);
const roles=new Collection([everyone,ownerRole,botRole].map(value=>[value.id,value]));
for(const [index,name] of ['Member','Faith','Gaming','Tech'].entries()) {
  const id=name==='Gaming'?reviewedGamingForum.roleId:`9000000000000001${index}`;
  roles.set(id,role(id,name,10));
}
const owner={id:ownerId,permissions:new PermissionsBitField(P.Administrator),
  roles:{highest:ownerRole,cache:new Collection([[ownerRole.id,ownerRole]])}};
const bot={id:botId,permissions:new PermissionsBitField(capabilities.allowed.map(key=>P[key])),
  roles:{highest:botRole,cache:new Collection([[botRole.id,botRole]])}};
const guild={id:TARGET_GUILD_ID,name:'Isolated Hallowed fixture',ownerId,
  roles:{everyone,cache:roles},channels:{cache:new Collection()},members:{me:bot,fetch:async()=>owner}};
bot.guild=guild;
const forumRows=[];
const reviewedForum=seedReviewedForum({guild,role:roles.get(reviewedGamingForum.roleId),bot,rows:forumRows});
let connected=true,commandsAvailable=true,authorityRole='OWNER',sessionPresent=true,fault;
const discord={
  client:{isReady:()=>connected,user:{id:botId},rest:{get:async()=>{
    if(!commandsAvailable) throw Object.assign(new Error('Simulated Discord unavailable'),{status:503});
    return [{name:'accept'},{name:'join'}];
  }}},
  memberRolesVerified:()=>true,
  authority:async({guildId,userId})=>guildId===guild.id && userId===ownerId?
    {installed:true,member:true,role:authorityRole,guild,actor:owner}:null,
};
const input={modules:['moderation','onboarding'],logChannelId:null,welcomeChannelId:null};
const runtimeStatus=async()=>({botConnected:connected,runtimeActive:connected});
const options=()=>({pool,discord,env:{DISCORD_CLIENT_ID:botId},runtimeStatus,
  entitlements:{enforced:()=>false,requireModule:async()=>{}},
  defaultModule:()=>({configuration:{fixture:true}})});
async function authority() {
  const permit=await authorizeTenant({guildId:guild.id,userId:ownerId,capability:'settings',write:true,
    resolve:()=>discord.authority({guildId:guild.id,userId:ownerId})});
  return {permit,guild,actor:owner,role:authorityRole};
}
async function fresh() {
  await pool.query('DELETE FROM platform_audit');
  await pool.query("DELETE FROM platform_records WHERE collection='system-setup'");
  await pool.query('DELETE FROM platform_modules');
  await pool.query('DELETE FROM platform_entitlements');
  await pool.query('DELETE FROM platform_guilds');
  connected=true;commandsAvailable=true;authorityRole='OWNER';sessionPresent=true;fault=null;
}
function failingPool(base) {
  return new Proxy(base,{get(target,key) {
    if(key==='connect') return async()=>failingPool(await target.connect());
    if(key==='query') return async(...args)=>{
      const sql=String(args[0]);
      if(fault?.when(sql)) {
        const current=fault;fault=null;
        if(current.after) await target.query(...args);
        throw Object.assign(new Error('Simulated database transport failure'),{code:'08006'});
      }
      return target.query(...args);
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
}
test('stabilization real PostgreSQL and HTTP, strictly isolated',async t=>{
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const raw=new pg.Pool({connectionString:process.env.DATABASE_URL,
      options:`-c search_path=${schema}`,max:5});
    pool=failingPool(raw);
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name,schema);
    await pool.query(await readFile(new URL('../src/platform/schema.sql',import.meta.url),'utf8'));
    await pool.query('CREATE TABLE resources(guild_id text,kind text,name text,discord_id text,PRIMARY KEY(guild_id,kind,name))');
    for(const value of roles.values()) if(['Member','Faith','Gaming','Tech'].includes(value.name))
      await pool.query('INSERT INTO resources VALUES($1,$2,$3,$4)',[guild.id,'role',value.name,value.id]);
    for(const row of forumRows)
      await pool.query('INSERT INTO resources VALUES($1,$2,$3,$4)',[guild.id,row.kind,row.name,row.discord_id]);
    const setup=createSetupService(options());
    const confirmed=async a=>{
      const preview=await setup.preflight(a,input);
      assert.notEqual(preview.classification,'BLOCKED',JSON.stringify(preview));
      return {...input,confirmed:true,expectedRevision:preview.revision,previewHash:preview.previewHash};
    };
    await t.test('old missing-guild assumption reproduces FK 23503; no writes escape fixture',async()=>{
      await assert.rejects(pool.query(`INSERT INTO platform_modules(guild_id,module_key,enabled,updated_by)
        VALUES($1,'moderation',true,$2)`,[guild.id,ownerId]),error=>error.code==='23503');
    });
    await t.test('missing guild setup creates parent first and all eight steps become ready',async()=>{
      const a=await authority();await setup.run(a,await confirmed(a));
      const state=await setup.state(a);
      assert.equal(state.state,'READY');assert.equal(state.steps.length,8);
      assert.ok(state.steps.every(step=>step.status==='COMPLETE'));
      assert.equal((await pool.query('SELECT count(*) FROM platform_modules')).rows[0].count,String(MODULE_KEYS.length));
    });
    await t.test('a display-only forum rename preserves setup, idempotency and recovery',async()=>{
      const a=await authority();reviewedForum.forum.name='World of Warcraft';
      try {
        await setup.run(a,await confirmed(a));
        assert.equal((await setup.state(a)).state,'READY');
        assert.equal((await pool.query('SELECT count(*) FROM platform_audit')).rows[0].count,'1');
      } finally {reviewedForum.forum.name='mmo-thread';}
    });
    await t.test('identity or parent drift blocks preflight without modifying configured state',async()=>{
      const a=await authority(),before=(await setup.state(a)).revision;
      reviewedForum.forum.parentId='different-parent';
      try {
        const checked=await setup.preflight(a,input);
        assert.equal(checked.classification,'BLOCKED');assert.equal(checked.failureStatus,422);
        assert.equal((await setup.state(a)).revision,before);
      } finally {reviewedForum.forum.parentId=reviewedGamingForum.parentId;}
    });
    await t.test('repeat is idempotent and does not rewrite defaults or add an audit',async()=>{
      const a=await authority();
      await pool.query("UPDATE platform_modules SET configuration_json='{\"ownerEdited\":true}' WHERE module_key='moderation'");
      await setup.run(a,await confirmed(a));
      assert.equal((await pool.query("SELECT configuration_json FROM platform_modules WHERE module_key='moderation'")).rows[0].configuration_json.ownerEdited,true);
      assert.equal((await pool.query('SELECT count(*) FROM platform_audit')).rows[0].count,'1');
    });
    await t.test('stale revision is 409, and does not overwrite READY',async()=>{
      const a=await authority(),changed={...input,modules:['moderation']};
      const preview=await setup.preflight(a,changed);
      await assert.rejects(setup.run(a,{...changed,confirmed:true,previewHash:preview.previewHash,expectedRevision:0}),e=>e.status===409);
      assert.equal((await setup.state(a)).state,'READY');
    });
    await t.test('partial configuration rolls back, retains journal, and resumes without duplicates',async()=>{
      await fresh();const a=await authority(),confirmedInput=await confirmed(a);
      let inserts=0;fault={when:sql=>sql.includes('INSERT INTO platform_modules') && ++inserts===2};
      await assert.rejects(setup.run(a,confirmedInput));
      assert.equal((await setup.state(a)).state,'DEGRADED');
      assert.equal((await pool.query('SELECT count(*) FROM platform_modules')).rows[0].count,'0');
      await setup.run(a,await confirmed(a));
      assert.equal((await setup.state(a)).state,'READY');
      assert.equal((await pool.query('SELECT count(*) FROM platform_audit')).rows[0].count,'1');
    });
    await t.test('lost final commit acknowledgment preserves committed READY and repeat is safe',async()=>{
      await fresh();const a=await authority(),confirmedInput=await confirmed(a);
      let commits=0;fault={when:sql=>sql==='COMMIT' && ++commits===2,after:true};
      await assert.rejects(setup.run(a,confirmedInput));
      assert.equal((await setup.state(a)).state,'READY');
      await setup.run(a,await confirmed(a));
      assert.equal((await pool.query('SELECT count(*) FROM platform_audit')).rows[0].count,'1');
    });
    await t.test('concurrent setup is serialized and creates one module set',async()=>{
      await fresh();const a=await authority(),confirmedInput=await confirmed(a);
      const results=await Promise.allSettled([setup.run(a,confirmedInput),setup.run(a,confirmedInput)]);
      assert.ok(results.some(result=>result.status==='fulfilled'));
      assert.equal((await pool.query('SELECT count(*) FROM platform_audit')).rows[0].count,'1');
      assert.equal((await pool.query('SELECT count(*) FROM platform_modules')).rows[0].count,String(MODULE_KEYS.length));
    });
    await t.test('missing bot permission blocks preflight without setup writes',async()=>{
      await fresh();const a=await authority(),old=bot.permissions;bot.permissions=new PermissionsBitField();
      try {const p=await setup.preflight(a,input);assert.equal(p.classification,'BLOCKED');assert.equal(p.steps[1].status,'BLOCKED');}
      finally {bot.permissions=old;}
      assert.equal((await pool.query('SELECT count(*) FROM platform_guilds')).rows[0].count,'0');
    });
    await t.test('Owner hierarchy failure refuses setup without changing roles',async()=>{
      botRole.position=150;
      try {assert.equal((await setup.preflight(await authority(),input)).steps[1].status,'BLOCKED');}
      finally {botRole.position=50;}
    });
    await t.test('missing native configuration is 422, not fabricated access or ranks',async()=>{
      await pool.query("DELETE FROM resources WHERE name='Faith'");
      try {assert.equal((await setup.preflight(await authority(),input)).steps[2].status,'BLOCKED');}
      finally {const value=[...roles.values()].find(r=>r.name==='Faith');
        await pool.query('INSERT INTO resources VALUES($1,$2,$3,$4)',[guild.id,'role',value.name,value.id]);}
    });
    await t.test('Discord unavailable is a blocked 503; no automatic command registration',async()=>{
      commandsAvailable=false;
      try {const p=await setup.preflight(await authority(),input);assert.equal(p.failureStatus,503);assert.equal(p.steps[5].status,'BLOCKED');}
      finally {commandsAvailable=true;}
    });
    await t.test('ADMIN cannot perform Owner setup',async()=>{
      authorityRole='ADMIN';
      try {await assert.rejects(setup.preflight(await authority(),input),e=>e.status===403);}
      finally {authorityRole='OWNER';}
    });
    await t.test('permit cannot be reused across guild identities; LMOC and unapproved guild writes refused',async()=>{
      const a=await authority();
      await assert.rejects(setup.state({...a,guild:{...guild,id:'80000000000000001'}}),e=>e.status===403);
      for(const id of ['1555330318569971743','80000000000000001'])
        await assert.rejects(setup.preflight({...a,guild:{...guild,id}},input),e=>e.status===403);
    });
    const http=createPlatformHttp({pool,discord,env:{SESSION_SECRET:'fixture-only',DISCORD_CLIENT_ID:botId},
      origin:'http://fixture.local',runtimeStatus,legacyActions:()=>null});
    http.oauth.session=async()=>sessionPresent?{userId:ownerId,csrfToken:'fixture-csrf',identity:{id:ownerId},
      api:async()=>[{id:guild.id,owner:true}]}:null;
    server=createServer((req,res)=>void http.handler(req,res));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const root=`http://127.0.0.1:${server.address().port}/api/platform/guilds/${guild.id}`;
    const request=(path,body)=>fetch(root+path,body?{method:'POST',
      headers:{Origin:'http://fixture.local','X-CSRF-Token':'fixture-csrf','Content-Type':'application/json'},
      body:JSON.stringify(body)}:{});
    await t.test('authenticated HTTP setup preview and state contract with correlation and timing headers',async()=>{
      const response=await request('/setup/preview',input),data=await response.json();
      assert.equal(response.status,200);assert.equal(data.steps.length,8);
      assert.ok(response.headers.get('x-request-id'));assert.match(response.headers.get('server-timing'),/database/);
    });
    await t.test('database unavailable maps to 503 and returns no SQL internals',async()=>{
      fault={when:sql=>sql.includes('SELECT r.data')};
      const response=await request('/setup'),data=await response.json();
      assert.equal(response.status,503);assert.ok(data.referenceId);assert.ok(data.message);
      assert.doesNotMatch(JSON.stringify(data),/Simulated|SELECT|platform_records|token_ciphertext/);
    });
    await t.test('unsigned session is 401 with a safe diagnostic reference',async()=>{
      sessionPresent=false;const response=await request('/setup');sessionPresent=true;
      assert.equal(response.status,401);assert.ok((await response.json()).referenceId);
    });
    await t.test('observed health contains all eleven requested subsystems, never all-healthy flags',async()=>{
      const response=await request('/system-status'),data=await response.json();
      assert.equal(response.status,200);assert.equal(data.components.length,11);
      assert.equal(data.components.find(c=>c.key==='ai').status,'UNKNOWN');
      assert.ok(Array.isArray(data.recentErrors));
    });
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
