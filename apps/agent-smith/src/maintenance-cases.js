import { caseOutcome } from './lifecycle-policy.js';
import { withModerationWorkflow,assertNotOwner } from './security-policy.js';
export function createCases({guild,client,cfg,pool,locked,audit}) {
 async function record(actor,action,detail) {
  return locked(`cases:${guild.id}`,async db=>{
   const saved=await db.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4) RETURNING id',
    [guild.id,actor,action,JSON.stringify(detail)]);
   const id=String(saved.rows[0].id);
   if(['mod.warn','mod.intent'].includes(action)) {
    await db.query(`INSERT INTO moderation_cases(case_id,guild_id,user_id,moderator_id,action_type,reason,duration_minutes,expires_at,status,active)
     VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7::integer IS NOT NULL THEN now()+($7 * interval '1 minute') END,$8,$9)`,
    [id,guild.id,detail.target??null,actor,detail.operation??'warn',detail.reason??'',detail.minutes??null,
     action==='mod.warn'?'completed':'pending',action==='mod.warn']);
   } else if(action==='mod.result') {
    const status=caseOutcome(detail);
    await db.query(`UPDATE moderation_cases SET status=$3,active=($3='completed' AND action_type IN ('warn','timeout','ban')),
     resolved_at=CASE WHEN $3='failed' THEN now() END WHERE guild_id=$1 AND case_id=$2`,[guild.id,detail.caseId,status]);
    if(status==='completed'&&['untimeout','unban'].includes(detail.operation))
     await db.query(`UPDATE moderation_cases SET active=false,resolved_at=now() WHERE guild_id=$1 AND user_id=$2
      AND action_type=$3 AND active`,[guild.id,detail.target,detail.operation==='unban'?'ban':'timeout']);
   } else if(action==='mod.unwarn')await db.query(`UPDATE moderation_cases SET active=false,status='withdrawn',resolved_at=now()
    WHERE guild_id=$1 AND case_id=$2 AND action_type='warn'`,[guild.id,detail.warningCase]);
   return id;
  });
 }
 async function restoreTimeout(uid) {
  assertNotOwner(guild,uid,cfg);
  const r=await pool.query(`SELECT * FROM moderation_cases WHERE guild_id=$1 AND user_id=$2
   AND action_type='timeout' AND active AND status='completed' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1`,[guild.id,uid]);
  if(!r.rowCount)return;
  const c=r.rows[0],member=await guild.members.fetch({user:uid,force:true});
  if((member.communicationDisabledUntilTimestamp??0)>=new Date(c.expires_at).getTime())return;
  // Authenticated original human, same hard permission/hierarchy gate; never extend the original expiry.
  await withModerationWorkflow({operation:'timeout',target:uid},c.moderator_id,()=>member.disableCommunicationUntil(new Date(c.expires_at),`Restore existing case #${c.case_id}`));
  await audit(pool,client.user.id,'punishment-rejoined-restored',{subject:uid,caseId:String(c.case_id)});
 }
 return {record,restoreTimeout,
  async restricted(uid) {
   return (await pool.query(`SELECT 1 FROM moderation_cases WHERE guild_id=$1 AND user_id=$2 AND active AND status='completed'
    AND action_type IN ('timeout','ban') AND (expires_at IS NULL OR expires_at>now()) LIMIT 1`,[guild.id,uid])).rowCount>0;
  },
  list:uid=>pool.query('SELECT * FROM moderation_cases WHERE guild_id=$1 AND ($2::text IS NULL OR user_id=$2) ORDER BY case_id DESC LIMIT 15',[guild.id,uid??null]),
  async note(id,actor,note) {
   if(!/^[1-9]\d{0,18}$/.test(id)||!note.trim()||note.length>1000)throw new Error('Valid case ID and note required.');
   await locked(`case:${guild.id}:${id}`,async db=>{
    if(!(await db.query('SELECT 1 FROM moderation_cases WHERE guild_id=$1 AND case_id=$2 FOR UPDATE',[guild.id,id])).rowCount)throw new Error('Case not found.');
    await db.query('INSERT INTO moderation_case_notes(guild_id,case_id,actor_id,note) VALUES($1,$2,$3,$4)',[guild.id,id,actor,note]);
    await audit(db,actor,'case-note',{caseId:id});
   });
  },
  async close(id,actor) {
   if(!/^[1-9]\d{0,18}$/.test(id))throw new Error('Invalid case ID.');
   const r=await pool.query('UPDATE moderation_cases SET closed_at=COALESCE(closed_at,now()) WHERE guild_id=$1 AND case_id=$2 RETURNING case_id',[guild.id,id]);
   if(!r.rowCount)throw new Error('Case not found.');
   await audit(pool,actor,'case-closed',{caseId:id,restrictionUnchanged:true});
  }};
}
