/**
 * Explicit development-only integration runner, not part of the offline suite.
 * Creates and drops only a unique isolated schema. No Gateway or real OAuth call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';
import { createPlatformHttp } from '../src/platform/http.js';
import { createGuildConfigurationService } from '../src/platform/configuration.js';
import { authorizeTenant } from '../src/platform/catalog.js';
import { createTicketService } from '../src/platform/tickets.js';
import { executeTicketWrite } from '../src/platform/ticket-write.js';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createWelcomeService } from '../src/platform/welcome.js';
import { createOnboardingService, claimOnboardingPreDispatchRetry } from '../src/platform/onboarding.js';
import { executeSelfRoleWrite } from '../src/platform/role-write.js';
import { communicationGuard } from '../src/platform/transport.js';
import { createEconomyService } from '../src/platform/economy.js';
import { LMOC_TEST_ID, createActivation, STANDARD_MODULES } from '../src/platform/activation.js';
import { loadReviewedConfiguration, configurationDigest, seedReviewedConfiguration } from '../src/platform/release-config.js';
import { TARGET_GUILD_ID } from '../src/config.js';
import { claimPreDispatchRetry } from '../src/platform/acceptance-resources.js';

if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1' || !process.env.DATABASE_URL) {
  throw new Error('Development database required; production/default fallback is prohibited.');
}
const schema = `platform_test_${randomBytes(8).toString('hex')}`;
if (!/^platform_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe test schema.');
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool, server;
const guildA = '80000000000000001', guildB = '80000000000000002';
const userA = '90000000000000001', userB = '90000000000000002';
const guilds = new Map([[guildA, userA], [guildB, userB]]);
let viewer = false;
const discord = {
  client: { isReady: () => false },
  async authority({ guildId, userId }) {
    if (guilds.get(guildId) !== userId) return null;
    return { installed: true, member: true, role: viewer ? 'VIEW_ONLY' : 'OWNER',
      actor: { id: userId }, guild: { id: guildId, ownerId: userId, name: 'Isolated test guild', iconURL: () => null,
        roles: { cache: new Map() }, channels: { cache: new Map() }, members: { me: {} } } };
  },
};
const configuration = {
  allowedChannels: [], mentionOnly: true, maxTokens: 2048, ttlMinutes: 20,
  cooldownSeconds: 5, model: 'gpt-5.4-mini', personalityAdditions: '',
};

await test('platform HTTP and PostgreSQL isolation', async t => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
      application_name: schema, options: `-c search_path=${schema}`, max: 4 });
    assert.equal((await pool.query('SHOW search_path')).rows[0].search_path, schema);
    await pool.query(await readFile(new URL('../src/platform/schema.sql', import.meta.url), 'utf8'));
    let handler;
    server = createServer((req, res) => { void handler(req, res); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const web = createPlatformHttp({ pool, discord, origin,
      env: { NODE_ENV: 'development', SESSION_SECRET: 'synthetic-integration-key',
        DISCORD_CLIENT_ID: '70000000000000001', DISCORD_CLIENT_SECRET: 'synthetic-integration-client' },
      oauthTransport: async url => ({ ok: true, json: async () => url.endsWith('/oauth2/token') ?
        { access_token: 'synthetic-integration-access', refresh_token: 'synthetic-integration-refresh', expires_in: 3600 } :
        { id: userA, username: 'Synthetic owner', avatar: null } }),
    });
    handler = web.handler;
    const begin = await web.oauth.begin(origin);
    const sessionToken = await web.oauth.finish({ origin, browser: begin.browser,
      state: new URL(begin.url).searchParams.get('state'), code: 'synthetic-code' });
    const session = await web.oauth.session(sessionToken);
    const headers = { Cookie: `smith_session=${sessionToken}`,
      Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
    const endpoint = `/api/platform/guilds/${guildA}/modules/ai`;
    await t.test('unauthenticated and foreign guild access refuse uniformly', async () => {
      assert.equal((await fetch(`${origin}/api/platform/guilds/${guildA}/modules`)).status, 401);
      const response = await fetch(`${origin}/api/platform/guilds/${guildB}/modules`, { headers });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'guild_access_denied' });
      assert.equal(Number((await pool.query('SELECT count(*) FROM platform_guilds')).rows[0].count), 0);
    });
    await t.test('fresh authorized writes persist with atomic audit and optimistic revision', async () => {
      const result = await fetch(origin + endpoint, { method: 'PUT', headers,
        body: JSON.stringify({ enabled: true, configuration, revision: 0 }) });
      assert.equal(result.status, 200);
      assert.equal((await result.json()).revision, 1);
      const reload = await fetch(`${origin}/api/platform/guilds/${guildA}/modules`, { headers });
      assert.equal((await reload.json()).find(module => module.moduleKey === 'ai').configuration.maxTokens, 2048);
      const stale = await fetch(origin + endpoint, { method: 'PUT', headers,
        body: JSON.stringify({ enabled: false, configuration, revision: 0 }) });
      assert.equal(stale.status, 409);
      assert.equal(Number((await pool.query('SELECT count(*) FROM platform_audit WHERE guild_id=$1', [guildA])).rows[0].count), 1);
      assert.equal(Number((await pool.query('SELECT count(*) FROM platform_modules WHERE guild_id=$1', [guildB])).rows[0].count), 0);
    });
    await t.test('CSRF and fresh role revocation prevent writes', async () => {
      const input = JSON.stringify({ enabled: false, configuration, revision: 1 });
      const evil = await fetch(origin + endpoint, { method: 'PUT', headers: { ...headers, Origin: 'https://evil.invalid' }, body: input });
      assert.equal(evil.status, 403);
      const noToken = await fetch(origin + endpoint, { method: 'PUT', headers: { ...headers, 'X-CSRF-Token': '' }, body: input });
      assert.equal(noToken.status, 403);
      viewer = true;
      const revoked = await fetch(origin + endpoint, { method: 'PUT', headers, body: input });
      assert.equal(revoked.status, 403);
      viewer = false;
      assert.equal((await pool.query('SELECT enabled FROM platform_modules WHERE guild_id=$1', [guildA])).rows[0].enabled, true);
    });
    await t.test('real overlapping transactions produce one winner, not two first writes', async () => {
      const permit = await authorizeTenant({ userId: userA, guildId: guildA, capability: 'welcome', write: true,
        resolve: async () => ({ installed: true, member: true, role: 'OWNER' }) });
      let entered, release;
      const hold = new Promise(resolve => { release = resolve; });
      const inside = new Promise(resolve => { entered = resolve; });
      let first = true;
      const service = createGuildConfigurationService(pool, { onSave: async () => {
        if (first) { first = false; entered(); await hold; }
      } });
      const a = service.updateGuildModuleConfig(permit, 'welcome', { enabled: false, configuration: {}, revision: 0 });
      await inside;
      const b = service.updateGuildModuleConfig(permit, 'welcome', { enabled: true, configuration: {}, revision: 0 });
      // Attach failure observation immediately; rejection is expected after release.
      const second = b.then(value => ({ value }), error => ({ error }));
      try {
        const deadline = Date.now() + 4000;
        let blocked = false;
        while (Date.now() < deadline) {
          const row = (await admin.query(
            `SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'`, [schema])).rows[0];
          if (Number(row.count) > 0) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(blocked, 'The second real transaction must be observed waiting on the first.');
      } finally { release(); }
      await a;
      assert.equal((await second).error?.code, 'configuration_changed_reload');
      assert.equal(Number((await pool.query(
        `SELECT count(*) FROM platform_audit WHERE guild_id=$1 AND module='welcome'`, [guildA])).rows[0].count), 1);
    });
    await t.test('private tickets reserve once, retain original ACL and recover lost delivery without resending', async () => {
      const perms = new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageChannels]);
      const actor = { id: userA, pending: false, user: { bot: false }, roles: { cache: new Map() }, permissions: perms };
      const bot = { id: '90000000000000099', permissions: perms };
      const channels = new Map([
        ['81000000000000001', { id: '81000000000000001', type: 0, permissionsFor: () => perms }],
        ['81000000000000002', { id: '81000000000000002', type: 4, permissionsFor: () => perms }],
      ]);
      const guild = { id: guildA, ownerId: userA, roles: { cache: new Map([['81000000000000003', {}], ['81000000000000004', {}]]) },
        members: { me: bot, fetch: async () => actor }, channels: { cache: channels,
          fetch: async id => id ? channels.get(id) : channels } };
      let count = 0, loseCreate = false, duplicateCreate = false;
      const sdk = { rest: {} };
      function applyPermissions(channel, rows) {
        channel.permissionOverwrites = { cache: new Map(rows.map(row => [row.id,
          { allow: new PermissionsBitField(BigInt(row.allow)), deny: new PermissionsBitField(BigInt(row.deny)) }])) };
      }
      function request(method, route, { body }) {
        return executeTicketWrite(sdk, { method, fullRoute: route, body }, async () => {
          if (route === `/guilds/${guildA}/channels`) {
            const channel = { id: String(82000000000000000n + BigInt(++count)), name: body.name,
              topic: body.topic, permissionsFor: () => perms };
            applyPermissions(channel, body.permission_overwrites); channels.set(channel.id, channel);
            if (loseCreate) { loseCreate = false; throw new Error('Synthetic lost acknowledgement'); }
            if (duplicateCreate) {
              duplicateCreate = false;
              const second = { ...channel, id: String(82000000000000000n + BigInt(++count)) };
              channels.set(second.id, second); return second;
            }
            return channel;
          }
          if (method === 'PATCH') {
            const channel = channels.get(route.split('/')[2]);
            applyPermissions(channel, body.permission_overwrites); return channel;
          }
          return { id: '83000000000000001' };
        });
      }
      sdk.rest.post = (route, data) => request('POST', route, data);
      sdk.rest.patch = (route, data) => request('PATCH', route, data);
      const tickets = createTicketService({ client: sdk, pool,
        discord: { freshGuild: async () => guild, memberRolesVerified: () => true } });
      await pool.query(`INSERT INTO platform_modules(guild_id,module_key,enabled,configuration_json,updated_by)
        VALUES($1,'tickets',true,'{}',$2) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true`, [guildA, userA]);
      const panelId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
        VALUES($1,'ticket-panels',$2,'Synthetic Support',$3,$4)`,
        [guildA, panelId, { enabled: true, publishChannelId: '81000000000000001', categoryId: '81000000000000002',
          supportRoles: ['81000000000000003'], questions: [] }, userA]);
      const permit = await authorizeTenant({ userId: userA, guildId: guildA, capability: 'tickets', write: true,
        resolve: async () => ({ installed: true, member: true, role: 'OWNER' }) });
      const authority = { permit };
      await tickets.publish(authority, panelId);
      const args = { guildId: guildA, actorId: userA, panelId,
        channelId: '81000000000000001', messageId: '83000000000000001' };
      const attempts = await Promise.allSettled([tickets.open(args), tickets.open(args)]);
      assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
      assert.equal(count, 1);
      const opened = attempts.find(value => value.status === 'fulfilled').value;
      await tickets.staffAction(authority, { action: 'ticket-claim', target: opened.ticketId });
      await tickets.staffAction(authority, { action: 'ticket-escalate', target: opened.ticketId });
      await pool.query(`UPDATE platform_records SET data=jsonb_set(data,'{supportRoles}',$3::jsonb)
        WHERE guild_id=$1 AND record_id=$2`, [guildA, panelId, JSON.stringify(['81000000000000004'])]);
      await tickets.staffAction(authority, { action: 'ticket-close', target: opened.ticketId, confirmed: true });
      assert.equal((await pool.query('SELECT status FROM platform_ticket_channels WHERE guild_id=$1 AND ticket_id=$2',
        [guildA, opened.ticketId])).rows[0].status, 'closed');
      assert.ok(channels.get(opened.channelId).permissionOverwrites.cache.has('81000000000000003'));
      assert.ok(!channels.get(opened.channelId).permissionOverwrites.cache.has('81000000000000004'));
      loseCreate = true;
      await assert.rejects(tickets.open(args), /Synthetic lost acknowledgement/);
      assert.equal(count, 2);
      await assert.rejects(tickets.open(args), /ticket_already_open/);
      assert.equal(count, 2);
      const uncertain = (await pool.query(`SELECT ticket_id FROM platform_ticket_channels WHERE guild_id=$1 AND status='uncertain'`, [guildA])).rows[0];
      await tickets.staffAction(authority, { action: 'ticket-reconcile', target: uncertain.ticket_id, confirmed: true });
      assert.equal(count, 2);
      await tickets.staffAction(authority, { action: 'ticket-close', target: uncertain.ticket_id, confirmed: true });
      duplicateCreate = true;
      await assert.rejects(tickets.open(args), /ticket_creation_requires_reconciliation/);
      assert.equal(count, 4);
      const duplicate = (await pool.query(`SELECT ticket_id FROM platform_ticket_channels WHERE guild_id=$1 AND status='uncertain'`, [guildA])).rows[0];
      await assert.rejects(tickets.staffAction(authority, { action: 'ticket-reconcile', target: duplicate.ticket_id,
        confirmed: true }), /ticket_requires_manual_discord_inspection/);
      await assert.rejects(tickets.open(args), /ticket_already_open/);
      assert.equal(count, 4); // Multiple live matches remain held; no automatic deletion/retry.
      tickets.stop();
    });
    await t.test('welcome deduplicates actual joins and six-step onboarding persists consent without retaining answers', async () => {
      const cid='81000000000000071',rid='81000000000000072',botId='90000000000000099';
      const perms=new PermissionsBitField([P.ViewChannel,P.ReadMessageHistory,P.SendMessages]);
      const member={id:userB,pending:false,user:{bot:false,username:'Synthetic member'},displayName:'Synthetic member',
        roles:{cache:new Map(),highest:{position:0}},permissions:perms};
      const bot={id:botId,roles:{highest:{position:5,comparePositionTo:other=>5-other.position}},
        permissions:new PermissionsBitField([...perms.toArray(),P.ManageRoles])};
      const role={id:rid,name:'Gamer',position:2,permissions:new PermissionsBitField(0n)};
      let sent=0,roleWrites=0,loseWelcome=false;
      const guild={id:guildA,ownerId:userA,name:'Isolated community',memberCount:10,
        roles:{cache:new Map([[rid,role]])},members:{me:bot,cache:new Map([[userB,member]]),
          fetch:async ({user})=>{
            const value=user===userB?member:{...member,id:user};
            guild.members.cache.set(user,value);return value;
          }},
        channels:{cache:new Map()}};
      const channel={id:cid,type:0,permissionsFor:()=>perms,permissionOverwrites:{cache:new Map()},
        send:async body=>{
          assert.equal(communicationGuard({method:'POST',fullRoute:`/channels/${cid}/messages`,
            body:{content:body.content,allowed_mentions:{parse:[],replied_user:false}}}),true);
          sent++;
          if(loseWelcome)throw Error('synthetic welcome acknowledgement lost');
          return{id:'83000000000000071'};
        }};
      guild.channels.cache.set(cid,channel);
      const access={freshGuild:async id=>{if(id!==guildA)throw Error('Unknown isolated guild');return guild;},memberRolesVerified:()=>true};
      const config={
        welcome:{enabled:true,revision:1,configuration:{channelId:cid,message:'Welcome {user}!',roleBehavior:'ONBOARDING'}},
        roles:{enabled:true,revision:1,configuration:{selfAssignableRoles:[rid],protectedRoles:[]}},
        onboarding:{enabled:true,revision:1,configuration:{entryChannelId:cid,steps:
          ['MESSAGE','RULES_ACCEPTANCE','ROLE_SELECT','QUESTION','BUTTON','FINALIZATION']
            .map(type=>({type,title:type,content:'Configured public instruction'}))}}
      };
      const moduleConfig=async (id,key)=>{assert.equal(id,guildA);return config[key];};
      const welcome=createWelcomeService({pool,discord:access,moduleConfig});
      const joining={...member,guild,joinedTimestamp:1000};
      await Promise.all([welcome.join(joining),welcome.join(joining)]);
      assert.equal(sent,1);
      loseWelcome=true;
      await assert.rejects(welcome.join({...joining,joinedTimestamp:1001}),/acknowledgement lost/);
      await welcome.join({...joining,joinedTimestamp:1001});
      assert.equal(sent,2);
      const sdk={rest:{}};
      sdk.rest.put=(route,{body})=>executeSelfRoleWrite(sdk,{method:'PUT',fullRoute:route,body},async()=>{
        roleWrites++;member.roles.cache.set(rid,role);return{};
      });
      const onboarding=createOnboardingService({client:sdk,pool,discord:access,moduleConfig});
      loseWelcome=false;
      const publishPermit=await authorizeTenant({userId:userA,guildId:guildA,capability:'onboarding',write:true,
        resolve:async()=>({installed:true,member:true,role:'OWNER'})});
      const entry=await onboarding.publish({permit:publishPermit});
      assert.equal(entry.ok,true);assert.equal(sent,3);
      function interaction(customId,type='button',extra={}){
        return{customId,guildId:guildA,channelId:cid,user:{id:userB},values:[rid],
          isButton:()=>type==='button',isStringSelectMenu:()=>type==='select',isModalSubmit:()=>type==='modal',
          fields:{getTextInputValue:()=> 'PRIVATE ANSWER SENTINEL'},
          deferReply:async function(){this.deferred=true;},
          reply:async function(body){this.replied=true;this.output=body;},
          editReply:async function(body){this.output=body;},
          showModal:async function(modal){this.modal=modal.toJSON();},...extra};
      }
      let current=interaction('smith:onboarding:start');
      assert.equal(await onboarding.handleInteraction(current),true);
      for(let index=0;index<6;index++){
        const button=current.output.components.at(-1).components[0];
        let next=interaction(button.custom_id);
        if(index===2)next=interaction(current.output.components[0].components[0].custom_id,'select');
        await onboarding.handleInteraction(next);
        if(index===3){
          assert.ok(next.modal);
          const submit=interaction(next.modal.custom_id,'modal');
          await onboarding.handleInteraction(submit);next=submit;
        }
        assert.ok(next.output,`Step ${index} produces a private output`);
        current=next;
      }
      assert.match(current.output.content,/complete/);
      assert.equal(roleWrites,1);
      const progress=(await pool.query(`SELECT data FROM platform_records WHERE guild_id=$1 AND
        collection='onboarding-progress' AND created_by=$2`,[guildA,userB])).rows[0].data;
      assert.equal(progress.step,6);assert.equal(progress.consentSteps.length,1);assert.ok(progress.completedAt);
      assert.deepEqual(progress.selectedRoles,[rid]);
      const stored=JSON.stringify((await pool.query(`SELECT data FROM platform_records WHERE guild_id=$1`,[guildA])).rows);
      assert.ok(!stored.includes('PRIVATE ANSWER SENTINEL'));
      const audit=JSON.stringify((await pool.query(`SELECT after_state FROM platform_audit WHERE guild_id=$1`,[guildA])).rows);
      assert.ok(!audit.includes('PRIVATE ANSWER SENTINEL'));
      const foreign=interaction('smith:onboarding:start','button',{guildId:guildB});
      await onboarding.handleInteraction(foreign);
      assert.equal((await pool.query(`SELECT count(*) FROM platform_records WHERE guild_id=$1 AND collection='onboarding-progress'`,[guildB])).rows[0].count,'0');
      config.onboarding.revision=2;
      const restart=interaction('smith:onboarding:start');await onboarding.handleInteraction(restart);
      assert.ok(restart.output.content.startsWith('1/6'));
      onboarding.stop();
    });
    await t.test('cosmetic daily claims serialize, purchase price/inventory are atomic and wallets remain guild-scoped', async()=>{
      const settings={enabled:true,revision:1,configuration:{currencyName:'Test credits',dailyAmount:25,
        cooldownHours:24,inventoryBehavior:'UNIQUE'}};
      const moduleConfig=async()=>settings;
      let entered,release,first=true;
      const inside=new Promise(resolve=>{entered=resolve;});
      const hold=new Promise(resolve=>{release=resolve;});
      const economy=createEconomyService({pool,moduleConfig,onWalletLocked:async()=>{
        if(first){first=false;entered();await hold;}
      }});
      const a=economy.change({guildId:guildA,userId:userB,interactionId:'84000000000000001',kind:'daily'});
      await inside;
      const b=economy.change({guildId:guildA,userId:userB,interactionId:'84000000000000002',kind:'daily'})
        .then(value=>({value}),error=>({error}));
      try{
        let blocked=false;const deadline=Date.now()+4000;
        while(Date.now()<deadline){
          const row=(await admin.query(`SELECT count(*) FROM pg_stat_activity WHERE application_name=$1
            AND wait_event_type='Lock'`,[schema])).rows[0];
          if(Number(row.count)>0){blocked=true;break;}
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.ok(blocked,'The second daily must actually wait on the first wallet transaction.');
      }finally{release();}
      assert.equal((await a).balance,25);assert.equal((await b).error.code,'daily_cooldown_active');
      const replay=await economy.change({guildId:guildA,userId:userB,interactionId:'84000000000000001',kind:'daily'});
      assert.equal(replay.replayed,true);assert.equal(replay.balance,25);
      const itemId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
      await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
        VALUES($1,'shop',$2,'Cosmetic badge',$3,$4)`,[guildA,itemId,{price:5,enabled:true},userA]);
      await assert.rejects(economy.change({guildId:guildA,userId:userB,interactionId:'84000000000000003',
        kind:'buy',itemId,expectedPrice:6}),/shop_price_changed/);
      const purchase=await economy.change({guildId:guildA,userId:userB,interactionId:'84000000000000004',
        kind:'buy',itemId,expectedPrice:5});
      assert.equal(purchase.balance,20);
      await assert.rejects(economy.change({guildId:guildA,userId:userB,interactionId:'84000000000000005',
        kind:'buy',itemId,expectedPrice:5}),/item_already_owned/);
      assert.equal((await economy.wallet(guildA,userB)).inventory.length,1);
      assert.equal((await economy.wallet(guildB,userB)).balance,0);
      assert.equal((await economy.wallet(guildB,userB)).inventory.length,0);
      assert.equal((await economy.wallet(guildA,userA)).balance,0);
      settings.enabled=false;
      await assert.rejects(economy.wallet(guildA,userB),/economy_disabled/);
    });
    await t.test('reviewed seed imports only LMOC configuration, refuses drift, and activation excludes Hallowed Core', async () => {
      const bundle=await loadReviewedConfiguration();
      const env={PLATFORM_ENABLED_GUILD_IDS:LMOC_TEST_ID,PLATFORM_LMOC_CONFIG_SHA256:configurationDigest(bundle)};
      const client={isReady:()=>true,user:{id:userA},guilds:{cache:new Map([[LMOC_TEST_ID,{id:LMOC_TEST_ID}]])}};
      await pool.query(`INSERT INTO platform_guilds(guild_id,policy_key,settings,setup_complete)
        VALUES($1,'hallowed-core','{"sentinel":"unchanged"}',true)`,[TARGET_GUILD_ID]);
      const coreBefore=JSON.stringify((await pool.query('SELECT * FROM platform_guilds WHERE guild_id=$1',[TARGET_GUILD_ID])).rows);
      assert.equal((await seedReviewedConfiguration({pool,client,env,bundle})).imported,true);
      assert.equal((await pool.query('SELECT 1 FROM platform_modules WHERE guild_id=$1',[LMOC_TEST_ID])).rowCount,15);
      assert.equal((await seedReviewedConfiguration({pool,client,env,bundle})).alreadyImported,true);
      assert.equal((await pool.query('SELECT 1 FROM platform_modules WHERE guild_id=$1',[TARGET_GUILD_ID])).rowCount,0);
      assert.equal(JSON.stringify((await pool.query('SELECT * FROM platform_guilds WHERE guild_id=$1',[TARGET_GUILD_ID])).rows),coreBefore);
      const changed=structuredClone(bundle);
      changed.modules.find(m=>m.moduleKey==='ai').configuration.personalityAdditions='Different reviewed snapshot';
      await assert.rejects(seedReviewedConfiguration({pool,client,
        env:{...env,PLATFORM_LMOC_CONFIG_SHA256:configurationDigest(changed)},bundle:changed}),
      /existing_production_configuration_requires_review/);
      const activation=createActivation({pool,client,env});
      assert.equal(await activation.active(LMOC_TEST_ID),false);
      assert.equal(await activation.refresh(TARGET_GUILD_ID),false);
      assert.equal(await activation.refresh(LMOC_TEST_ID),true);
      const first=await activation.status(LMOC_TEST_ID);
      assert.equal(first.runtimeActive,true);
      assert.deepEqual(Object.keys(first.moduleStates).sort(),[...STANDARD_MODULES].sort());
      assert.ok(first.activatedAt);
      assert.equal(await activation.acceptsEvent(LMOC_TEST_ID,new Date(first.activatedAt).getTime()-1000),false);
      assert.equal(await activation.acceptsEvent(LMOC_TEST_ID,Date.now()),true);
      assert.equal(await activation.acceptsEvent(TARGET_GUILD_ID,Date.now()),false);
      assert.equal((await pool.query('SELECT 1 FROM platform_activity WHERE guild_id=$1',[LMOC_TEST_ID])).rowCount,0);
      await activation.refresh(LMOC_TEST_ID);
      assert.equal((await activation.status(LMOC_TEST_ID)).activatedAt,first.activatedAt);
      await activation.stop();
      assert.equal(await activation.active(LMOC_TEST_ID),false);
      assert.equal(JSON.stringify((await pool.query('SELECT * FROM platform_guilds WHERE guild_id=$1',[TARGET_GUILD_ID])).rows),coreBefore);
    });
    await t.test('explicit Owner recovery claims only a proven pre-dispatch denial and only once', async () => {
      const authority={guild:{id:LMOC_TEST_ID},role:'OWNER',actor:{id:userA}};
      await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by,created_at)
        VALUES($1,'acceptance-resource','resource-panel','Disposable panel','{"status":"creating"}',$2,now()-interval '1 minute')`,
      [LMOC_TEST_ID,userA]);
      assert.equal((await claimPreDispatchRetry(pool,authority,'panel')).rowCount,0);
      const denial={status:'denied',operation:'acceptance.resource.create',source:'owner-confirmed-lmoc-test',
        resourceKind:'panel',reason:'acceptance_resource_scope_expired'};
      await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state,created_at)
        VALUES($1,$2,'security.denied','settings',$3,now()-interval '5 seconds')`,[LMOC_TEST_ID,userA,denial]);
      assert.equal((await claimPreDispatchRetry(pool,{...authority,actor:{id:userB}},'panel')).rowCount,0);
      await assert.rejects(claimPreDispatchRetry(pool,{...authority,guild:{id:TARGET_GUILD_ID}},'panel'),/lmoc_owner_only/);
      const claims=await Promise.all([claimPreDispatchRetry(pool,authority,'panel'),claimPreDispatchRetry(pool,authority,'panel')]);
      assert.equal(claims.reduce((total,result)=>total+result.rowCount,0),1);
      assert.equal((await claimPreDispatchRetry(pool,authority,'panel')).rowCount,0);
      await pool.query(`UPDATE platform_records SET data='{"status":"creating"}' WHERE guild_id=$1
        AND collection='acceptance-resource' AND record_id='resource-panel'`,[LMOC_TEST_ID]);
      await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,'security.intent','settings',$3)`,[LMOC_TEST_ID,userA,{operation:'acceptance.resource.create',resourceKind:'panel'}]);
      assert.equal((await claimPreDispatchRetry(pool,authority,'panel')).rowCount,0);
    });
    await t.test('onboarding recovery requires fresh Owner identity and unambiguous pre-dispatch proof', async () => {
      const scope={guildId:LMOC_TEST_ID,userId:userA,role:'OWNER'};
      await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by,created_at)
        VALUES($1,'onboarding-entry','entry:3','Onboarding entry','{"status":"creating"}',$2,now()-interval '1 minute')`,
      [LMOC_TEST_ID,userA]);
      assert.equal((await claimOnboardingPreDispatchRetry(pool,scope,'entry:3')).rowCount,0);
      const denial={status:'denied',operation:'onboarding.publish',source:'platform-onboarding',
        reason:'onboarding_entry_not_authorized'};
      await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state,created_at)
        VALUES($1,$2,'security.denied','onboarding',$3,now()-interval '5 seconds')`,[LMOC_TEST_ID,userA,denial]);
      assert.equal((await claimOnboardingPreDispatchRetry(pool,{...scope,userId:userB},'entry:3')).rowCount,0);
      await assert.rejects(claimOnboardingPreDispatchRetry(pool,{...scope,guildId:TARGET_GUILD_ID},'entry:3'),/owner_retry_required/);
      await assert.rejects(claimOnboardingPreDispatchRetry(pool,{...scope,role:'ADMIN'},'entry:3'),/owner_retry_required/);
      // Old audits have no entryId. Two possible publications are ambiguous.
      await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
        VALUES($1,'onboarding-entry','entry:4','Other revision','{"status":"creating"}',$2)`,[LMOC_TEST_ID,userA]);
      assert.equal((await claimOnboardingPreDispatchRetry(pool,scope,'entry:3')).rowCount,0);
      await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state,created_at)
        VALUES($1,$2,'security.denied','onboarding',$3,now()-interval '2 seconds')`,
      [LMOC_TEST_ID,userA,{...denial,entryId:'entry:99'}]);
      assert.equal((await claimOnboardingPreDispatchRetry(pool,scope,'entry:3')).rowCount,0);
      await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state,created_at)
        VALUES($1,$2,'security.denied','onboarding',$3,now()-interval '1 second')`,
      [LMOC_TEST_ID,userA,{...denial,entryId:'entry:3'}]);
      const claims=await Promise.all([claimOnboardingPreDispatchRetry(pool,scope,'entry:3'),
        claimOnboardingPreDispatchRetry(pool,scope,'entry:3')]);
      assert.equal(claims.reduce((total,result)=>total+result.rowCount,0),1);
      assert.equal((await claimOnboardingPreDispatchRetry(pool,scope,'entry:3')).rowCount,0);
      await pool.query(`UPDATE platform_records SET data='{"status":"creating"}' WHERE guild_id=$1
        AND collection='onboarding-entry' AND record_id='entry:3'`,[LMOC_TEST_ID]);
      const cid='81000000000000091',botId='90000000000000099';
      const readable=new PermissionsBitField([P.ViewChannel,P.ReadMessageHistory]);
      const writable=new PermissionsBitField([...readable.toArray(),P.SendMessages]);
      const actor={id:userA,pending:false,user:{bot:false},permissions:writable};
      const bot={id:botId,permissions:readable};
      let botCanSend=false,sends=0;
      const channel={id:cid,type:0,permissionsFor:member=>member.id===botId&&!botCanSend?readable:writable,
        send:async body=>{
          assert.equal(communicationGuard({method:'POST',fullRoute:`/channels/${cid}/messages`,
            body:{content:body.content,allowed_mentions:{parse:[],replied_user:false}}}),true);
          sends++;return{id:'83000000000000091'};
        }};
      const guild={id:LMOC_TEST_ID,ownerId:userA,members:{me:bot,cache:new Map([[userA,actor]]),fetch:async()=>actor},
        channels:{cache:new Map([[cid,channel]])}};
      const service=createOnboardingService({client:{},pool,
        discord:{freshGuild:async()=>guild,memberRolesVerified:()=>true},
        moduleConfig:async()=>({enabled:true,revision:3,configuration:{entryChannelId:cid,
          steps:[{type:'BUTTON',title:'Test',content:'Synthetic isolated publication'}]}})});
      const permit=await authorizeTenant({userId:userA,guildId:LMOC_TEST_ID,capability:'onboarding',write:true,
        resolve:async()=>({installed:true,member:true,role:'OWNER'})});
      await assert.rejects(service.publish({permit}),/uncertain_inspect/);
      await assert.rejects(service.publish({permit},{confirmedOwnerRetry:true}),/not_authorized/);
      assert.equal(sends,0);
      botCanSend=true;
      assert.equal((await service.publish({permit},{confirmedOwnerRetry:true})).ok,true);
      assert.equal(sends,1);
      assert.equal((await service.publish({permit},{confirmedOwnerRetry:true})).ok,true);
      assert.equal(sends,1);
      await pool.query(`UPDATE platform_records SET data='{"status":"creating"}' WHERE guild_id=$1
        AND collection='onboarding-entry' AND record_id='entry:3'`,[LMOC_TEST_ID]);
      await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,'security.intent','onboarding',$3)`,[LMOC_TEST_ID,userA,{operation:'onboarding.publish'}]);
      assert.equal((await claimOnboardingPreDispatchRetry(pool,scope,'entry:3')).rowCount,0);
    });
    await t.test('OAuth ciphertext and schema remain isolated, logout invalidates the session', async () => {
      const row = (await pool.query('SELECT token_ciphertext FROM platform_sessions')).rows[0];
      assert.ok(row.token_ciphertext && !row.token_ciphertext.includes('synthetic-integration-access'));
      await pool.query(`UPDATE platform_sessions SET expires_at=now()-interval '1 second'`);
      assert.equal((await (await fetch(`${origin}/api/platform/session`, { headers })).json()).authenticated, false);
      await pool.query(`UPDATE platform_sessions SET expires_at=now()+interval '1 hour'`);
      const logout = await fetch(`${origin}/api/platform/logout`, { method: 'POST', headers });
      assert.equal(logout.status, 200);
      assert.equal((await fetch(`${origin}/api/platform/guilds/${guildA}/modules`, { headers })).status, 401);
    });
  } finally {
    viewer = false;
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await pool?.end();
    // Identifier checked above; only this runner's unique schema is removed.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
