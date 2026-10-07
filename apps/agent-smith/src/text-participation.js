import { createHash } from 'node:crypto';
import { contentSignals } from './content-automod.js';
import { isProtectedOwner } from './security-policy.js';
export function eligibleText(content) {
 const normalized=String(content??'').normalize('NFKC').trim().replace(/\s+/g,' ');
 return normalized.length>=20&&normalized.split(' ').length>=4&&!/^[!/.?$]/.test(normalized)
  &&!/^(.)\1+$/u.test(normalized)&&!contentSignals(normalized).length;
}
export function createTextParticipation({guild,cfg,pool,locked,progression}) {
 return {async handle(message) {
  if(!cfg.contentEnabled||message.guildId!==guild.id||message.author.bot||isProtectedOwner(guild,message.author.id)||!eligibleText(message.content))return;
  const setting=(await pool.query("SELECT value FROM bot_settings WHERE guild_id=$1 AND key='text-xp'",[guild.id])).rows[0]?.value;
  if(!setting?.enabled||setting.excludedChannels?.includes(message.channelId)||setting.excludedCategories?.includes(message.channel.parentId))return;
  await locked(`${guild.id}:${message.author.id}`,async db=>{
   const record=(await db.query('SELECT onboarding_status FROM members WHERE guild_id=$1 AND user_id=$2',[guild.id,message.author.id])).rows[0];
   if(record?.onboarding_status!=='ACTIVE')return;
   const category=(await db.query("SELECT name FROM resources WHERE guild_id=$1 AND kind='category' AND discord_id=$2",[guild.id,message.channel.parentId])).rows[0]?.name;
   const framework={FAITH:'Faith',GAMING:'Gaming',TECH:'Tech'}[category];if(!framework)return;
   const hash=createHash('sha256').update(message.content.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()).digest('hex');
   if((await db.query("SELECT 1 FROM text_participation WHERE guild_id=$1 AND user_id=$2 AND content_hash=$3 AND created_at>now()-interval '24 hours'",[guild.id,message.author.id,hash])).rowCount)return;
   const inserted=await db.query('INSERT INTO text_participation(guild_id,user_id,message_id,content_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[guild.id,message.author.id,message.id,hash]);
   if(!inserted.rowCount)return;
   await progression.earnTx(db,{uid:message.author.id,framework,source:'text',key:`text:${message.id}`,actor:cfg.clientId,reason:'Eligible nonduplicate framework text; 60-second cooldown and daily caps'});
  });
 }};
}
