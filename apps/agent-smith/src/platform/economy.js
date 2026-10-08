import { PlatformError } from './catalog.js';
import { TARGET_GUILD_ID } from '../config.js';

export function createEconomyService({ pool, moduleConfig, onWalletLocked }) {
  async function settings(guildId) {
    if (guildId === TARGET_GUILD_ID) throw new PlatformError('existing_economy_service_retained', 409);
    const c = await moduleConfig(guildId, 'economy');
    if (!c.enabled) throw new PlatformError('economy_disabled', 409);
    return c.configuration;
  }
  async function wallet(guildId, userId) {
    const c = await settings(guildId);
    const row = (await pool.query(`SELECT data FROM platform_records WHERE guild_id=$1
      AND collection='economy-wallet' AND record_id=$2`, [guildId,userId])).rows[0];
    return { currencyName: c.currencyName, balance: row?.data.balance ?? 0,
      inventory: row?.data.inventory ?? [], noRealMoneyValue: true };
  }
  async function shop(guildId) {
    const c = await settings(guildId);
    return (await pool.query(`SELECT record_id,title,data FROM platform_records WHERE guild_id=$1
      AND collection='shop' AND data->>'enabled'='true' ORDER BY title LIMIT 100`,[guildId])).rows
      .map(row=>({id:row.record_id,title:row.title,price:row.data.price,currencyName:c.currencyName}));
  }
  async function change({ guildId, userId, interactionId, kind, itemId, expectedPrice }) {
    if (!['daily','buy'].includes(kind) || !/^\d{17,20}$/.test(interactionId))
      throw new PlatformError('invalid_economy_operation');
    const c = await settings(guildId), db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`economy:${guildId}:${userId}`]);
      if(onWalletLocked)await onWalletLocked();
      const duplicate=(await db.query(`SELECT data FROM platform_records WHERE guild_id=$1
        AND collection='economy-operation' AND record_id=$2`,[guildId,interactionId])).rows[0];
      if(duplicate){
        if(duplicate.data.userId!==userId||duplicate.data.kind!==kind||
          kind==='buy'&&duplicate.data.itemId!==itemId)throw new PlatformError('economy_operation_mismatch',409);
        await db.query('COMMIT');return{...duplicate.data,replayed:true};
      }
      const current=(await db.query(`SELECT data FROM platform_records WHERE guild_id=$1
        AND collection='economy-wallet' AND record_id=$2 FOR UPDATE`,[guildId,userId])).rows[0]?.data ??
        {balance:0,inventory:[],dailyClaimedAt:null};
      const now=(await db.query('SELECT now() AS now')).rows[0].now;
      const data={...current,inventory:[...current.inventory]};
      let amount;
      if(kind==='daily'){
        const availableAt=current.dailyClaimedAt?new Date(current.dailyClaimedAt).getTime()+c.cooldownHours*3600000:0;
        if(new Date(now).getTime()<availableAt)throw new PlatformError('daily_cooldown_active',409);
        amount=c.dailyAmount;data.balance+=amount;data.dailyClaimedAt=new Date(now).toISOString();
      }else{
        const item=(await db.query(`SELECT record_id,title,data FROM platform_records WHERE guild_id=$1
          AND collection='shop' AND record_id=$2 AND data->>'enabled'='true' FOR SHARE`,[guildId,itemId])).rows[0];
        if(!item||!Number.isSafeInteger(item.data.price)||item.data.price<1)throw new PlatformError('shop_item_unavailable',409);
        if(expectedPrice!==item.data.price)throw new PlatformError('shop_price_changed_review_again',409);
        if(data.balance<item.data.price)throw new PlatformError('insufficient_community_credits',409);
        if(c.inventoryBehavior==='UNIQUE'&&data.inventory.some(row=>row.itemId===itemId))
          throw new PlatformError('item_already_owned',409);
        if(data.inventory.length>=1000)throw new PlatformError('inventory_capacity_reached',409);
        amount=-item.data.price;data.balance+=amount;
        data.inventory.push({itemId,title:item.title,acquiredAt:new Date(now).toISOString()});
      }
      if(!Number.isSafeInteger(data.balance)||data.balance<0)throw new PlatformError('economy_balance_limit',409);
      const result={userId,kind,amount,balance:data.balance,currencyName:c.currencyName,noRealMoneyValue:true,
        ...(kind==='buy'?{itemId}:{})};
      await db.query(`INSERT INTO platform_member_profiles(guild_id,user_id) VALUES($1,$2)
        ON CONFLICT DO NOTHING`,[guildId,userId]);
      await db.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
        VALUES($1,'economy-wallet',$2,'Cosmetic community wallet',$3,$2)
        ON CONFLICT(guild_id,collection,record_id) DO UPDATE SET data=EXCLUDED.data,revision=platform_records.revision+1,updated_at=now()`,
        [guildId,userId,data]);
      await db.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
        VALUES($1,'economy-operation',$2,'Cosmetic economy transaction',$3,$4)`,[guildId,interactionId,result,userId]);
      await db.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,$3,'economy',$4)`,[guildId,userId,`economy.${kind}`,result]);
      await db.query('COMMIT');return result;
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  return{wallet,shop,change};
}
