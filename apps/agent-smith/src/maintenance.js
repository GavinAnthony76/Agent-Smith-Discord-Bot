import { createMemberMaintenance } from './maintenance-members.js';
import { createReports } from './maintenance-reports.js';
import { createMaintenanceUI } from './maintenance-ui.js';
import { isProtectedOwner } from './security-policy.js';
import { createEconomy } from './community-economy.js';
import { createContentAutomod } from './content-automod.js';
import { createTextParticipation } from './text-participation.js';
import { HistoricalReviewError } from './historical-review.js';
export function createMaintenance(ctx) {
 const {guild,client,pool,audit,cases}=ctx;
 const members=createMemberMaintenance(ctx),reports=createReports(ctx);
 const ui=createMaintenanceUI({...ctx,members,reports});
 const economy=createEconomy(ctx),automod=createContentAutomod(ctx);
 const participation=createTextParticipation(ctx);
 let running=false,stopped=false,lastPass=null,failures=0;
 const queue=new Set();
 const safeLog=e=>console.error('Smith maintenance deferred:',e?.code??e?.name??'error');
 async function mirror(action,detail) {
  await audit(pool,client.user.id,action,detail);
 }
 async function drain() {
  if(running||stopped)return;
  running=true;
  try {
   for(const uid of [...queue].slice(0,25)) {
    queue.delete(uid);
    try{await members.arrival(uid);await members.reconcile(uid);}
    catch(error){if(error.code!==10007){queue.add(uid);failures++;safeLog(error);}}
   }
   await reports.deliver();
   await pool.query(`UPDATE moderation_cases SET active=false,resolved_at=COALESCE(resolved_at,now())
    WHERE guild_id=$1 AND active AND expires_at<=now()`,[guild.id]);
   lastPass=new Date();
   await pool.query(`INSERT INTO worker_health(guild_id,worker,last_seen_at,detail) VALUES($1,'maintenance',now(),$2)
    ON CONFLICT(guild_id,worker) DO UPDATE SET last_seen_at=now(),detail=EXCLUDED.detail`,
   [guild.id,JSON.stringify({queued:queue.size,failures})]);
  } catch(error){failures++;safeLog(error);}
  finally{running=false;}
 }
 async function scan() {
  // Native reconciliation also requests a Gateway member chunk at startup.
  // Use the bounded REST roster API here rather than racing another opcode-8 request.
  const all=new Map();
  if(guild.members.list) {
   let after;
   for(;;){
    const page=await guild.members.list({limit:1000,...(after?{after}:{})});
    for(const [id,member] of page)all.set(id,member);
    if(page.size<1000)break;
    const next=[...page.keys()].at(-1);
    if(next===after)throw new Error('Roster pagination did not advance.');
    after=next;
   }
  }else for(const [id,member] of await guild.members.fetch())all.set(id,member);
  for(const member of all.values()) {
   if(member.user.bot||isProtectedOwner(guild,member.id))continue;
   await members.ensure(member);queue.add(member.id);
  }
  await drain();
 }
 async function join(member) {
  if(member.guild.id!==guild.id||member.user.bot||isProtectedOwner(guild,member.id))return;
  await members.ensure(member);
  try{await cases.restoreTimeout(member.id);}
  catch(error){await mirror('punishment-restore-blocked',{subject:member.id,errorCode:error.code??null});safeLog(error);}
  queue.add(member.id);await mirror('member-joined',{subject:member.id});
 }
 async function leave(member) {
  if(member.guild.id!==guild.id||member.user.bot)return;
  await members.leave(member.id);queue.delete(member.id);await mirror('member-left',{subject:member.id});
 }
 function event(action,detail) {void mirror(action,detail).catch(safeLog);}
 async function handle(i) {
  try {
  if(i.guildId!==guild.id||i.user?.bot)return false;
  if(i.isChatInputCommand?.()&&['balance','daily','shop','buy','inventory'].includes(i.commandName)) {
   await i.deferReply({flags:64});
   const result=i.commandName==='daily'?await economy.daily(i.user.id):i.commandName==='buy'?await economy.buy(i.user.id,i.options.getString('item',true),i.id)
    :await economy.read(i.user.id,i.commandName);
   await i.editReply({content:result.slice(0,1900),allowedMentions:{parse:[]}});
   return true;
  }
  // Keep the old /interest command functional while moving its preferences to PostgreSQL.
  if(i.isChatInputCommand?.()&&i.commandName==='interest') {
   await i.deferReply({flags:64});
   const name=i.options.getString('name',true);
   const {interests}=await import('./blueprint.js');
   const framework=Object.keys(interests).find(f=>interests[f].includes(name));
   const prefs=await members.preferences(i.user.id);
   await members.changeInterest(i.user.id,name,framework,!prefs.some(p=>p.name===name&&p.desired));
   await i.editReply({content:'Interest preference saved and reconciled.',allowedMentions:{parse:[]}});
   return true;
  }
  return await ui.handle(i);
  }catch(error){
   safeLog(error);
   const response={content:error instanceof HistoricalReviewError?error.message:
    'Unable to complete maintenance action. No security reset was performed; saved intents remain recoverable. Staff should check the audit and permissions.',allowedMentions:{parse:[]}};
   try{if(i.deferred||i.replied)await i.editReply(response);else await i.reply({...response,flags:64});}catch{safeLog({name:'InteractionReplyUnavailable'});}
   return true;
  }
 }
 const retry=setInterval(()=>void drain(),15000);
 const rescan=setInterval(()=>{void scan().catch(safeLog);},300000);
 return {handle,scan,join,leave,event,ensureMember:members.ensure,async handleMessage(message){await automod.handle(message);await participation.handle(message);},
  enqueue:uid=>queue.add(uid),status:()=>({lastPass,failures,queued:queue.size}),
  stop(){stopped=true;clearInterval(retry);clearInterval(rescan);}};
}
