import { PermissionFlagsBits as P } from 'discord.js';

export class SpamDetector {
  constructor({ now = Date.now } = {}) { this.now = now; this.entries = new Map(); }
  observe(message) {
    const now = this.now();
    for (const [key, entry] of this.entries) if (now - entry.last > 60000) this.entries.delete(key);
    const key = `${message.guildId}:${message.author.id}`;
    if (!this.entries.has(key) && this.entries.size >= 5000) this.entries.delete(this.entries.keys().next().value);
    const entry = this.entries.get(key) ?? { times: [], alerted: -Infinity, last: now };
    entry.times = entry.times.filter(time => now - time < 30000);
    entry.times.push(now); entry.last = now; this.entries.set(key, entry);
    const burst = entry.times.filter(time => now - time < 10000).length;
    const reasons = [];
    if (burst >= 6) reasons.push(`${burst} messages in 10 seconds`);
    if (entry.times.length >= 12) reasons.push(`${entry.times.length} messages in 30 seconds`);
    if (message.mentions?.everyone || (message.mentions?.users?.size ?? 0) >= 5) reasons.push('Mass mention');
    if (!reasons.length || now - entry.alerted < 60000) return null;
    entry.alerted = now;
    return { reasons, burst, thirtySeconds: entry.times.length };
  }
}

export async function createAntiSpam({ guild, cfg, pool, resource }) {
  const previous = await pool.query(
    "SELECT detail FROM audit WHERE guild_id=$1 AND action='mod.spam-config' ORDER BY id DESC LIMIT 1", [guild.id]);
  let enabled = previous.rows[0]?.detail?.enabled ?? true;
  const detector = new SpamDetector();
  return {
    status: () => ({ enabled, mode: 'alerts-only', burstThreshold: '6 messages / 10 seconds',
      sustainedThreshold: '12 messages / 30 seconds', mentionThreshold: '5 users or @everyone', cooldown: '60 seconds per member',
      contentScanning: false }),
    setEnabled: value => { enabled = value; detector.entries.clear(); },
    async handleMessage(message) {
      if (!enabled || message.guildId !== guild.id || message.author.bot || message.webhookId
        || cfg.owners.includes(message.author.id)) return;
      // Count activity and mention metadata, not content. No Message Content intent is needed.
      const alert = detector.observe(message);
      if (!alert) return;
      const result = await pool.query(
        'INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4) RETURNING id',
        [guild.id, cfg.clientId, 'mod.spam-alert', JSON.stringify({
          target: message.author.id, channel: message.channelId, message: message.id, mode: 'alerts-only', ...alert
        })]);
      const channel = await guild.channels.fetch(await resource('channel', 'feed-status'));
      if (channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) {
        throw new Error('Anti-spam alert channel is public; alert delivery refused. See the database audit record.');
      }
      await channel.send({
        content: `**Spam alert — case #${result.rows[0].id}**\nMember <@${message.author.id}> in <#${message.channelId}>: ${alert.reasons.join('; ')}.\nhttps://discord.com/channels/${guild.id}/${message.channelId}/${message.id}\nAlerts only: no messages deleted and no access or timeout changed.`,
        allowedMentions: { parse: [] }
      });
    }
  };
}