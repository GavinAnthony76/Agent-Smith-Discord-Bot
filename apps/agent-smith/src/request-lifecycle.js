import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { parseRequestId, requestAge } from './review.js';
import { withRequestNotification, isOwner, assertOwnerConfiguration } from './security-policy.js';

export const REQUEST_STATUSES = Object.freeze(['pending','approved','denied','expired','withdrawn']);
export function requestExpired(request, now = Date.now()) {
  return request.expires_at != null && new Date(request.expires_at).getTime() <= now;
}
export function withdrawalAction(i) {
  if (!i.isButton() || !i.customId.startsWith('smith:request:withdraw:')) return null;
  return { id: parseRequestId(i.customId.slice('smith:request:withdraw:'.length)) };
}
export function myRequestsMessage(rows) {
  return { content: rows.length ? ['**Your recent community requests**',
    ...rows.map(r => `Request #${r.id} — ${r.framework} — **${r.status}**${requestAge(r)}`),
    'Expired or withdrawn requests grant no access. You may submit a new request.'].join('\n') : 'You have no community requests.',
    components: rows.filter(r => r.status === 'pending').slice(0,4).map(r => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`smith:request:withdraw:${r.id}`).setLabel(`Withdraw #${r.id}`).setStyle(ButtonStyle.Secondary))),
    allowedMentions:{parse:[]} };
}
export async function assignRequestExpiry(db, guildId, id) {
  await db.query(`UPDATE requests SET expires_at=COALESCE(expires_at,created_at+
    (COALESCE((SELECT (value->>'days')::integer FROM bot_settings WHERE guild_id=$1 AND key='request-expiry'),14)*interval '1 day'))
    WHERE guild_id=$1 AND id=$2`, [guildId,id]);
}
export async function transitionRequest(db, { guildId, request, status, actor }) {
  if (!REQUEST_STATUSES.includes(status) || status === 'pending') throw new Error('Invalid terminal request state.');
  const result = await db.query("UPDATE requests SET status=$3 WHERE guild_id=$1 AND id=$2 AND status='pending' RETURNING *",
    [guildId,request.id,status]);
  if (!result.rows.length) throw new Error('Request is no longer pending.');
  await db.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)',
    [guildId,actor,'request.transition',JSON.stringify({request:String(request.id),from:'pending',to:status,subject:request.user_id,framework:request.framework})]);
  if (status === 'expired') await db.query(`INSERT INTO request_notifications(request_id,guild_id,user_id,framework)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[request.id,guildId,request.user_id,request.framework]);
}
export function createRequestLifecycle({ guild, client, cfg = {}, pool, locked }) {
  let timer, busy = false;
  async function expire() {
    if (busy) return;
    busy = true;
    try {
      if(guild.fetch){await guild.fetch();assertOwnerConfiguration(cfg,guild.ownerId);}
      const due = (await pool.query("SELECT id,user_id FROM requests WHERE guild_id=$1 AND status='pending' AND expires_at<=now() AND NOT(user_id=ANY($2::text[])) ORDER BY expires_at,id LIMIT 100",
        [guild.id,[guild.ownerId,cfg.ownerDiscordId,...(cfg.owners??[])].filter(Boolean)])).rows;
      for (const row of due) {
        if(isOwner(row.user_id,cfg,guild.ownerId))continue;
        await locked(`${guild.id}:${row.user_id}`,async db => {
        const request=(await db.query("SELECT * FROM requests WHERE guild_id=$1 AND id=$2 AND status='pending' AND expires_at<=now() FOR UPDATE",[guild.id,row.id])).rows[0];
        if (request) await transitionRequest(db,{guildId:guild.id,request,status:'expired',actor:client.user.id});
      });
      }
      const notices=(await pool.query("SELECT * FROM request_notifications WHERE guild_id=$1 AND status='pending' ORDER BY request_id LIMIT 20",[guild.id])).rows;
      for (const notice of notices) {
        const claim=await pool.query("UPDATE request_notifications SET status='sending',updated_at=now() WHERE request_id=$1 AND status='pending' RETURNING request_id",[notice.request_id]);
        if (!claim.rows.length) continue;
        // Do not automatically resend after a lost acknowledgement; /requests is
        // the reliable inbox even when DMs are closed or delivery is uncertain.
        try {
          await withRequestNotification(notice.user_id,async()=> {
            const member=await guild.members.fetch({user:notice.user_id,force:true});
            await member.send({content:`Your ${notice.framework} access request #${notice.request_id} expired without a decision. No access was changed. You can resubmit in #access-requests or view /requests.`,allowedMentions:{parse:[]}});
          });
          await pool.query("UPDATE request_notifications SET status='sent',updated_at=now() WHERE request_id=$1",[notice.request_id]);
        } catch (error) {
          await pool.query("UPDATE request_notifications SET status='uncertain',error_code=$2,updated_at=now() WHERE request_id=$1",[notice.request_id,String(error.code??'delivery-unconfirmed')]);
          console.error('Request expiry notification unconfirmed; member can view /requests.');
        }
      }
    } finally { busy=false; }
  }
  return { expire, start() {
    timer=setInterval(()=>expire().catch(()=>console.error('Request expiry sweep deferred.')),60000);timer.unref();
    expire().catch(()=>console.error('Request expiry startup sweep deferred.'));
  }, stop(){clearInterval(timer);} };
}
