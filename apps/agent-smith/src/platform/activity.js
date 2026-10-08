import { createHash } from 'node:crypto';
import { TARGET_GUILD_ID } from '../config.js';

export function calculateLevel(xp, thresholds) {
  if (!Array.isArray(thresholds)) return 1;
  return Math.max(1, thresholds.filter(value => Number.isSafeInteger(value) && xp >= value).length);
}
export function eligibleText(message, config, now = Date.now()) {
  if (message.guildId === TARGET_GUILD_ID || message.author.bot || message.webhookId ||
      !config.textEnabled || !message.content || message.content.trim().length < 10 ||
      message.content.startsWith('/') || /^https?:\/\/\S+$/.test(message.content.trim()) ||
      message.createdTimestamp < now - 120000 || message.createdTimestamp > now + 10000) return false;
  if (config.excludedChannels?.includes(message.channelId)) return false;
  return !config.eligibleChannels?.length || config.eligibleChannels.includes(message.channelId);
}
export function createActivityService(pool) {
  async function awardText(message, config) {
    if (!eligibleText(message, config)) return false;
    const id = message.guildId, userId = message.author.id;
    const fingerprint = createHash('sha256').update(`${id}:${userId}:${message.content.trim().toLowerCase()}`).digest('hex');
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('INSERT INTO platform_member_profiles(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, userId]);
      const profile = (await db.query(
        'SELECT xp,last_message_hash FROM platform_member_profiles WHERE guild_id=$1 AND user_id=$2 FOR UPDATE', [id, userId])).rows[0];
      const today = (await db.query(
        `SELECT COALESCE(sum(amount),0) AS total,max(created_at) AS last
         FROM platform_xp_events WHERE guild_id=$1 AND user_id=$2 AND created_at>=date_trunc('day',now())`,
        [id, userId])).rows[0];
      if (profile.last_message_hash === fingerprint ||
          today.last && Date.now() - new Date(today.last).getTime() < config.cooldownSeconds * 1000) {
        await db.query('COMMIT'); return false;
      }
      const amount = Math.max(0, Math.min(config.textAmount, config.dailyCap - Number(today.total)));
      if (!amount) { await db.query('COMMIT'); return false; }
      const inserted = await db.query(
        `INSERT INTO platform_xp_events(guild_id,user_id,event_id,source,amount) VALUES($1,$2,$3,'text',$4) ON CONFLICT DO NOTHING RETURNING event_id`,
        [id, userId, message.id, amount]);
      if (!inserted.rows.length) { await db.query('COMMIT'); return false; }
      await db.query(
        'UPDATE platform_member_profiles SET xp=xp+$3,last_message_hash=$4,updated_at=now() WHERE guild_id=$1 AND user_id=$2',
        [id, userId, amount, fingerprint]);
      await db.query('COMMIT');
      return true;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  return { awardText };
}
