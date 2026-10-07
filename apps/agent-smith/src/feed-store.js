import { FEED_LIMITS, publicURL, resolvePublic } from './feed-http.js';
import { runLocked } from './transaction.js';

export const FEED_DESTINATIONS = Object.freeze(['faith-news','gaming-news','tech-news']);
export const feedLock = (guildId,id) => `feed:${guildId}:${id}`;
const deadline = () => {
  const {timeout}=AbortSignal;
  return timeout(FEED_LIMITS.timeout);
};
export function validateSource({id,url,destination,interval=15,threads=false}) {
  if(!/^[a-z0-9-]{1,40}$/.test(id)||!FEED_DESTINATIONS.includes(destination)
    || !Number.isInteger(interval)||interval<5||interval>1440||typeof threads!=='boolean')throw new Error('Invalid source ID, framework news destination, interval or thread setting.');
  return {id,url:publicURL(url).href,destination,interval,threads};
}

export function createFeedStore({pool,guildId,audit,validateURL=resolvePublic}) {
  const writeAudit=(db,actor,action,detail)=>audit(db,actor,action,detail);
  async function sourceLock(id,fn) {return runLocked(pool,feedLock(guildId,id),fn);}
  async function seed(config) {
    if(!Array.isArray(config)||config.length>FEED_LIMITS.sources)throw new Error('At most 25 feed drafts are permitted.');
    await runLocked(pool,`feed-config:${guildId}`,async db=>{
      for(const f of config) {
        if(!/^[a-z0-9-]{1,40}$/.test(f.id)||!FEED_DESTINATIONS.includes(f.channel)||typeof f.url!=='string'||f.url.length>2048)throw new Error('Invalid feed draft.');
        const count=(await db.query('SELECT count(*)::int AS n FROM feed_sources WHERE guild_id=$1',[guildId])).rows[0].n;
        if(count>=FEED_LIMITS.sources)break;
        // Legacy enabled flags are never evidence of Owner approval.
        await db.query(`INSERT INTO feed_sources(guild_id,feed_id,url,destination) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[guildId,f.id,f.url,f.channel]);
      }
    });
  }
  async function save(input,actor) {
    const s=validateSource(input);
    await validateURL(s.url,{signal:deadline()});
    return runLocked(pool,`feed-config:${guildId}`,async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[feedLock(guildId,s.id)]);
      const count=(await db.query('SELECT count(*)::int AS n FROM feed_sources WHERE guild_id=$1',[guildId])).rows[0].n;
      const exists=(await db.query('SELECT 1 FROM feed_sources WHERE guild_id=$1 AND feed_id=$2',[guildId,s.id])).rowCount;
      if(!exists&&count>=FEED_LIMITS.sources)throw new Error('Source limit reached (25).');
      await db.query(`INSERT INTO feed_sources(guild_id,feed_id,url,destination,interval_minutes,discussion_threads)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(guild_id,feed_id) DO UPDATE SET
       url=EXCLUDED.url,destination=EXCLUDED.destination,interval_minutes=EXCLUDED.interval_minutes,
       discussion_threads=EXCLUDED.discussion_threads,enabled=false,approved_by=NULL,approved_at=NULL,updated_at=now()`,
      [guildId,s.id,s.url,s.destination,s.interval,s.threads]);
      await writeAudit(db,actor,'feeds.source-saved',{...s,enabled:false});
    });
  }
  async function enable(id,enabled,actor) {
    return sourceLock(id,async db=>{
      const s=(await db.query('SELECT * FROM feed_sources WHERE guild_id=$1 AND feed_id=$2',[guildId,id])).rows[0];
      if(!s)throw new Error('Source not found.');
      if(enabled) {
        validateSource({id,url:s.url,destination:s.destination,interval:s.interval_minutes,threads:s.discussion_threads});
        await validateURL(s.url,{signal:deadline()});
      }
      await db.query(`UPDATE feed_sources SET enabled=$3,approved_by=CASE WHEN $3 THEN $4 ELSE approved_by END,
       approved_at=CASE WHEN $3 THEN now() ELSE approved_at END,next_poll_at=now(),updated_at=now()
       WHERE guild_id=$1 AND feed_id=$2`,[guildId,id,enabled,actor]);
      await writeAudit(db,actor,'feeds.approval',{id,enabled});
    });
  }
  async function list(id) {
    return (await pool.query('SELECT * FROM feed_sources WHERE guild_id=$1 AND ($2::text IS NULL OR feed_id=$2) ORDER BY feed_id LIMIT 25',[guildId,id??null])).rows;
  }
  async function uncertain(id,page=1) {
    return (await pool.query(`SELECT * FROM feed_deliveries WHERE guild_id=$1 AND ($2::text IS NULL OR feed_id=$2)
     AND (state IN ('sending','uncertain') OR thread_state IN ('creating','uncertain')) ORDER BY delivery_id LIMIT 5 OFFSET $3`,[guildId,id??null,(page-1)*5])).rows;
  }
  async function reserve(db,s,item,channelId) {
    const r=await db.query(`INSERT INTO feed_deliveries(guild_id,feed_id,item_id,link,title,content,channel_id,state,thread_state)
     SELECT $1,$2,$3,$4,$5,$6,$7,'sending',$8
     WHERE NOT EXISTS(SELECT 1 FROM feed_items WHERE guild_id=$1 AND feed_id=$2 AND item_id IN ($3,$4))
     ON CONFLICT DO NOTHING RETURNING *`,[guildId,s.feed_id,item.id,item.link,item.title,item.content,channelId,s.discussion_threads?'pending':'disabled']);
    return r.rows[0];
  }
  async function delivered(db,d,messageId) {
    // One SQL statement records both acknowledgment and the legacy history.
    await db.query(`WITH confirmed AS (
      UPDATE feed_deliveries SET state='delivered',message_id=$4,updated_at=now(),last_error=NULL
      WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3 RETURNING guild_id,feed_id,item_id
     ) INSERT INTO feed_items(guild_id,feed_id,item_id) SELECT guild_id,feed_id,item_id FROM confirmed ON CONFLICT DO NOTHING`,
    [guildId,d.feed_id,d.item_id,messageId]);
  }
  async function resolve(id,deliveryId,actor,{messageId,verifyMessage,skip=false}) {
    return sourceLock(id,async db=>{
      if(!/^[1-9]\d{0,18}$/.test(deliveryId??''))throw new Error('Invalid delivery receipt ID.');
      const d=(await db.query('SELECT * FROM feed_deliveries WHERE guild_id=$1 AND feed_id=$2 AND delivery_id=$3',[guildId,id,deliveryId])).rows[0];
      const threadOnly=d?.state==='delivered'&&['creating','uncertain'].includes(d.thread_state);
      if(!d||!['sending','uncertain'].includes(d.state)&&!threadOnly)throw new Error('Unconfirmed delivery not found.');
      const itemId=d.item_id;
      if(threadOnly) {
        if(!skip)throw new Error('The news post is confirmed. Use skip=true to close its uncertain thread review without creating another thread.');
        await db.query("UPDATE feed_deliveries SET thread_state='disabled',updated_at=now() WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3",[guildId,id,itemId]);
      } else if(skip) {
        await db.query("UPDATE feed_deliveries SET state='skipped',thread_state='disabled',updated_at=now() WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3",[guildId,id,itemId]);
      } else {
        if(!/^\d{17,20}$/.test(messageId??''))throw new Error('Provide the existing Smith message ID, or explicitly skip.');
        await verifyMessage(d,messageId);
        await delivered(db,d,messageId);
        // Recovery never creates a thread or sends another message.
        await db.query("UPDATE feed_deliveries SET thread_state='disabled' WHERE guild_id=$1 AND feed_id=$2 AND item_id=$3",[guildId,id,itemId]);
      }
      await writeAudit(db,actor,'feeds.delivery-reviewed',{id,itemId,messageId:messageId??null,outcome:threadOnly?'thread-review-closed':skip?'skipped':'delivered'});
    });
  }
  return {seed,save,enable,list,uncertain,reserve,delivered,resolve};
}
