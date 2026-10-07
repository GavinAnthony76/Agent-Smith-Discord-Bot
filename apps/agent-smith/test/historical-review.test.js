import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryHistory,ids } from './helpers/historical-fixture.js';
import { createMaintenanceUI } from '../src/maintenance-ui.js';
import { maintenanceCommands } from '../src/maintenance-commands.js';
const consent=async r=>{
 const p=await r.consentPreview(ids.member,'Gaming');
 await r.consent(ids.member,'Gaming',p.token);
};
const preview=r=>r.preview(ids.member,ids.owner,'Gaming','Faith');
const record=(r,p)=>r.record(ids.member,ids.owner,'Gaming','Faith',p.token);

test('historical roles and later selections never supply missing consent or primary intent',async()=>{
 const m=memoryHistory(),r=m.fixture.review;
 m.fixture.member.roles.cache.set('Selection: Gaming',{id:'Selection: Gaming'});
 await assert.rejects(preview(r),/framework-consent/);
 m.state.record={accepted_at:new Date(),primary_framework:null};
 await assert.rejects(preview(r),/framework-consent/);
 await consent(r);const p=await preview(r);
 assert.equal(m.state.record.primary_framework,null,'Self-confirmation is not primary adoption');
 await record(r,p);
 assert.equal(m.state.record.primary_framework,'Gaming');
 assert.equal(m.state.grants[0].reviewer,ids.owner);
 assert.equal(m.state.audit.at(-1).detail.rolesChanged,false);
 assert.deepEqual(m.fixture.mutations,[]);
});
test('missing acceptance uses actual current member consent time, never join or role time',async()=>{
 const m=memoryHistory(),r=m.fixture.review;
 m.state.record={primary_framework:'Gaming',accepted_at:null,joined_at:new Date('2020-01-01')};
 await assert.rejects(preview(r),/framework-consent/);
 await consent(r);
 const confirmed=m.state.audit[0].created_at;
 await record(r,await preview(r));
 assert.equal(m.state.record.accepted_at.getTime(),confirmed.getTime());
 assert.equal(m.state.record.rules_accepted_at.getTime(),confirmed.getTime());
 assert.equal(m.state.record.rules_version_accepted,'1');
 assert.ok(m.state.grants[0].created_at>=confirmed);
});
test('Admins, approvers, bots and all protected Owner subjects fail closed',async()=>{
 const m=memoryHistory(),r=m.fixture.review;await consent(r);
 for(const actor of [ids.member,ids.admin,ids.approver,ids.bot])
  await assert.rejects(r.preview(ids.member,actor,'Gaming','Faith'),/Owner/);
 for(const uid of [ids.owner,ids.secondary]) {
  await assert.rejects(r.consentPreview(uid,'Gaming'),/immune/);
  await assert.rejects(r.preview(uid,ids.owner,'Gaming'),/immune/);
  await assert.rejects(r.record(uid,ids.owner,'Gaming',null,'forged'),/immune/);
 }
 const p=await r.preview(ids.member,ids.secondary,'Gaming','Faith');
 await r.record(ids.member,ids.secondary,'Gaming','Faith',p.token);
 assert.equal(m.state.grants[0].reviewer,ids.secondary);
});
test('established primary, real acceptance and existing human extra approvals are immutable',async()=>{
 const m=memoryHistory(),r=m.fixture.review,old=new Date('2022-01-01');
 m.state.record={primary_framework:'Gaming',accepted_at:old,rules_version_accepted:'legacy-unversioned',access_authoritative:false};
 m.state.grants=[{framework:'Faith',reviewer:'earlier-human',created_at:old}];
 await assert.rejects(r.consentPreview(ids.member,'Tech'),/immutable/);
 await assert.rejects(r.preview(ids.member,ids.owner,'Tech'),/immutable/);
 const p=await preview(r);await record(r,p);await record(r,p);
 assert.equal(m.state.audit.length,0);
 assert.equal(m.state.grants[0].reviewer,'earlier-human');
 assert.equal(m.state.grants[0].created_at.getTime(),old.getTime());
 assert.equal(m.state.record.accepted_at.getTime(),old.getTime());
});
test('stale previews, changed rules, pending requests, unknown screening and left members cannot record',async()=>{
 const m=memoryHistory(),f=m.fixture,r=f.review;
 await consent(r);const p=await preview(r);
 f.member.roles.cache.delete(f.roles.Tech);
 await assert.rejects(record(r,p),/state changed/);
 f.member.roles.cache.set(f.roles.Tech,{id:f.roles.Tech});
 m.state.version='2';
 await assert.rejects(record(r,p),/framework-consent/);
 const cp=await r.consentPreview(ids.member,'Gaming');m.state.version='3';
 await assert.rejects(r.consent(ids.member,'Gaming',cp.token),/Rules changed/);
 await consent(r);
 m.state.requests=[{id:'1',framework:'Faith',status:'pending'}];
 await assert.rejects(preview(r),/pending access request/);
 m.state.requests=[];
 for(const pending of [true,undefined]) {
  f.member.pending=pending;await assert.rejects(preview(r),/Rules Screening/);
 }
 f.member.pending=false;f.all.delete(ids.member);
 await assert.rejects(preview(r),/left/);
 assert.equal(m.state.grants.length,0);assert.deepEqual(f.mutations,[]);
});
test('new approvals and primary rollback together when audit fails; unknown extras stay nonauthoritative',async()=>{
 const m=memoryHistory(),r=m.fixture.review;await consent(r);
 m.state.failAudit=true;
 await assert.rejects(record(r,await preview(r)),/Audit storage failed/);
 assert.equal(m.state.record,null);assert.equal(m.state.grants.length,0);
 m.state.failAudit=false;m.state.record={primary_framework:'Gaming',accepted_at:new Date(),access_authoritative:true};
 await record(r,await preview(r));
 assert.equal(m.state.record.access_authoritative,false,'Remaining Tech role must stay pending, not be removed by maintenance');
 assert.equal(m.state.audit.at(-1).detail.preservedPendingReview,true);
});
test('invalid framework, missing held roles, wrong guild and lost Owner authorization are refused',async()=>{
 const m=memoryHistory(),f=m.fixture,r=f.review;await consent(r);
 await assert.rejects(r.preview(ids.member,ids.owner,'invalid'),/Invalid framework/);
 await assert.rejects(r.preview(ids.member,ids.owner,'Gaming','Gaming'),/differ/);
 const p=await preview(r);
 f.member.roles.cache.delete(f.roles.Faith);
 await assert.rejects(record(r,p),/not held/);
 f.member.guild={id:'another-guild'};
 await assert.rejects(preview(r),/current human/);
 f.member.guild=f.guild;f.member.roles.cache.set(f.roles.Faith,{id:f.roles.Faith});
 const secondary=await r.preview(ids.member,ids.secondary,'Gaming','Faith');
 f.cfg.owners=[ids.owner];
 await assert.rejects(r.record(ids.member,ids.secondary,'Gaming','Faith',secondary.token),/Owner/);
 assert.equal(m.state.grants.length,0);
});
test('Discord interface binds self consent, checks bot messages and dispatches Owner confirmation',async()=>{
 const m=memoryHistory(),f=m.fixture;
 const ui=createMaintenanceUI({...f,client:{user:{id:ids.bot}},members:{historical:f.review}});
 const command=(name,actor,strings={},target=ids.member)=>({
  user:{id:actor},guildId:ids.guild,commandName:name,isChatInputCommand:()=>true,
  options:{getString:n=>strings[n]??null,getUser:()=>({id:target})},async deferReply(){},
  async editReply(value){this.response=value;}
 });
 const c=command('framework-consent',ids.member,{primary:'Gaming'});
 await ui.handle(c);assert.match(c.response.content,/accept these rules now/);
 const id=c.response.components[0].components[0].data.custom_id;assert.ok(id.length<=100);
 const click=(customId,actor=ids.member)=>({customId,user:{id:actor},guildId:ids.guild,
  isButton:()=>true,message:{author:{id:ids.bot}},async deferReply(){},async editReply(value){this.response=value;}});
 await assert.rejects(ui.handle(click(id,ids.admin)),/Only the member/);
 const forged=click(id);forged.message.author.id=ids.admin;
 await assert.rejects(ui.handle(forged),/Smith/);
 await ui.handle(click(id));
 const review=command('framework-review',ids.owner,{primary:'Gaming',extra:'Faith'});
 await ui.handle(review);
 const confirm=review.response.components[0].components[0].data.custom_id;assert.ok(confirm.length<=100);
 await assert.rejects(ui.handle(click(confirm,ids.admin)),/Owner/);
 await ui.handle(click(confirm,ids.owner));
 assert.equal(m.state.grants[0].framework,'Faith');
 assert.deepEqual(f.mutations,[]);
 for(const name of ['framework-consent','framework-review'])
  assert.ok(maintenanceCommands.some(c=>c.toJSON().name===name));
});
