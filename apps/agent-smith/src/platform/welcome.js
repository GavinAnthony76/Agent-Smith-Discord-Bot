import { createHash } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord.js';
import { TARGET_GUILD_ID } from '../config.js';
import { hasPermission } from '../permissions.js';
import { safeText } from '../ai-safety.js';
import { withPlatformCommunication } from './transport.js';
import { PlatformError } from './catalog.js';

export function welcomeRecordId(guildId, memberId, joinedAt) {
  const hex = createHash('sha256').update(`welcome:${guildId}:${memberId}:${joinedAt}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function welcomeText(template, member, guild, max = 1900) {
  const values = { user: safeText(member.displayName || member.user.username, 80),
    server: safeText(guild.name, 100), memberCount: String(guild.memberCount ?? 'unavailable') };
  return safeText(String(template ?? '').replace(/\{(user|server|memberCount)\}/g, (_, key) => values[key]), max);
}
export function welcomePayload(configuration, member, guild) {
  const c = configuration, embed = {};
  if (c.embedTitle) embed.title = welcomeText(c.embedTitle, member, guild, 256);
  if (c.description) embed.description = welcomeText(c.description, member, guild, 2000);
  if (c.imageUrl) embed.image = { url: c.imageUrl };
  const buttons = (c.buttons ?? []).map(b => ({ type: 2, style: 5, label: b.label, url: b.url }));
  if (c.roleBehavior === 'ONBOARDING') buttons.push({ type: 2, style: 1,
    custom_id: 'smith:onboarding:start', label: 'Start onboarding' });
  return { content: welcomeText(c.message || 'Welcome {user} to {server}.', member, guild),
    allowedMentions: { parse: [], repliedUser: false },
    ...(Object.keys(embed).length ? { embeds: [embed] } : {}),
    ...(buttons.length ? { components: [{ type: 1, components: buttons }] } : {}) };
}
export function createWelcomeService({ pool, discord, moduleConfig, entitlements }) {
  async function target(guildId, userId, channelId) {
    await entitlements?.requireFeature(guildId, 'welcome');
    const guild = await discord.freshGuild(guildId);
    const member = await guild.members.fetch({ user: userId, force: true });
    const channel = guild.channels.cache.get(channelId);
    if (member.user.bot || !discord.memberRolesVerified(guild, member) ||
        !discord.memberRolesVerified(guild, guild.members.me) || !channel || channel.type !== 0 ||
        !hasPermission(member, P.ViewChannel, channel) || !hasPermission(member, P.ReadMessageHistory, channel) ||
        !hasPermission(guild.members.me, P.ViewChannel, channel) ||
        !hasPermission(guild.members.me, P.SendMessages, channel)) {
      throw new PlatformError('welcome_channel_not_authorized', 403);
    }
    return { guild, member, channel };
  }
  async function join(member) {
    const guildId = member.guild.id;
    if (guildId === TARGET_GUILD_ID || member.user.bot || !member.joinedTimestamp) return { skipped: true };
    if (entitlements && !await entitlements.hasFeature(guildId, 'welcome')) return { skipped: true };
    const settings = await moduleConfig(guildId, 'welcome');
    if (!settings.enabled || !settings.configuration.channelId) return { skipped: true };
    const id = welcomeRecordId(guildId, member.id, member.joinedTimestamp);
    // One durable reservation per actual join. A failed/unknown send is held,
    // never silently retried by another event or a later restart.
    const reservation = await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
      VALUES($1,'welcome-delivery',$2,'Welcome delivery',$3,$4)
      ON CONFLICT DO NOTHING RETURNING record_id`,
      [guildId, id, { status: 'pending', channelId: settings.configuration.channelId }, member.id]);
    if (!reservation.rows.length) return { skipped: true };
    try {
      const fresh = await target(guildId, member.id, settings.configuration.channelId);
      const current = await moduleConfig(guildId, 'welcome');
      if (!current.enabled || current.revision !== settings.revision) throw new PlatformError('welcome_configuration_changed', 409);
      const onboarding = await moduleConfig(guildId, 'onboarding');
      const configuration = onboarding.enabled ?
        { ...current.configuration, roleBehavior: 'ONBOARDING' } : current.configuration;
      const result = await withPlatformCommunication({ guild: fresh.guild, userId: member.id, channelId: fresh.channel.id },
        () => fresh.channel.send({ ...welcomePayload(configuration, fresh.member, fresh.guild),
          nonce: id.replaceAll('-', '').slice(0,24), enforceNonce: true }));
      await pool.query(`UPDATE platform_records SET data=data||$3::jsonb,updated_at=now()
        WHERE guild_id=$1 AND collection='welcome-delivery' AND record_id=$2`,
        [guildId, id, { status: 'sent', messageId: result.id }]);
      return { sent: true };
    } catch (error) {
      await pool.query(`UPDATE platform_records SET data=data||'{"status":"unconfirmed"}'::jsonb,updated_at=now()
        WHERE guild_id=$1 AND collection='welcome-delivery' AND record_id=$2`, [guildId, id]);
      throw error;
    }
  }
  return { join };
}
