import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { assertPermission, hasPermission } from './permissions.js';
import { createFeedStore, feedLock } from './feed-store.js';
import { fetchFeed } from './feed-http.js';

export function createFeeds(ctx) {
  const {pool,guild,client,resource,audit}=ctx;
  const store=createFeedStore({pool,guildId:guild.id,audit,...(ctx.validateURL?{validateURL:ctx.validateURL}:{})});
  let running=false,stopped=false,timer=null,active=null;
  const safeError=e=>String(e?.message??'Feed failure').slice(0,300);
  async function channelFor(destination) {
    const channel=await guild.channels.fetch(await resource('channel',destination));
    if(!channel||channel.guildId!==guild.id||channel.type!==ChannelType.GuildText)throw new Error('Tracked framework news text channel required.');
    const bot=await guild.members.fetchMe({force:true});
    assertPermission(bot,P.ViewChannel,channel);
    assertPermission(bot,P.SendMessages,channel);
    return {channel,bot};
  }
  async function poll(id) {
    const db=await pool.connect();
    let acquired=false,releaseLock=false,discard=false;
    try {
      releaseLock=true;
      acquired=(await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[feedLock(guild.id,id)])).rows[0].acquired;
      if(!acquired){releaseLock=false;return;}
      // This session lock serializes polling, recovery and Owner configuration.
      // Autocommit reserves must be acknowledged before any Discord send.
      await db.query(`UPDATE feed_deliveries SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE state END,
       thread_state=CASE WHEN thread_state='creating' THEN 'uncertain'
        WHEN thread_state='pending' AND state='delivered' THEN 'disabled' ELSE thread_state END,updated_at=now()
       WHERE guild_id=$1 AND feed_id=$2 AND (state='sending' OR thread_state IN ('creating','pending'))`,[guild.id,id]);
      const s=(await db.query('SELECT * FROM feed_sources WHERE guild_id=$1 AND feed_id=$2 AND enabled AND approved_at IS NOT NULL AND next_poll_at<=now()',[guild.id,id])).rows[0];
      if(!s||stopped||!client.isReady())return;
      await db.query(`UPDATE feed_sources SET last_poll_at=now(),next_poll_at=now()+interval_minutes*interval '1 minute'
       WHERE guild_id=$1 AND feed_id=$2`,[guild.id,id]);
      try {
        const items=await (ctx.fetchFeed??fetchFeed)(s.url);
        const {channel,bot}=await channelFor(s.destination);
        for(const item of items.slice(0,5)) {
          if(stopped||!client.isReady())break;
          const d=await store.reserve(db,s,item,channel.id);
          if(!d)continue;
          let message;
          try {
            const nonce=BigInt(`0x${createHash('sha256').update(`${guild.id}:${id}:${d.item_id}`).digest('hex').slice(0,20)}`).toString().slice(0,24);
            message=await channel.send({content:d.content,allowedMentions:{parse:[]},nonce,enforceNonce:true});
            await store.delivered(db,d,message.id);
          } catch(error) {
            // Even a rejected send or a lost database acknowledgment can have
            // succeeded. No scheduled retry is permitted for this item.
            await db.query(`UPDATE feed_deliveries SET state='uncertain',last_error=$4,updated_at=now()
             WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3 AND state='sending'`,[guild.id,id,d.item_id,safeError(error)]);
            continue;
          }
          if(s.discussion_threads) {
            const allowed=hasPermission(bot,P.CreatePublicThreads,channel)&&hasPermission(bot,P.SendMessagesInThreads,channel);
            await db.query(`UPDATE feed_deliveries SET thread_state=$4,updated_at=now()
             WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3`,[guild.id,id,d.item_id,allowed?'creating':'permission-denied']);
            if(allowed) {
              try {
                // Permission checks are repeated immediately before creation.
                const currentBot=await guild.members.fetchMe({force:true});
                assertPermission(currentBot,P.CreatePublicThreads,channel);
                assertPermission(currentBot,P.SendMessagesInThreads,channel);
                const thread=await message.startThread({name:d.title.slice(0,100)||'Discuss update',autoArchiveDuration:1440,reason:'Owner-approved optional feed discussion'});
                await db.query(`UPDATE feed_deliveries SET thread_state='created',thread_id=$4,updated_at=now()
                 WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3`,[guild.id,id,d.item_id,thread.id]);
              } catch(error) {
                await db.query(`UPDATE feed_deliveries SET thread_state='uncertain',last_error=$4,updated_at=now()
                 WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3 AND thread_state='creating'`,[guild.id,id,d.item_id,safeError(error)]);
              }
            }
          }
        }
        await db.query('UPDATE feed_sources SET last_success_at=now(),last_error=NULL WHERE guild_id=$1 AND feed_id=$2',[guild.id,id]);
        await audit(db,client.user.id,'feeds.poll',{id,entries:items.length});
      } catch(error) {
        await db.query('UPDATE feed_sources SET last_error=$3 WHERE guild_id=$1 AND feed_id=$2',[guild.id,id,safeError(error)]);
      }
    } finally {
      if(releaseLock) {
        try {await db.query('SELECT pg_advisory_unlock(hashtext($1))',[feedLock(guild.id,id)]);}
        catch {discard=true;}
      }
      db.release(discard);
    }
  }
  async function drain() {
    if(running||stopped)return;
    running=true;
    try {
      // Include disabled sources for crash-state recovery, never for posting.
      for(const s of await store.list()) {
        if(stopped)break;
        await poll(s.feed_id);
      }
      await pool.query(`INSERT INTO worker_health(guild_id,worker,last_seen_at,detail) VALUES($1,'feeds',now(),$2)
       ON CONFLICT(guild_id,worker) DO UPDATE SET last_seen_at=now(),detail=EXCLUDED.detail`,[guild.id,JSON.stringify({integrated:true})]);
    } finally {running=false;}
  }
  function tick() {
    if(stopped||active)return active;
    active=drain().catch(error=>console.error('Feed worker deferred:',error.code??error.name)).finally(()=>{active=null;});
    return active;
  }
  async function start() {
    await store.seed(ctx.drafts??JSON.parse(await readFile(new URL('../feeds.json',import.meta.url),'utf8')));
    timer=setInterval(tick,30000);timer.unref();void tick();
  }
  async function status(id,page=1) {
    if(!Number.isInteger(page)||page<1||page>10000)throw new Error('Invalid status page.');
    const sources=await store.list(id),uncertain=await store.uncertain(id,page);
    const health=(await pool.query("SELECT last_seen_at FROM worker_health WHERE guild_id=$1 AND worker='feeds'",[guild.id])).rows[0];
    const shown=id?sources:sources.slice((page-1)*5,page*5);
    return `**Framework feeds — integrated worker**\nHeartbeat: ${health?.last_seen_at??'not yet recorded'}\nSources (${sources.length}), page ${page}:\n${shown.map(s=>`${s.feed_id}: ${s.enabled?'approved / enabled':'disabled'} → ${s.destination}; ${s.interval_minutes}m; threads ${s.discussion_threads?'on':'off'}${id?`\nURL: ${s.url.slice(0,200)}\nApproved: ${s.approved_at??'never'} by ${s.approved_by??'none'}\nLast poll: ${s.last_poll_at??'never'}; next: ${s.next_poll_at}; error: ${(s.last_error??'none').slice(0,120)}`:''}`).join('\n')||'No sources on this page.'}\nHeld deliveries (5/page):\n${uncertain.map(d=>`${d.feed_id} receipt ${d.delivery_id}: ${d.state}; thread ${d.thread_state}; <#${d.channel_id}>`).join('\n')||'none on this page'}\nUse feed-status id/page for more. Unconfirmed sends/threads never auto-repeat. feed-resolve confirms an existing message or skips a receipt.`;
  }
  async function approve(id,enabled,actor) {
    if(enabled) {
      const s=(await store.list(id))[0];if(!s)throw new Error('Source not found.');
      await channelFor(s.destination);
    }
    return store.enable(id,enabled,actor);
  }
  async function resolve(id,deliveryId,actor,options) {
    return store.resolve(id,deliveryId,actor,{...options,async verifyMessage(d,messageId) {
      const channel=await guild.channels.fetch(d.channel_id);
      if(channel?.guildId!==guild.id)throw new Error('Delivery channel is unavailable.');
      const message=await channel.messages.fetch({message:messageId,force:true});
      if(message.author?.id!==client.user.id||message.content!==d.content)throw new Error('Existing message must be Smith’s exact saved feed post.');
    }});
  }
  return {start,drain,status,save:store.save,approve,resolve,
    async stop(){stopped=true;clearInterval(timer);if(active)await active;}};
}
