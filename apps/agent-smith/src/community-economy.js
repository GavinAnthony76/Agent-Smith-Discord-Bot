import { localDay } from './progression-policy.js';
export function createEconomy({guild,pool,locked,audit}) {
 async function enabled(db,uid) {
  if((await db.query("SELECT value FROM bot_settings WHERE guild_id=$1 AND key='economy-enabled'",[guild.id])).rows[0]?.value!==true)
   throw new Error('Optional community economy is disabled.');
  const r=(await db.query('SELECT onboarding_status,left_at FROM members WHERE guild_id=$1 AND user_id=$2',[guild.id,uid])).rows[0];
  if(r?.onboarding_status!=='ACTIVE'||r.left_at)throw new Error('Active onboarded membership required.');
 }
 async function transact(uid,key,fn) {
  return locked(`${guild.id}:${uid}`,async db=>{
   await enabled(db,uid);
   await db.query('INSERT INTO community_wallets(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[guild.id,uid]);
   if((await db.query('SELECT 1 FROM community_transactions WHERE guild_id=$1 AND user_id=$2 AND event_key=$3',[guild.id,uid,key])).rowCount)return 'Already processed; balance unchanged.';
   return fn(db);
  });
 }
 return {
  async read(uid,kind) {
   await enabled(pool,uid);
   if(kind==='balance')return `Community credits: ${(await pool.query('SELECT balance FROM community_wallets WHERE guild_id=$1 AND user_id=$2',[guild.id,uid])).rows[0]?.balance??0}`;
   const r=kind==='shop'?await pool.query('SELECT item_id,title,price FROM community_shop WHERE guild_id=$1 AND enabled ORDER BY item_id LIMIT 25',[guild.id])
    :await pool.query('SELECT item_id,title FROM community_inventory WHERE guild_id=$1 AND user_id=$2 ORDER BY item_id LIMIT 25',[guild.id,uid]);
   return r.rows.map(i=>`${i.item_id}: ${i.title}${i.price?` — ${i.price} credits`:''}`).join('\n')||'No cosmetic badges configured/owned. Currency never buys framework or staff access.';
  },
  daily(uid,now=new Date()) {
   const key=`daily:${localDay(now,'America/Chicago')}`;
   return transact(uid,key,async db=>{
    const r=await db.query('UPDATE community_wallets SET balance=balance+10 WHERE guild_id=$1 AND user_id=$2 AND balance<=1000000000 RETURNING balance',[guild.id,uid]);
    if(!r.rowCount)throw new Error('Balance limit reached.');
    await db.query('INSERT INTO community_transactions(guild_id,user_id,event_key,amount) VALUES($1,$2,$3,10)',[guild.id,uid,key]);
    await audit(db,uid,'economy-daily',{key,amount:10});
    return `Daily reward: 10 credits. Balance: ${r.rows[0].balance}. One claim per America/Chicago calendar day.`;
   });
  },
  buy(uid,item,eventId) {
   if(!/^[a-z0-9-]{1,40}$/.test(item)||!/^\d{17,20}$/.test(eventId))throw new Error('Invalid item or event ID.');
   return transact(uid,`buy:${eventId}`,async db=>{
    const product=(await db.query('SELECT * FROM community_shop WHERE guild_id=$1 AND item_id=$2 AND enabled FOR SHARE',[guild.id,item])).rows[0];
    if(!product)throw new Error('Item unavailable.');
    if((await db.query('SELECT 1 FROM community_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3',[guild.id,uid,item])).rowCount)throw new Error('You already own this badge.');
    const paid=await db.query('UPDATE community_wallets SET balance=balance-$3 WHERE guild_id=$1 AND user_id=$2 AND balance>=$3 RETURNING balance',[guild.id,uid,product.price]);
    if(!paid.rowCount)throw new Error('Not enough credits.');
    await db.query('INSERT INTO community_inventory(guild_id,user_id,item_id,title) VALUES($1,$2,$3,$4)',[guild.id,uid,item,product.title]);
    await db.query('INSERT INTO community_transactions(guild_id,user_id,event_key,amount) VALUES($1,$2,$3,$4)',[guild.id,uid,`buy:${eventId}`,-product.price]);
    await audit(db,uid,'economy-purchase',{item,price:product.price,eventId});
    return `Cosmetic profile badge ${product.title} purchased. Balance: ${paid.rows[0].balance}. No Discord security role was granted.`;
   });
  }
 };
}
