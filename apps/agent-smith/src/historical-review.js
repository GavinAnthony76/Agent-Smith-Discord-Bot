import { createHash } from 'node:crypto';
import { frameworks } from './blueprint.js';
import { assertHistoricalReviewer } from './authorization.js';
import { assertNotOwner,refreshOwnerProtection } from './security-policy.js';

const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
export class HistoricalReviewError extends Error {}
const validId=uid=>{if(!/^[1-9]\d{0,18}$/.test(uid))throw new HistoricalReviewError('Invalid member ID.');};
const validFramework=f=>{if(!frameworks.includes(f))throw new HistoricalReviewError('Invalid framework.');};

// Recording only: never mutate Discord, infer consent from roles/Selections,
// rewrite an established primary, or promote historical access to authoritative.
export function createHistoricalReview({guild,cfg,pool,locked,audit,context}) {
 const version=async db=>(await db.query("SELECT value FROM bot_settings WHERE guild_id=$1 AND key='rules-version'",[guild.id])).rows[0]?.value??'1';
 async function protect(uid) {
  validId(uid);await refreshOwnerProtection(guild);assertNotOwner(guild,uid,cfg);
 }
 function eligible(state,primary) {
  validFramework(primary);
  if(state.member.guild.id!==guild.id||state.member.user.bot||state.member.pending!==false)
   throw new HistoricalReviewError('A current human member with completed Rules Screening is required.');
  if(state.record?.primary_framework&&state.record.primary_framework!==primary)
   throw new HistoricalReviewError('The established primary is immutable.');
  if(!state.member.roles.cache.has(state.ids[primary]))
   throw new HistoricalReviewError('Historical recording requires an existing primary access role; no roles are granted.');
 }
 async function consentPreview(uid,primary) {
  await protect(uid);
  const state=await context(uid);eligible(state,primary);
  const current=await version(pool);
  return {version:current,token:fingerprint([uid,primary,current])};
 }
 async function consent(uid,primary,token) {
  await protect(uid);
  return locked(`${guild.id}:${uid}`,async db=>{
   await protect(uid);
   const state=await context(uid,db);eligible(state,primary);
   const current=await version(db);
   if(token!==fingerprint([uid,primary,current]))throw new HistoricalReviewError('Rules changed; reopen /framework-consent.');
   await audit(db,uid,'historical-framework-consent',{subject:uid,primary,version:current,
    source:'current-member-confirmation-not-historical-consent'},true);
   return 'Current consent saved for Owner review. No roles, primary record, or approvals were changed.';
  });
 }
 async function snapshot(db,uid,primary,extra) {
  const state=await context(uid,db);eligible(state,primary);
  if(extra) {
   validFramework(extra);
   if(extra===primary)throw new HistoricalReviewError('Additional approval must differ from the primary.');
   if(!state.member.roles.cache.has(state.ids[extra]))throw new HistoricalReviewError('Additional historical access role is not held.');
  }
  const current=await version(db);
  const confirmation=(await db.query(`SELECT id,created_at,detail FROM audit WHERE guild_id=$1 AND actor=$2
   AND action='historical-framework-consent' AND detail->>'subject'=$2 ORDER BY id DESC LIMIT 1`,[guild.id,uid])).rows[0];
  // Existing real saved acceptance remains valid. A missing acceptance or
  // primary requires an explicit current self-confirmation, never a role signal.
  if(!state.record?.accepted_at||!state.record?.primary_framework) {
   if(!confirmation||confirmation.detail.primary!==primary||confirmation.detail.version!==current)
    throw new HistoricalReviewError('Member must use /framework-consent to confirm current rules and intended primary first.');
  }
  const pending=extra?(await db.query(`SELECT id FROM requests WHERE guild_id=$1 AND user_id=$2 AND framework=$3
   AND status='pending'`,[guild.id,uid,extra])).rows.map(r=>String(r.id)):[];
  if(pending.length)throw new HistoricalReviewError('Review the pending access request with /review instead.');
  const held=frameworks.filter(f=>state.member.roles.cache.has(state.ids[f]));
  const token=fingerprint({uid,primary,extra:extra??null,held,ids:state.ids,
   primaryRecord:state.record?.primary_framework??null,accepted:state.record?.accepted_at??null,
   grants:[...state.grants].sort(),consent:confirmation?.id??null,current,
   authoritative:state.record?.access_authoritative??false});
  return {state,current,confirmation,held,token};
 }
 async function owner(actorId,uid) {
  await protect(uid);
  assertHistoricalReviewer(await guild.members.fetch({user:actorId,force:true}),cfg,guild);
 }
 async function preview(uid,actorId,primary,extra) {
  await owner(actorId,uid);
  return locked(`${guild.id}:${uid}`,async db=>{
   await owner(actorId,uid);
   const s=await snapshot(db,uid,primary,extra);
   return {token:s.token,held:s.held,primary:s.state.record?.primary_framework??null,
    grants:s.state.grants,accepted:!!s.state.record?.accepted_at,
    consentAt:s.confirmation?.created_at??null};
  });
 }
 async function record(uid,actorId,primary,extra,token) {
  await owner(actorId,uid);
  return locked(`${guild.id}:${uid}`,async db=>{
   // Recheck authorization/protection after waiting for the member transaction.
   await owner(actorId,uid);
   await db.query('SELECT user_id FROM members WHERE guild_id=$1 AND user_id=$2 FOR UPDATE',[guild.id,uid]);
   const s=await snapshot(db,uid,primary,extra);
   if(s.token!==token)throw new HistoricalReviewError('Review state changed; reopen /framework-review. Nothing was recorded.');
   const needsPrimary=!s.state.record?.primary_framework;
   const needsConsent=!s.state.record?.accepted_at;
   const needsExtra=extra&&!s.state.grants.includes(extra);
   const pendingHistorical=s.held.some(f=>f!==primary&&!s.state.grants.includes(f)&&f!==extra);
   const preservePending=pendingHistorical&&s.state.record?.access_authoritative;
   if(!needsPrimary&&!needsConsent&&!needsExtra&&!preservePending)return 'Already recorded; existing timestamps and approvals preserved.';
   await db.query('INSERT INTO members(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[guild.id,uid]);
   await db.query(`UPDATE members SET primary_framework=COALESCE(primary_framework,$3),
    accepted_at=COALESCE(accepted_at,$4),
    rules_version_accepted=CASE WHEN accepted_at IS NULL THEN $5 ELSE rules_version_accepted END,
    rules_accepted_at=CASE WHEN accepted_at IS NULL THEN $4 ELSE rules_accepted_at END,
    access_authoritative=CASE WHEN $6 THEN false ELSE access_authoritative END
    WHERE guild_id=$1 AND user_id=$2`,[guild.id,uid,primary,
     needsConsent?s.confirmation.created_at:s.state.record.accepted_at,s.current,pendingHistorical]);
   if(needsExtra)await db.query(`INSERT INTO grants(guild_id,user_id,framework,reviewer,created_at)
    VALUES($1,$2,$3,$4,clock_timestamp()) ON CONFLICT DO NOTHING`,[guild.id,uid,extra,actorId]);
   await audit(db,actorId,'historical-framework-reviewed',{subject:uid,primary,extra:extra??null,
    recordedPrimary:needsPrimary,recordedConsent:needsConsent,recordedExtra:!!needsExtra,preservedPendingReview:!!pendingHistorical,
    consentId:s.confirmation?String(s.confirmation.id):null,held:s.held,
    source:'new-owner-review-not-historical-approval',rolesChanged:false},true);
   return 'Owner review recorded at the current review time. Existing roles and earlier records preserved; remaining unrecorded access still needs individual review.';
  });
 }
 return {consentPreview,consent,preview,record};
}
