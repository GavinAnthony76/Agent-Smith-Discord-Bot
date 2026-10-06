import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { installSecurityGate } from '../src/security-gate.js';
import { assertSafeBot, assertOwnerConfiguration, assertCommandTree, withRoleWorkflow,
  withModerationWorkflow, mutationScope, registerSecurityConfiguration, refreshOwnerProtection,
  securityLimits, assertSafeHierarchy } from '../src/security-policy.js';
import { reserveDestructiveOperation } from '../src/security-rate.js';
import { purgeCandidates } from '../src/moderation-policy.js';
import { createProgressionWorker } from '../src/progression-worker.js';
import { progressionConfig } from '../src/progression-config.js';
import { approvedManualChannels } from '../src/manual-channels.js';

const gid = '1556423230590423042', owner = '100000000000000001', botId = '100000000000000002';
const member = '100000000000000003', other = '100000000000000004', rid = '200000000000000001';
function fixture(roleId = rid, roleName = 'Gaming') {
  const sent = [];
  const role = { id: roleId, name: roleName, position: 1, managed: false, editable: true, permissions: new PermissionsBitField() };
  const highest = (position, id) => ({ id, position, comparePositionTo: other => position - other.position });
  const bot = { id: botId, user: { bot: true }, permissions: new PermissionsBitField([P.ManageRoles, P.BanMembers, P.ManageMessages]),
    roles: { highest: highest(10, botId), cache: new Map([[botId, {}]]) } };
  const cfg = { guildId: gid, clientId: botId, ownerDiscordId: owner, owners: [owner] };
  const rows = [{ kind: 'role', name: role.name, discord_id: roleId }];
  const guild = { id: gid, ownerId: owner, fetch: async () => guild,
    roles: { cache: new Map([[roleId, role]]), fetch: async () => {} }, members: { fetchMe: async () => bot,
      fetch: async ({user}) => ({ id:user, user:{bot:false}, permissions: new PermissionsBitField(user===owner?[P.Administrator]:[]),
        roles:{highest:highest(user===owner?20:1,user)} }) } };
  const client = { rest: { request: async request => { sent.push(request); return {}; } } };
  registerSecurityConfiguration(guild, cfg);
  installSecurityGate({ client, guild, cfg, readResources: async () => rows, writeAudit: async () => {} });
  const request = (method, path, body) => client.rest.request({ method, fullRoute: path, body });
  const changeRole = (uid = member) => request('PUT', `/guilds/${gid}/members/${uid}/roles/${roleId}`);
  return { sent, role, bot, cfg, guild, rows, request, changeRole };
}
test('native onboarding Member assignment crosses the gate with approved manual access only', async () => {
  const policy = approvedManualChannels[0];
  const f = fixture(policy.roleId, policy.roleName);
  const overwrite = {type:0,allow:new PermissionsBitField(policy.allow),deny:new PermissionsBitField()};
  const channel = {id:policy.channelId,name:policy.label,type:policy.type,
    permissionOverwrites:{cache:new Map([[policy.roleId,overwrite]])}};
  f.guild.channels = {cache:new Map([[channel.id,channel]]),fetch:async()=>{}};
  await withRoleWorkflow('native-reconciliation',member,f.changeRole);
  assert.equal(f.sent.length,1);
  overwrite.allow.add(P.ManageChannels);
  await assert.rejects(withRoleWorkflow('native-reconciliation',member,f.changeRole),/unexpected channel/);
  assert.equal(f.sent.length,1);
  overwrite.allow = new PermissionsBitField(policy.allow);
  f.guild.channels.cache.set('control',{id:'control',name:'smith-controls',
    permissionOverwrites:{cache:new Map([[policy.roleId,overwrite]])}});
  await assert.rejects(withRoleWorkflow('native-reconciliation',member,f.changeRole),/unexpected channel/);
  assert.equal(f.sent.length,1);
});
test('owner identity is required and must match the actual guild owner', async () => {
  const f = fixture();
  assert.throws(() => assertOwnerConfiguration({ owners: [owner] }, owner), /OWNER_DISCORD_ID/);
  f.cfg.ownerDiscordId = other;
  await assert.rejects(withRoleWorkflow('member-command', member, f.changeRole), /OWNER_DISCORD_ID/);
  assert.equal(f.sent.length, 0);
});
test('a changed owner blocks management before any database or REST mutation', async () => {
  const f = fixture(); f.guild.ownerId = other;
  await assert.rejects(refreshOwnerProtection(f.guild), /OWNER_DISCORD_ID/);
  await assert.rejects(withRoleWorkflow('native-reconciliation', member, f.changeRole), /OWNER_DISCORD_ID/);
  assert.equal(f.sent.length, 0);
});
test('only trusted static workflows may grant a tracked permission-free below-bot role', async () => {
  const f = fixture();
  await assert.rejects(f.changeRole(), /approved static workflow/);
  assert.throws(() => withRoleWorkflow('ai', member, f.changeRole), /Untrusted/);
  await withRoleWorkflow('member-command', member, f.changeRole);
  assert.equal(f.sent.length, 1);
  assert.equal(mutationScope(), undefined);
});
for (const [name, mutate] of [
  ['equal role position', f => { f.role.position = 10; }],
  ['above-bot position', f => { f.role.position = 11; }],
  ['Administrator role', f => { f.role.permissions = new PermissionsBitField([P.Administrator]); }],
  ['managed role', f => { f.role.managed = true; }],
  ['untracked role', f => { f.rows.length = 0; }],
  ['renamed security role', f => { f.role.name = 'Server Owner'; }],
  ['bot role', f => { f.bot.roles.cache.set(rid, {}); }]
]) test(`assignment and removal refuse ${name}`, async () => {
  const f = fixture(); mutate(f);
  for (const method of ['PUT','DELETE']) await assert.rejects(withRoleWorkflow('native-reconciliation', member,
    () => f.request(method, `/guilds/${gid}/members/${member}/roles/${rid}`)), /permission-free role below Smith/);
  assert.equal(f.sent.length, 0);
});
test('all role workflows reject the Owner and bot as subjects', async () => {
  const f = fixture();
  for (const source of ['member-command','native-reconciliation','progression-reconciliation','approval-recovery']) {
    for (const uid of [owner, botId]) await assert.rejects(withRoleWorkflow(source, uid, () => f.changeRole(uid)));
  }
  assert.equal(f.sent.length, 0);
});
for (const [method, path, body] of [
  ['DELETE', `/guilds/${gid}`], ['PATCH', `/guilds/${gid}`, { owner_id: botId }],
  ['POST', `/guilds/${gid}/bulk-ban`, { user_ids: [member,other] }],
  ['POST', `/guilds/${gid}/roles`, { permissions: '8' }],
  ['PATCH', `/guilds/${gid}/roles/${rid}`, { permissions: '8' }],
  ['PATCH', `/guilds/${gid}/roles`, [{ id: botId, position: 100 }]],
  ['DELETE', `/guilds/${gid}/roles/${rid}`],
  ['POST', `/guilds/${gid}/channels`, { name: 'unsafe' }],
  ['DELETE', `/channels/${rid}`], ['PATCH', `/channels/${rid}`, { permission_overwrites: [] }],
  ['PUT', `/channels/${rid}/permissions/${owner}`, { deny: '1024' }],
  ['PATCH', `/guilds/${gid}/members/${member}`, { roles: [rid] }],
  ['PATCH', `/guilds/${gid}/onboarding`, { enabled: false }]
]) test(`unsafe management API ${method} ${path.split('/').slice(-1)} is disabled`, async () => {
  const f = fixture(); await assert.rejects(f.request(method, path, body)); assert.equal(f.sent.length, 0);
});
test('direct natural-language timeout/kick/ban requests have no privilege', async () => {
  const f = fixture();
  for (const [method,path,body] of [
    ['PATCH',`/guilds/${gid}/members/${member}`,{ communication_disabled_until: new Date().toISOString() }],
    ['DELETE',`/guilds/${gid}/members/${member}`], ['PUT',`/guilds/${gid}/bans/${member}`]
  ]) await assert.rejects(f.request(method,path,body), /authenticated/);
  assert.equal(f.sent.length, 0);
});
test('moderation requires confirmation for destructive actions and binds the exact subject', async () => {
  const f = fixture(), action = { operation: 'ban', target: member };
  assert.throws(() => withModerationWorkflow(action, owner, () => {}), /confirmation/);
  await withModerationWorkflow(action, owner, async () => {
    await assert.rejects(f.request('PUT', `/guilds/${gid}/bans/${other}`), /authenticated/);
    await f.request('PUT', `/guilds/${gid}/bans/${member}`);
  }, true);
  assert.equal(f.sent.length, 1);
});
test('owner cannot be warned, timed out, kicked, banned or unbanned through a trusted context', async () => {
  const f = fixture();
  for (const [operation,method,path,body] of [
    ['warn','POST','/users/@me/channels',{ recipient_id: owner }],
    ['timeout','PATCH',`/guilds/${gid}/members/${owner}`,{ communication_disabled_until: new Date().toISOString() }],
    ['kick','DELETE',`/guilds/${gid}/members/${owner}`],
    ['ban','PUT',`/guilds/${gid}/bans/${owner}`], ['unban','DELETE',`/guilds/${gid}/bans/${owner}`]
  ]) await assert.rejects(withModerationWorkflow({ operation,target: owner }, owner,
    () => f.request(method,path,body), true), /immune/);
  assert.equal(f.sent.length, 0);
});
test('cached Owner DM cannot bypass warning recipient immunity', async () => {
  const f=fixture(), cid='400000000000000001';
  // Reinstall against the same guarded transport; metadata reads are stubbed.
  f.guild.channels={fetch:async()=>({recipientId:owner})};
  const guardedClient={rest:{request:f.request},channels:{fetch:f.guild.channels.fetch}};
  // A standalone transport ensures this probe cannot reach Discord.
  const sent=[];
  guardedClient.rest.request=async request=>{sent.push(request);return{};};
  installSecurityGate({client:guardedClient,guild:f.guild,cfg:f.cfg,readResources:async()=>f.rows});
  await assert.rejects(withModerationWorkflow({operation:'warn',target:member},owner,()=>
    guardedClient.rest.request({method:'POST',fullRoute:`/channels/${cid}/messages`,body:{content:'warning'}})),/exact authenticated warning recipient/);
  assert.equal(sent.length,0);
});
test('Administrator and equivalent broad powers fail closed', () => {
  for (const p of [P.Administrator,P.ManageGuild,P.ManageWebhooks]) assert.throws(() =>
    assertSafeBot({ permissions: new PermissionsBitField([p]) }), /UNSAFE/);
});
test('Smith must remain below the Owner security role', () => {
  const f=fixture();
  assert.throws(()=>assertSafeHierarchy(f.bot,{ roles:{ highest:{ position:10 } } }),/UNSAFE/);
  assert.throws(()=>assertSafeHierarchy(f.bot,{ roles:{ highest:{ position:9 } } }),/UNSAFE/);
  assertSafeHierarchy(f.bot,{ roles:{ highest:{ position:20 } } });
});
test('concurrent static workflows do not share or leak subject authority', async () => {
  const f=fixture();
  await Promise.all([
    withRoleWorkflow('native-reconciliation',member,async()=>{
      await Promise.resolve();
      await assert.rejects(f.changeRole(other),/approved static workflow/);
    }),
    withRoleWorkflow('progression-reconciliation',other,async()=>{
      await Promise.resolve(); await f.changeRole(other);
    })
  ]);
  assert.equal(f.sent.length,1); assert.equal(mutationScope(),undefined);
});
test('nuke and reset commands are rejected even in subcommand trees', () => {
  for (const name of ['nuke-server','mass-ban','delete-all-roles','delete-all-channels','reset-server']) {
    assert.throws(() => assertCommandTree([{ name:'management', options:[{ name }] }]), /Unsafe/);
  }
});
test('purge has a bounded configurable ceiling and preserves protected owner messages', () => {
  assert.equal(securityLimits({}).purge,50);
  for (const value of ['0','101','NaN','1.5']) assert.throws(() => securityLimits({ SMITH_MAX_PURGE:value }));
  const now=Date.now(), messages = new Map([['1',{ id:'1',author:{id:owner},createdTimestamp:now }],
    ['2',{ id:'2',author:{id:member},createdTimestamp:now }]]);
  assert.deepEqual(purgeCandidates(messages,now,[owner]).map(m=>m.id),['2']);
});
test('one-message SDK purge is permitted only for a confirmed, approved, non-Owner message', async () => {
  const f=fixture(), cid='400000000000000001', mid='300000000000000001';
  const row={ kind:'channel',name:'gaming-lounge',discord_id:cid }; f.rows.push(row);
  const message={ author:{id:member},pinned:false,createdTimestamp:Date.now() };
  f.guild.channels={fetch:async()=>({permissionsFor:()=>new PermissionsBitField([P.ManageMessages]),messages:{fetch:async()=>message}})};
  const action={ operation:'purge',channel:cid,messageIds:[mid] };
  await withModerationWorkflow(action,owner,()=>f.request('DELETE',`/channels/${cid}/messages/${mid}`),true);
  assert.equal(f.sent.length,1);
  message.author.id=owner;
  await assert.rejects(withModerationWorkflow(action,owner,()=>f.request('DELETE',`/channels/${cid}/messages/${mid}`),true),/immune/);
  message.author.id=member; row.name='gaming-news';
  await assert.rejects(withModerationWorkflow(action,owner,()=>f.request('DELETE',`/channels/${cid}/messages/${mid}`),true),/Protected channel/);
  assert.equal(f.sent.length,1);
});
test('Owner rank reconciliation stops before SQL, role safety reads or role mutations', async t => {
  const f=fixture(); let writes=0;
  const worker=await createProgressionWorker({ guild:f.guild,client:{user:{id:botId}},config:progressionConfig,
    resource:async(_,name)=>name, pool:{query:async()=>{writes++;return{rows:[]};}},
    locked:async()=>{writes++;throw new Error('Owner must not acquire mutation lock');} });
  t.after(()=>worker.stop());
  await worker.reconcile(owner,'Gaming');
  assert.equal(writes,0); assert.equal(f.sent.length,0);
});
test('destructive cooldown reserves durably, blocks retries, and releases the connection', async () => {
  let reserved=false, released=0; const sqls=[];
  const pool={ connect:async()=>({ release(){ released++; }, query:async(sql,args)=>{
    sqls.push(sql);
    if(sql.startsWith('SELECT id FROM audit')) return { rows: reserved?[{id:1}]:[] };
    if(sql.startsWith('INSERT INTO audit')) { assert.equal(args[2],'mod.rate-reserved'); reserved=true; }
    return { rows:[] };
  } }) };
  const action={ operation:'ban',target:member };
  await reserveDestructiveOperation(pool,gid,owner,action);
  await assert.rejects(reserveDestructiveOperation(pool,gid,owner,action),/one per server per minute/);
  assert.equal(released,2);
  assert(sqls.some(sql=>sql.includes('pg_advisory_xact_lock')));
  assert(sqls.includes('COMMIT')); assert(sqls.includes('ROLLBACK'));
});
