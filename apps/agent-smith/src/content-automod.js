import { createHash } from 'node:crypto';
import { isProtectedOwner } from './security-policy.js';
export const CONTENT_ACTIONS=Object.freeze(['LOG','DELETE','WARN','TIMEOUT','ESCALATE']);
const normalize=s=>String(s).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function contentSignals(content,cfg={},stats={}) {
 const text=normalize(content),signals=[];
 const match=list=>(list??[]).some(v=>text.includes(normalize(v)));
 const invites=[...text.matchAll(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]+)/gi)].map(m=>m[1]);
 if(invites.some(code=>!(cfg.allowedInviteCodes??[]).map(normalize).includes(code)))signals.push('external-invite');
 if(match(cfg.bannedWords))signals.push('banned-word');
 const domains=[...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m=>m[1]);
 if(domains.some(d=>(cfg.blockedDomains??[]).some(b=>d===normalize(b)||d.endsWith(`.${normalize(b)}`))))signals.push('blocked-domain');
 if((stats.mentions??0)>=5)signals.push('mass-mention');
 if((stats.messages??0)>=8)signals.push('message-flood');
 if((stats.duplicates??0)>=3)signals.push('duplicate-spam');
 if((content.match(/\p{Extended_Pictographic}/gu)??[]).length>=20)signals.push('emoji-flood');
 const letters=content.match(/[a-z]/gi)??[];
 if(letters.length>=20&&letters.filter(c=>c===c.toUpperCase()).length/letters.length>=0.85)signals.push('caps-flood');
 if(match(cfg.scamPhrases)||/free\s+nitro.*(?:https?:\/\/)|steam.*(?:gift|free).*login|verify.*wallet.*seed/i.test(text))signals.push('scam-pattern');
 return [...new Set(signals)];
}
export function createContentAutomod({guild,cfg,pool,resource,audit,moderation}) {
 let cached=null,until=0;
 return {async handle(message) {
  if(!cfg.contentEnabled||message.guildId!==guild.id||message.author.bot||isProtectedOwner(guild,message.author.id)||!message.content)return;
  if(Date.now()>until) {cached=(await pool.query("SELECT value FROM bot_settings WHERE guild_id=$1 AND key='content-automod'",[guild.id])).rows[0]?.value;until=Date.now()+30000;}
  if(!cached?.enabled||cached.excludedChannels?.includes(message.channelId)||cached.excludedCategories?.includes(message.channel.parentId))return;
  const hash=createHash('sha256').update(normalize(message.content)).digest('hex');
  const added=await pool.query('INSERT INTO automod_observations(guild_id,user_id,message_id,content_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[guild.id,message.author.id,message.id,hash]);
  if(!added.rowCount)return;
  const counts=(await pool.query(`SELECT count(*)::int AS messages,count(*) FILTER(WHERE content_hash=$3)::int AS duplicates
   FROM automod_observations WHERE guild_id=$1 AND user_id=$2 AND created_at>now()-interval '10 seconds'`,[guild.id,message.author.id,hash])).rows[0];
  for(const rule of contentSignals(message.content,cached,{...counts,mentions:message.mentions.users.size+(message.mentions.everyone?5:0)})) {
   const action=cached.actions?.[rule]??'LOG';
   if(!CONTENT_ACTIONS.includes(action))throw new Error('Invalid configured deterministic action.');
   const reserved=await pool.query('INSERT INTO automod_actions(guild_id,message_id,rule,action) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING rule',[guild.id,message.id,rule,action]);
   if(!reserved.rowCount)continue;
   try {
    await audit(pool,cfg.clientId,'content-automod',{subject:message.author.id,channelId:message.channelId,messageId:message.id,rule,action});
    if(['DELETE','WARN','TIMEOUT'].includes(action)) {
     if(!cfg.owners.includes(cached.configuredBy))throw new Error('Automatic punishment requires explicit current Owner configuration.');
     const operation=action==='DELETE'?'purge':action==='WARN'?'warn':'timeout';
     await moderation.execute({operation,target:operation==='purge'?undefined:message.author.id,channel:message.channelId,
      messageIds:[message.id],minutes:5,reason:`Deterministic automod: ${rule}`},cached.configuredBy,operation==='purge');
    } else if(action==='ESCALATE') {
     const channel=await guild.channels.fetch(await resource('channel','access-review'));
     const {assertStaffChannel}=await import('./permissions.js');assertStaffChannel(channel,guild,cfg);
     await channel.send({content:`Automod ${rule}: member ${message.author.id}, message ${message.id}, channel ${message.channelId}. Human review required.`,allowedMentions:{parse:[]}});
    }
    await pool.query("UPDATE automod_actions SET status='completed' WHERE guild_id=$1 AND message_id=$2 AND rule=$3",[guild.id,message.id,rule]);
   }catch(error){
    await pool.query("UPDATE automod_actions SET status='uncertain' WHERE guild_id=$1 AND message_id=$2 AND rule=$3",[guild.id,message.id,rule]).catch(()=>{});
    await audit(pool,cfg.clientId,'content-automod-blocked',{rule,action,messageId:message.id,errorCode:error.code??null});
   }
  }
 }};
}
