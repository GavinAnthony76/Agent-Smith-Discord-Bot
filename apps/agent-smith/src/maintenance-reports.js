import { ActionRowBuilder,ButtonBuilder,ButtonStyle,PermissionFlagsBits as P } from 'discord.js';
import { assertStaffChannel,hasPermission } from './permissions.js';
export function createReports({guild,client,pool,locked,resource,audit,cfg}) {
 async function submit(uid,target,reason,reference) {
  if(!reason?.trim()||reason.length>1000)throw new Error('Report reason must be 1–1000 characters.');
  if(target&&!/^\d{17,20}$/.test(target))throw new Error('Invalid reported member ID.');
  if(reference&&!/^https:\/\/(?:discord\.com|discordapp\.com)\/channels\/\d+\/\d+\/\d+$/.test(reference))throw new Error('Use a Discord message link or leave it blank.');
  if(reference&&reference.split('/')[4]!==guild.id)throw new Error('Report must refer to this server.');
  return locked(`report:${guild.id}:${uid}`,async db=>{
   const recent=await db.query("SELECT 1 FROM member_reports WHERE guild_id=$1 AND reporter_id=$2 AND created_at>now()-interval '60 seconds'",[guild.id,uid]);
   if(recent.rowCount)throw new Error('Please wait one minute before another report.');
   const result=await db.query('INSERT INTO member_reports(guild_id,reporter_id,target_id,reason,reference) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [guild.id,uid,target||null,reason.trim(),reference||null]);
   await audit(db,uid,'report-submitted',{reportId:String(result.rows[0].id)});
   return String(result.rows[0].id);
  });
 }
 async function deliver() {
  const rows=(await pool.query('SELECT * FROM member_reports WHERE guild_id=$1 AND delivered_at IS NULL ORDER BY id LIMIT 10',[guild.id])).rows;
  if(!rows.length)return;
  const channel=await guild.channels.fetch(await resource('channel','access-review'));
  assertStaffChannel(channel,guild,cfg);
  if(hasPermission(guild.roles.everyone,P.ViewChannel,channel))throw new Error('Reports destination must be private.');
  for(const r of rows) {
   const id=String(r.id);
   await channel.send({content:`**Private report #${id}**\nReporter: ${r.reporter_id}\nReported: ${r.target_id??'not specified'}\nReason: ${r.reason}\nMessage: ${r.reference??'none'}\nTime: ${new Date(r.created_at).toISOString()}`.slice(0,1900),
    nonce:`report${id}`,enforceNonce:true,allowedMentions:{parse:[]},
    components:[new ActionRowBuilder().addComponents(['claim','warn','timeout'].map(action=>new ButtonBuilder()
     .setCustomId(`smith:report:${action}:${id}`).setLabel(action.toUpperCase()).setStyle(ButtonStyle.Secondary))),
    new ActionRowBuilder().addComponents(['escalate','dismiss','close'].map(action=>new ButtonBuilder()
     .setCustomId(`smith:report:${action}:${id}`).setLabel(action.toUpperCase()).setStyle(ButtonStyle.Secondary)))]});
   await pool.query('UPDATE member_reports SET delivered_at=now() WHERE guild_id=$1 AND id=$2',[guild.id,id]);
  }
 }
 async function transition(id,actor,operation) {
  const statuses={claim:'claimed',escalate:'escalated',dismiss:'dismissed',close:'closed'};
  if(!/^[1-9]\d{0,18}$/.test(id)||!statuses[operation])throw new Error('Invalid report action.');
  return locked(`report-case:${guild.id}:${id}`,async db=>{
   const row=(await db.query('SELECT * FROM member_reports WHERE guild_id=$1 AND id=$2 FOR UPDATE',[guild.id,id])).rows[0];
   if(!row)throw new Error('Report not found.');
   if(['dismissed','closed'].includes(row.status))throw new Error('Report already resolved.');
   if(row.claimed_by&&row.claimed_by!==actor)throw new Error('Another staff member has claimed this report.');
   await db.query('UPDATE member_reports SET status=$3,claimed_by=$4,updated_at=now() WHERE guild_id=$1 AND id=$2',[guild.id,id,statuses[operation],actor]);
   await audit(db,actor,'report-action',{reportId:id,operation});
   return statuses[operation];
  });
 }
 return {submit,deliver,transition,
  async reserveAction(id,actor,operation) {
   if(!['warn','timeout'].includes(operation))throw new Error('Invalid punishment action.');
    await locked(`report-case:${guild.id}:${id}`,async db=>{
     const report=(await db.query('SELECT * FROM member_reports WHERE guild_id=$1 AND id=$2 FOR UPDATE',[guild.id,id])).rows[0];
     if(!report||!report.target_id||['closed','dismissed'].includes(report.status)||report.claimed_by!==actor)throw new Error('Claim an open report with a target before punishment.');
     const r=await db.query(`INSERT INTO report_actions(guild_id,report_id,operation,actor_id)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING report_id`,[guild.id,id,operation,actor]);
     if(!r.rowCount)throw new Error('This report action was already attempted. Inspect its case; do not repeat an uncertain punishment.');
    });
  },
  finishAction:(id,operation,status)=>pool.query('UPDATE report_actions SET status=$4 WHERE guild_id=$1 AND report_id=$2 AND operation=$3',[guild.id,id,operation,status])};
}
