import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPlatformCommands, executePlatformCommandWrite, communityCommand } from '../src/platform/commands.js';
import { TARGET_GUILD_ID } from '../src/config.js';
const guildId='80000000000000001',applicationId='70000000000000001';
test('standard manifest adds only missing static guild commands through audited one-request scopes',async()=>{
  const added=[],events=[];
  const client={rest:{get:async()=>[{name:'custom-existing'}]}};
  client.rest.post=(route,{body})=>executePlatformCommandWrite(client,{method:'POST',fullRoute:route,body},async()=>{
    added.push(body.name);return{id:'81000000000000001'};
  });
  const pool={query:async(sql,args)=>{
    if(sql.startsWith('SELECT installed'))return{rows:[{installed:true}]};
    events.push(args[2]);return{rows:[]};
  }};
  const discord={freshGuild:async()=>({id:guildId,members:{me:{}}}),memberRolesVerified:()=>true};
  await registerPlatformCommands({client,pool,discord,guildId,applicationId});
  assert.deepEqual(added,['smith','smith-community']);
  assert.deepEqual(events,['security.intent','security.result','security.intent','security.result']);
  assert.equal(executePlatformCommandWrite(client,{method:'DELETE'},()=>{}),null);
  client.rest.get=async()=>[{name:'smith'},{name:'smith-community'},{name:'custom-existing'}];
  await registerPlatformCommands({client,pool,discord,guildId,applicationId});
  assert.equal(added.length,2);
  await registerPlatformCommands({client,pool,discord,guildId:TARGET_GUILD_ID,applicationId});
  assert.equal(added.length,2);
  assert.equal(communityCommand.toJSON().options.find(c=>c.name==='buy').options.find(o=>o.name==='price').required,true);
});
test('registration scope rejects alterations and never sends when the audit is unavailable',async()=>{
  let calls=0;
  const client={rest:{get:async()=>[]}};
  client.rest.post=(route,{body})=>executePlatformCommandWrite(client,{method:'POST',fullRoute:route,
    body:{...body,name:'unsafe-command'}},async()=>calls++);
  const discord={freshGuild:async()=>({id:guildId,members:{me:{}}}),memberRolesVerified:()=>true};
  const pool={query:async()=>({rows:[{installed:true}]})};
  await assert.rejects(registerPlatformCommands({client,pool,discord,guildId,applicationId}),/not_authorized/);
  assert.equal(calls,0);
  client.rest.post=(route,{body})=>executePlatformCommandWrite(client,{method:'POST',fullRoute:route,body},async()=>calls++);
  pool.query=async sql=>{if(sql.startsWith('SELECT installed'))return{rows:[{installed:true}]};throw Error('audit unavailable');};
  await assert.rejects(registerPlatformCommands({client,pool,discord,guildId,applicationId}),/audit unavailable/);
  assert.equal(calls,0);
});
