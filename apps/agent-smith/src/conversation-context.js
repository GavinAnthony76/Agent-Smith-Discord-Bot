import { createHash } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord.js';
import { hasPermission } from './permissions.js';
import { isAdmin } from './authorization.js';
import { frameworks, interests } from './blueprint.js';
import { currentLevel } from './progression-policy.js';
import { rankName, faithDisclaimer } from './progression-config.js';
import { safeText } from './ai-safety.js';

/** Read-only adapter. No moderation records or credentials enter this DTO. */
export async function buildConversationContext({ guild, cfg, pool, userId, channelId }) {
  const member = await guild.members.fetch({ user: userId, force: true });
  if (member.user.bot || member.pending !== false) throw new Error('Conversation member is not eligible.');
  await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId);
  const bot = guild.members.me;
  if (!channel || channel.guildId !== guild.id || !hasPermission(member, P.ViewChannel, channel) ||
      !hasPermission(member, P.ReadMessageHistory, channel) || !hasPermission(bot, P.ViewChannel, channel))
    throw new Error('Conversation channel is not authorized.');
  if (channel.type === 12) {
    for (const actor of [member, bot]) {
      if (!hasPermission(actor, P.ManageThreads, channel)) {
        const joined = await channel.members.fetch(actor.id);
        if (joined?.id !== actor.id) throw new Error('Private thread membership is required.');
      }
    }
  }
  const [resources, records, grants, balances, inventory, rewards, onboarding] = await Promise.all([
    pool.query('SELECT kind,name,discord_id FROM resources WHERE guild_id=$1', [guild.id]),
    pool.query('SELECT primary_framework,accepted_at FROM members WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]),
    pool.query('SELECT framework FROM grants WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]),
    pool.query('SELECT framework,xp,faith_approved FROM progression_balances WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]),
    pool.query('SELECT title FROM community_inventory WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]),
    pool.query('SELECT title,price FROM community_shop WHERE guild_id=$1 AND enabled=true', [guild.id]),
    pool.query('SELECT legacy_enabled,cutover_status FROM onboarding_state WHERE guild_id=$1', [guild.id]),
  ]);
  const roleId = name => resources.rows.find(row => row.kind === 'role' && row.name === name)?.discord_id;
  const record = records.rows[0];
  const approved = frameworks.filter(framework => record?.accepted_at &&
    member.roles.cache.has(roleId('Member')) && member.roles.cache.has(roleId(framework)) &&
    (record.primary_framework === framework || grants.rows.some(row => row.framework === framework)));
  const admin = isAdmin(member, cfg, guild);
  const frameworkFor = target => {
    const parentId = target.isThread?.() ? target.parent?.parentId : target.parentId;
    const parentName = guild.channels.cache.get(parentId)?.name?.toUpperCase();
    return frameworks.find(framework => parentName === framework.toUpperCase() ||
      resources.rows.some(row => row.kind === 'category' && row.discord_id === parentId && row.name.toUpperCase() === framework.toUpperCase()));
  };
  const visible = [...guild.channels.cache.values()].filter(target => !target.isThread?.() &&
    hasPermission(member, P.ViewChannel, target) && hasPermission(bot, P.ViewChannel, target) &&
    (!frameworkFor(target) || admin || approved.includes(frameworkFor(target))));
  const channels = visible.map(target => ({
    id: target.id, name: safeText(target.name, 100), topic: safeText(target.topic, 500),
    type: target.type, framework: frameworkFor(target) ?? null,
    tags: (target.availableTags ?? []).map(tag => safeText(tag.name, 80)),
  }));
  // Include a current authorized thread without enumerating other private threads.
  if (channel.isThread?.() && !channels.some(c => c.id === channel.id)) {
    if (frameworkFor(channel) && !admin && !approved.includes(frameworkFor(channel))) throw new Error('Framework access is not approved.');
    channels.push({ id: channel.id, name: safeText(channel.name, 100), topic: '', type: channel.type, framework: frameworkFor(channel) ?? null, tags: [] });
  } else if (frameworkFor(channel) && !admin && !approved.includes(frameworkFor(channel))) {
    throw new Error('Framework access is not approved.');
  }
  const selectedInterests = Object.values(interests).flat().filter(name =>
    member.roles.cache.has(roleId(`Interest: ${name}`)));
  const progression = balances.rows.filter(row => approved.includes(row.framework)).map(row => {
    const level = currentLevel(row.framework, Number(row.xp), row.faith_approved);
    return { framework: row.framework, xp: Number(row.xp), level, rank: rankName(row.framework, level) };
  });
  let events = [];
  if (guild.scheduledEvents?.fetch) {
    try {
      const scheduled = await guild.scheduledEvents.fetch();
      const ids = new Set(channels.map(c => c.id));
      events = [...scheduled.values()].filter(event => !event.channelId || ids.has(event.channelId))
        .slice(0, 10).map(event => ({ name: safeText(event.name, 100), startsAt: event.scheduledStartAt?.toISOString() ?? null }));
    } catch { /* Missing event permissions do not create fictitious events. */ }
  }
  const roleIds = [...member.roles.cache.keys()].sort();
  return {
    accessSignature: createHash('sha256').update(JSON.stringify([approved, roleIds, channels.map(c => c.id).sort()])).digest('hex'),
    server: { name: safeText(guild.name, 100), frameworks, events,
      rulesChannelId: channels.some(c => c.id === guild.rulesChannelId) ? guild.rulesChannelId : channels.find(c => c.name === 'rules')?.id ?? null,
      accessProcess: onboarding.rows[0]?.legacy_enabled === true ?
        'Use /accept for the current rules, then /join to choose one primary framework. Additional access requires human review through /request.' :
        'Complete Discord rules screening and choose one primary community in Channels & Roles. Additional access requires human review through /request.',
      faithDisclaimer,
      achievementTracking: false, rewards: rewards.rows.map(row => ({ title: safeText(row.title, 100), price: row.price })) },
    member: { displayName: safeText(member.displayName, 80), primaryFramework: approved.includes(record?.primary_framework) ? record.primary_framework : null,
      frameworks: approved, interests: selectedInterests,
      availableInterests: Object.values(interests).flat().filter(name => guild.roles.cache.has(roleId(`Interest: ${name}`))),
      cosmeticBadges: inventory.rows.map(row => safeText(row.title, 100)),
      roles: [...member.roles.cache.values()].filter(role => role.id !== guild.id).map(role => safeText(role.name, 80)),
      progression },
    channels,
  };
}
