import { drizzle } from 'drizzle-orm/node-postgres';
import { and,eq } from 'drizzle-orm';
import { memberInterests } from './maintenance-model.js';
import { frameworks,interests } from './blueprint.js';
import { memberLifecycle,authorizedFrameworks,validateInterest } from './lifecycle-policy.js';
import { assertAssignableRole } from './policy.js';
import { assertNotOwner,isProtectedOwner,refreshOwnerProtection,withRoleWorkflow } from './security-policy.js';

export function createMemberMaintenance({guild,client,cfg,pool,locked,resource,audit,native}) {
 const orm=drizzle(pool);
 const filter=uid=>and(eq(memberInterests.guildId,guild.id),eq(memberInterests.userId,uid));
 const preferences=uid=>orm.select().from(memberInterests).where(filter(uid));
 async function ensure(member) {
  if(member.guild.id!==guild.id||member.user.bot||isProtectedOwner(guild,member.id))return;
  const result=await pool.query(`INSERT INTO members(guild_id,user_id,joined_at,onboarding_flow) VALUES($1,$2,$3,
   CASE WHEN (SELECT value FROM bot_settings WHERE guild_id=$1 AND key='staged-onboarding')='true'::jsonb THEN 'staged' ELSE 'native' END)
   ON CONFLICT(guild_id,user_id) DO UPDATE SET joined_at=COALESCE(EXCLUDED.joined_at,members.joined_at),left_at=NULL`,
   [guild.id,member.id,member.joinedAt??null]);
  return result;
 }
 async function context(uid,db=pool) {
  const member=await guild.members.fetch({user:uid,force:true});
  const record=(await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2',[guild.id,uid])).rows[0];
  const grants=(await db.query('SELECT framework FROM grants WHERE guild_id=$1 AND user_id=$2',[guild.id,uid])).rows.map(r=>r.framework);
  const ids=Object.fromEntries(await Promise.all(['Member',...frameworks].map(async n=>[n,await resource('role',n,db)])));
  return {member,record,grants,ids,allowed:authorizedFrameworks(record,grants)};
 }
 async function changeInterest(uid,name,framework,desired) {
  await refreshOwnerProtection(guild);assertNotOwner(guild,uid,cfg);
  await locked(`${guild.id}:${uid}`,async db=>{
   const state=await context(uid,db);
   if(state.member.pending!==false)throw new Error('Complete Discord Rules Screening first.');
   const roleName=validateInterest(name,framework,state.allowed);
   const roleId=await resource('role',roleName,db);
   assertAssignableRole(await guild.roles.fetch(roleId));
   await drizzle(db).insert(memberInterests).values({guildId:guild.id,userId:uid,roleId,framework,name,desired})
    .onConflictDoUpdate({target:[memberInterests.guildId,memberInterests.userId,memberInterests.roleId],
     set:{desired,status:'pending',updatedAt:new Date()}});
   await audit(db,uid,'interest-intent',{name,framework,desired});
  }); // Committed durable intent before Discord. Failures remain recoverable.
  await reconcile(uid);
 }
 async function reconcile(uid) {
  await refreshOwnerProtection(guild);
  if(isProtectedOwner(guild,uid))return {state:'owner-immune'};
  return locked(`${guild.id}:${uid}`,db=>withRoleWorkflow('native-reconciliation',uid,async()=>{
   const state=await context(uid,db);
   if(state.member.user.bot)return {state:'bot-exempt'};
   let held=frameworks.filter(f=>state.member.roles.cache.has(state.ids[f]));
   const extras=held.filter(f=>!state.allowed.includes(f));
   if(state.record?.access_authoritative&&state.allowed.length&&extras.length) {
    const unresolved=await db.query(`SELECT 1 FROM requests WHERE guild_id=$1 AND user_id=$2 AND status='pending'
     UNION ALL SELECT 1 FROM audit WHERE guild_id=$1 AND (detail->>'subject'=$2 OR detail->>'target'=$2)
     AND (action ILIKE '%uncertain%' OR action ILIKE '%unresolved%' OR action ILIKE '%recovery%') LIMIT 1`,[guild.id,uid]);
    if(!unresolved.rowCount) {
     for(const f of extras) {
      await state.member.roles.remove(assertAssignableRole(await guild.roles.fetch(state.ids[f])),'Remove extra framework without durable approval');
      await audit(db,client.user.id,'unauthorized-framework-removed',{subject:uid,framework:f});
     }
     const fresh=await guild.members.fetch({user:uid,force:true});
     held=frameworks.filter(f=>fresh.roles.cache.has(state.ids[f]));
    }
   }
   // Never adopt/remove unrecorded historical roles; preserve Owner's case-by-case review boundary.
   const unrecorded=held.some(f=>!state.allowed.includes(f));
   const restricted=(await db.query(`SELECT 1 FROM moderation_cases WHERE guild_id=$1 AND user_id=$2
    AND active AND status='completed' AND action_type IN ('timeout','ban') AND (expires_at IS NULL OR expires_at>now()) LIMIT 1`,
   [guild.id,uid])).rowCount>0;
   const ready=state.record?.onboarding_flow!=='staged'||!!state.record.interests_completed_at;
   if(!unrecorded&&!restricted&&ready&&state.member.pending===false&&state.allowed.length) {
    for(const name of ['Member',...state.allowed]) {
     if(!state.member.roles.cache.has(state.ids[name])) {
      const role=assertAssignableRole(await guild.roles.fetch(state.ids[name]));
      await state.member.roles.add(role,'Restore durable approved access');
      await audit(db,client.user.id,'maintenance-role-restored',{subject:uid,name});
     }
    }
    if(state.record.onboarding_flow==='staged') {
     const arrival=(await db.query("SELECT discord_id FROM resources WHERE guild_id=$1 AND kind='role' AND name='NEW ARRIVAL'",[guild.id])).rows[0]?.discord_id;
     if(arrival&&state.member.roles.cache.has(arrival))await state.member.roles.remove(arrival,'Staged onboarding complete');
    }
    const prefs=await drizzle(db).select().from(memberInterests).where(filter(uid));
    for(const pref of prefs) {
     const allowed=state.allowed.includes(pref.framework)&&interests[pref.framework]?.includes(pref.name);
     const desired=pref.desired&&allowed;
     const role=assertAssignableRole(await guild.roles.fetch(pref.roleId));
     if(role.name!==`Interest: ${pref.name}` || await resource('role',role.name,db)!==role.id)throw new Error('Interest allowlist drift.');
     const fresh=await guild.members.fetch({user:uid,force:true});
     if(desired&&!fresh.roles.cache.has(role.id))await fresh.roles.add(role,'Recover saved interest preference');
     else if(!desired&&fresh.roles.cache.has(role.id))await fresh.roles.remove(role,'Remove saved or unauthorized interest preference');
     await drizzle(db).update(memberInterests).set({status:allowed?'applied':'blocked'})
      .where(and(filter(uid),eq(memberInterests.roleId,role.id)));
    }
   }
   const fresh=await guild.members.fetch({user:uid,force:true});
   const lifecycle=memberLifecycle({record:state.record,grants:state.grants,pending:fresh.pending,
    held:frameworks.filter(f=>fresh.roles.cache.has(state.ids[f])),memberRole:fresh.roles.cache.has(state.ids.Member),restricted});
   await db.query(`UPDATE members SET onboarding_status=$3,onboarding_block_reason=$4,last_reconciled_at=now(),
    activation_date=CASE WHEN $3='ACTIVE' AND onboarding_flow='staged' THEN COALESCE(activation_date,now()) ELSE activation_date END
    WHERE guild_id=$1 AND user_id=$2`,[guild.id,uid,lifecycle.state,lifecycle.reason]);
   return lifecycle;
  }));
 }
 async function accept(uid,version) {
  await refreshOwnerProtection(guild);assertNotOwner(guild,uid,cfg);
  await locked(`${guild.id}:${uid}`,async db=>{
   const state=await context(uid,db);
   if(state.member.pending!==false)throw new Error('Accept the server’s native Rules Screening first; this button cannot bypass it.');
   const actual=(await db.query("SELECT value FROM bot_settings WHERE guild_id=$1 AND key='rules-version'",[guild.id])).rows[0]?.value??'1';
   if(version!==actual)throw new Error('Rules version changed; reopen /onboarding.');
   await db.query(`UPDATE members SET accepted_at=COALESCE(accepted_at,now()),rules_version_accepted=$3,
    rules_accepted_at=CASE WHEN rules_version_accepted=$3 THEN rules_accepted_at ELSE now() END WHERE guild_id=$1 AND user_id=$2`,
   [guild.id,uid,version]);
   await audit(db,uid,'rules-version-accepted',{version});
  });
  if(native){await native.enqueue(uid);await native.drain();}
  return reconcile(uid);
 }
 async function arrival(uid) {
  await refreshOwnerProtection(guild);assertNotOwner(guild,uid,cfg);
  await locked(`${guild.id}:${uid}`,db=>withRoleWorkflow('native-reconciliation',uid,async()=>{
   const state=await context(uid,db);
   if(state.member.pending!==false||state.record?.onboarding_flow!=='staged'||state.record.interests_completed_at)return;
   // Assigning a role while pending can bypass native screening. Never do that.
   const id=await resource('role','NEW ARRIVAL',db);
   if(!state.member.roles.cache.has(id))await state.member.roles.add(assertAssignableRole(await guild.roles.fetch(id)),'Screened member awaiting staged onboarding');
  }));
 }
 async function finish(uid) {
  await refreshOwnerProtection(guild);assertNotOwner(guild,uid,cfg);
  await locked(`${guild.id}:${uid}`,async db=>{
   const state=await context(uid,db);
   if(state.member.pending!==false||!state.allowed.length)throw new Error('Rules acceptance and primary framework are required.');
   const version=(await db.query("SELECT value FROM bot_settings WHERE guild_id=$1 AND key='rules-version'",[guild.id])).rows[0]?.value??'1';
   if(state.record.onboarding_flow==='staged'&&state.record.rules_version_accepted!==version)throw new Error('Confirm the current rules version before activation.');
   await db.query(`UPDATE members SET interests_completed_at=COALESCE(interests_completed_at,now()),
    access_authoritative=CASE WHEN onboarding_flow='staged' THEN true ELSE access_authoritative END WHERE guild_id=$1 AND user_id=$2`,[guild.id,uid]);
   await audit(db,uid,'interests-completed',{});
  });
  return reconcile(uid);
 }
 async function recover(uid,actor) {
  await reconcile(uid);
  await audit(pool,actor,'onboarding-recovery-requested',{subject:uid,mode:'reconcile-only-no-security-reset'});
 }
 return {ensure,context,preferences,changeInterest,reconcile,accept,finish,recover,arrival,
  async leave(uid) {await pool.query('UPDATE members SET left_at=now() WHERE guild_id=$1 AND user_id=$2',[guild.id,uid]);}};
}
