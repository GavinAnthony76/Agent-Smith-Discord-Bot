/**
 * Explicit DEVELOPMENT integration runner. Only a disposable schema is written.
 * Never connects to Discord, production or an AI provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';
import { createPlatformHttp } from '../src/platform/http.js';
import { FEATURE_CATALOG } from '../src/platform/feature-catalog.js';
import { createActivityService } from '../src/platform/activity.js';
import { meterProvider } from '../src/platform/ai-usage.js';
import { TARGET_GUILD_ID } from '../src/config.js';

if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1' || !process.env.DATABASE_URL)
  throw new Error('Development database required; production/default fallback prohibited.');
const schema = `entitlement_test_${randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const guildId = '80000000000000001', userId = '90000000000000001';
let pool, server;
await test('isolated entitlement lifecycle, HTTP, resource limits and concurrency', async t => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, application_name: schema, max: 8 });
    assert.equal((await pool.query('SHOW search_path')).rows[0].search_path, schema);
    await pool.query(await readFile(new URL('../src/platform/schema.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../src/platform/entitlement-schema.sql', import.meta.url), 'utf8'));
    await pool.query('CREATE TABLE community_shop(guild_id text,item_id text,title text,price integer,enabled boolean,PRIMARY KEY(guild_id,item_id))');
    for (const f of FEATURE_CATALOG) await pool.query(`INSERT INTO platform_features
      (feature_key,display_name,description,module,configuration) VALUES($1,$2,$3,$4,$5)`,
      [f.key,f.displayName,f.description,f.module,{dependencies:f.dependencies}]);
    // Synthetic rules exist ONLY in this schema, not the development public matrix.
    for (const plan of ['FREE','PRO','ULTIMATE']) for (const [key, minimum, limits] of [
      ['xp','PRO',{xp_events_monthly:2}],['levels','ULTIMATE',{level_milestone_count:3}],
      ['shop','PRO',{shop_item_count:1}],['ai','PRO',{ai_requests_monthly:1}],
      ['roles','PRO',{custom_role_count:1}],['advanced_channels','ULTIMATE',{channel_mapping_count:1}],
      ['analytics','FREE',{analytics_retention_days:2}],
    ]) await pool.query(`INSERT INTO platform_feature_policies(plan,feature_key,minimum_plan,limits,approved)
      VALUES($1,$2,$3,$4,true)`,[plan,key,minimum,limits]);
    const discord={client:{isReady:()=>false},authority:async({guildId:id,userId:actor}) =>
      id===guildId && actor===userId ? {installed:true,member:true,role:'OWNER',actor:{id:userId},
        guild:{id:guildId,ownerId:userId,name:'Isolated test',iconURL:()=>null,roles:{cache:new Map()},
          channels:{cache:new Map()},members:{me:{}}}} : null};
    const env={NODE_ENV:'development',OWNER_IDS:userId,PLATFORM_ENABLED_GUILD_IDS:guildId,
      PLATFORM_ENTITLEMENT_GUILD_IDS:guildId,PLATFORM_ENTITLEMENT_POLICY_APPROVED:'true',
      SESSION_SECRET:'synthetic-test-session',DISCORD_CLIENT_ID:'70000000000000001',DISCORD_CLIENT_SECRET:'synthetic-test-client'};
    let handler;
    server=createServer((req,res)=>{void handler(req,res);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const web=createPlatformHttp({pool,discord,origin,env,oauthTransport:async url=>({ok:true,json:async()=>
      url.endsWith('/oauth2/token')?{access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_in:3600}:
        {id:userId,username:'Synthetic admin',avatar:null}})});
    handler=web.handler;
    const begin=await web.oauth.begin(origin);
    const token=await web.oauth.finish({origin,browser:begin.browser,state:new URL(begin.url).searchParams.get('state'),code:'synthetic-code'});
    const session=await web.oauth.session(token);
    const headers={Cookie:`smith_session=${token}`,Origin:origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'};
    const path=`${origin}/api/platform/guilds/${guildId}`;
    const api=(route,method='GET',body)=>fetch(path+route,{method,headers, ...(body?{body:JSON.stringify(body)}:{})});
    const view=async()=>{const res=await api('/entitlements'); assert.equal(res.status,200);return res.json();};
    const assign=async(plan,revision,status='MANUAL')=>api('/entitlements','PUT',{plan,status,reason:'Synthetic acceptance only',expiresAt:null,revision});
    // Adoption is scoped and only creates fixture guild metadata.
    await web.service.authorize(userId,guildId,'settings',true);
    await pool.query(`INSERT INTO platform_modules(guild_id,module_key,enabled,configuration_json,updated_by)
      VALUES($1,'leveling',true,'{}',$2),($1,'economy',true,'{}',$2),($1,'ai',true,'{}',$2)`,[guildId,userId]);
    await t.test('direct API cannot enable PRO features on FREE and UI status matches',async()=>{
      const v=await view();
      assert.equal(v.features.find(f=>f.featureKey==='xp').state,'LOCKED_BY_PLAN');
      const res=await api('/modules/leveling','PUT',{enabled:true,configuration:{},revision:1});
      assert.equal(res.status,403);assert.equal((await res.json()).error,'feature_not_enabled_for_community');
      assert.equal((await api('/collections/shop','POST',{title:'Blocked',data:{price:1,enabled:true}})).status,403);
    });
    await t.test('controlled manual plan assignment is audited and cannot bypass CSRF/admin/scope',async()=>{
      const body={plan:'ULTIMATE',status:'MANUAL',revision:0,reason:'Not authorized'};
      assert.equal((await fetch(path+'/entitlements',{method:'PUT',headers:{...headers,'X-CSRF-Token':''},body:JSON.stringify(body)})).status,403);
      env.OWNER_IDS='';
      assert.equal((await assign('ULTIMATE',0)).status,403);
      env.OWNER_IDS=userId;
      assert.equal((await api('/entitlements','PUT',{...body,guildId:TARGET_GUILD_ID})).status,400);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM platform_plan_assignments')).rows[0].n,0);
      const before=(await pool.query('SELECT module_key,enabled,configuration_json FROM platform_modules ORDER BY module_key')).rows;
      const upgraded=await assign('PRO',0);assert.equal(upgraded.status,200);
      assert.equal((await upgraded.json()).plan,'PRO');
      assert.deepEqual((await pool.query('SELECT module_key,enabled,configuration_json FROM platform_modules ORDER BY module_key')).rows,before);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM platform_audit WHERE action='plan.manually_assigned'")).rows[0].n,1);
      assert.equal((await assign('ULTIMATE',0)).status,409);
      assert.equal((await view()).features.find(f=>f.featureKey==='levels').state,'LOCKED_BY_PLAN');
    });
    await t.test('resource cap is checked inside SQL transaction and cannot be bypassed by POST',async()=>{
      assert.equal((await api('/collections/shop','POST',{title:'First item',data:{price:1,enabled:true}})).status,200);
      assert.equal((await api('/collections/shop','POST',{title:'Over limit',data:{price:1,enabled:true}})).status,409);
      const shop=(await view()).features.find(f=>f.featureKey==='shop');
      assert.equal(shop.state,'LIMIT_REACHED');assert.equal(shop.limits[0].used,1);
    });
    await t.test('aggregate setup and single module enables cannot bypass active-module capacity',async()=>{
      await pool.query(`INSERT INTO platform_feature_policies(plan,feature_key,limits,approved)
        VALUES('PRO','configuration','{"module_configuration_count":3}',true)`);
      assert.equal((await api('/modules/welcome','PUT',{enabled:true,configuration:{},revision:0})).status,409);
      assert.equal((await api('/setup','PUT',{modules:['welcome'],logChannelId:null,welcomeChannelId:null})).status,409);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM platform_modules')).rows[0].n,3);
      await pool.query("DELETE FROM platform_feature_policies WHERE feature_key='configuration'");
    });
    await t.test('real overlapping XP writes serialize on guild row and cannot exceed monthly quota',async()=>{
      await pool.query('INSERT INTO platform_member_profiles(guild_id,user_id) VALUES($1,$2)',[guildId,userId]);
      await pool.query(`INSERT INTO platform_xp_events(guild_id,user_id,event_id,source,amount) VALUES($1,$2,'prior','text',1)`,[guildId,userId]);
      let release, locked;
      const held=new Promise(resolve=>{release=resolve;});const firstLock=new Promise(resolve=>{locked=resolve;});
      let number=0;
      const wrapped={connect:async()=>{
        const db=await pool.connect();const index=++number;
        return {release:()=>db.release(),query:async(sql,args)=>{
          const result=await db.query(sql,args);
          if(index===1 && /FROM platform_guilds.*FOR UPDATE/.test(sql)){locked();await held;}
          return result;
        }};
      }};
      const activity=createActivityService(wrapped,{entitlements:web.service.entitlements});
      const message=(i)=>({guildId,channelId:'70000000000000002',id:`8000000000000000${i+2}`,
        author:{id:`9000000000000000${i+2}`,bot:false},content:`Unique meaningful fixture message ${i}`,createdTimestamp:Date.now()});
      const config={textEnabled:true,textAmount:1,dailyCap:100,cooldownSeconds:0};
      const first=activity.awardText(message(1),config);await firstLock;
      const second=activity.awardText(message(2),config);
      // Record the rejection handler before release to avoid an unhandled rejection.
      const results=Promise.allSettled([first,second]);
      let observed=false;
      for(let i=0;i<100;i++){
        const waits=await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE application_name=$1 AND wait_event_type='Lock'`,[schema]);
        if(waits.rows[0].n){observed=true;break;}
        await new Promise(r=>setTimeout(r,10));
      }
      release();const completed=await results;
      assert.equal(observed,true,'Real PostgreSQL lock wait must be observed, not merely lock SQL');
      assert.equal(completed.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(completed.find(r=>r.status==='rejected').reason.code,'plan_limit_reached');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM platform_xp_events')).rows[0].n,2);
    });
    await t.test('AI allowance is atomic and token usage is persisted without real provider calls',async()=>{
      let calls=0;
      const provider={configured:true,complete:async(_m,_s,{onUsage})=>{calls++;onUsage({prompt_tokens:2,completion_tokens:3});return 'Synthetic only';}};
      const metered=meterProvider({pool,provider,guildId,entitlements:web.service.entitlements});
      const outcomes=await Promise.allSettled([metered.complete([]),metered.complete([])]);
      assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);
      const r=(await pool.query('SELECT * FROM platform_ai_periods WHERE guild_id=$1',[guildId])).rows[0];
      assert.equal(Number(r.requests),1);assert.equal(Number(r.input_tokens),2);assert.equal(Number(r.output_tokens),3);
    });
    await t.test('upgrade, downgrade and expiry preserve records, earned progression and configuration',async()=>{
      assert.equal((await assign('ULTIMATE',1)).status,200);
      const ultimate=await view();
      assert.equal(ultimate.features.find(f=>f.featureKey==='levels').entitled,true);
      const old=(await pool.query('SELECT * FROM platform_records ORDER BY record_id')).rows;
      const profiles=(await pool.query('SELECT * FROM platform_member_profiles ORDER BY user_id')).rows;
      const modules=(await pool.query('SELECT * FROM platform_modules ORDER BY module_key')).rows;
      assert.equal((await assign('FREE',2)).status,200);
      assert.deepEqual((await pool.query('SELECT * FROM platform_records ORDER BY record_id')).rows,old);
      assert.deepEqual((await pool.query('SELECT * FROM platform_member_profiles ORDER BY user_id')).rows,profiles);
      assert.deepEqual((await pool.query('SELECT * FROM platform_modules ORDER BY module_key')).rows,modules);
      assert.equal((await api('/collections/shop')).status,200,'Earned/configuration data remains readable');
      assert.equal((await api('/collections/shop','POST',{title:'No new usage',data:{price:1}})).status,403);
      const expired=await api('/entitlements','PUT',{plan:'ULTIMATE',status:'TRIAL',revision:3,reason:'Expiry fixture',expiresAt:'2020-01-01T00:00:00Z'});
      assert.equal(expired.status,200);const v=await expired.json();
      assert.equal(v.status,'EXPIRED');assert.equal(v.effectivePlan,'FREE');
      assert.equal(v.features.find(f=>f.featureKey==='xp').entitled,false);
      env.PLATFORM_ENTITLEMENT_POLICY_APPROVED='false';
      assert.equal((await view()).policyMode,'PRESERVE_ACCESS');
      assert.equal((await view()).features.find(f=>f.featureKey==='xp').entitled,true);
    });
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await pool?.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
