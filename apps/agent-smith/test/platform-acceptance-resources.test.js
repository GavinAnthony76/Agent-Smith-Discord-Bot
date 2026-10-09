import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createAcceptanceResources, executeAcceptanceResourceWrite } from '../src/platform/acceptance-resources.js';
import { LMOC_TEST_ID } from '../src/platform/activation.js';
import { TARGET_GUILD_ID } from '../src/config.js';

function fixture(unknown = false, onAuthority = () => {}) {
  const rows=new Map(),writes=[];
  const bot={id:'90000000000000001',permissions:new PermissionsBitField(P.ManageRoles|P.ManageChannels),
    roles:{highest:{position:10}}};
  const guild={id:LMOC_TEST_ID,ownerId:'90000000000000002',members:{me:bot},
    roles:{cache:new Map()},channels:{cache:new Map()}};
  const authority={guild,role:'OWNER',actor:{id:guild.ownerId}};
  const pool={query:async(sql,params)=>{
    if(sql.startsWith('WITH claimed AS'))return{rows:[],rowCount:0};
    if(sql.startsWith('SELECT data')) return{rows:rows.has(params[1])?[{data:rows.get(params[1])}]:[],rowCount:0};
    if(sql.startsWith('INSERT INTO platform_records')){
      if(rows.has(params[1]))return{rows:[],rowCount:0};
      rows.set(params[1],{status:'creating'});return{rows:[{}],rowCount:1};
    }
    if(sql.startsWith('UPDATE platform_records'))rows.set(params[1],params[2]);
    return{rows:[],rowCount:1};
  }};
  const client={isReady:()=>true,rest:{}};
  client.rest.post=async(route,{body})=>executeAcceptanceResourceWrite(client,
    {method:'POST',fullRoute:route,body},async()=>{
      writes.push({route,body});
      if(unknown)throw Error('lost acknowledgement');
      const value={...body,id:String(91000000000000001n+BigInt(writes.length))};
      if(route.endsWith('/roles'))guild.roles.cache.set(value.id,{...value,managed:false,position:1,
        permissions:new PermissionsBitField(0n)});
      else guild.channels.cache.set(value.id,{...value,permissionOverwrites:{cache:new Map(
        body.permission_overwrites.map(o=>[o.id,{allow:new PermissionsBitField(BigInt(o.allow)),
          deny:new PermissionsBitField(BigInt(o.deny))}]))}});
      return value;
    });
  const service=createAcceptanceResources({client,pool,
    discord:{authority:async()=>{onAuthority();return authority;},memberRolesVerified:()=>true},
    env:{PLATFORM_ENABLED_GUILD_IDS:LMOC_TEST_ID},requireActive:async()=>{}});
  return{service,authority,writes,rows,guild};
}

test('Owner-confirmed readiness makes three bounded LMOC resources; repeat reuses verified resources', async()=>{
  const f=fixture();
  const ids=await f.service.prepare(f.authority);
  assert.equal(f.writes.length,3);
  assert.equal(f.writes[0].body.permissions,'0');
  assert.equal(f.writes[1].body.type,4);
  assert.equal(f.writes[1].body.permission_overwrites[0].deny,String(P.ViewChannel));
  assert.equal(f.writes[2].body.type,0);
  assert.ok(f.writes.every(w=>w.route.startsWith(`/guilds/${LMOC_TEST_ID}/`)));
  assert.deepEqual(await f.service.prepare(f.authority),ids);
  assert.equal(f.writes.length,3);
  f.guild.roles.cache.get(ids.roleId).permissions=new PermissionsBitField(P.Administrator);
  await assert.rejects(f.service.prepare(f.authority),/drift_requires_review/);
  assert.equal(f.writes.length,3);
});

test('uncertain resource creation remains held, never auto-replayed or deleted', async()=>{
  const f=fixture(true);
  await assert.rejects(f.service.prepare(f.authority),/lost acknowledgement/);
  assert.equal(f.rows.get('resource-role').status,'creating');
  await assert.rejects(f.service.prepare(f.authority),/uncertain_inspect_before_retry/);
  assert.equal(f.writes.length,1);
});

test('slow fresh-authority reads do not expire the later bounded dispatch window', async t=>{
  let now=Date.now();
  t.mock.method(Date,'now',()=>now);
  const f=fixture(false,()=>{now+=40000;});
  await f.service.prepare(f.authority);
  assert.equal(f.writes.length,3);
});

test('reads exceeding the validation budget deny before any Discord write', async t=>{
  let now=Date.now(),calls=0;
  t.mock.method(Date,'now',()=>now);
  const f=fixture(false,()=>{if(++calls===2)now+=121000;});
  await assert.rejects(f.service.prepare(f.authority),/scope_expired/);
  assert.equal(f.writes.length,0);
  assert.equal(f.rows.get('resource-role').status,'creating');
});

test('Hallowed Core and non-Owner resource requests are refused before writes', async()=>{
  const f=fixture();
  await assert.rejects(f.service.prepare({...f.authority,guild:{id:TARGET_GUILD_ID}}),/lmoc_owner_only/);
  await assert.rejects(f.service.prepare({...f.authority,role:'ADMIN'}),/lmoc_owner_only/);
  assert.equal(f.writes.length,0);
});
