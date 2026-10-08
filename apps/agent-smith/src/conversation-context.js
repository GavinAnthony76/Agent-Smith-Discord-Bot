import { createHash } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord.js';
import { hasPermission } from './permissions.js';
import { isAdmin } from './authorization.js';
import { frameworks, interests } from './blueprint.js';
import { currentLevel } from './progression-policy.js';
import { rankName, faithDisclaimer } from './progression-config.js';
import { safeText } from './ai-safety.js';

/** Read-only adapter. No moderation records or credentials enter this DTO. */
export async function buildConversationContext({ guild, cfg, pool, userId, channelId, lookups }) {
  const read = (kind, operation) => lookups ? lookups.read(kind, operation) : operation();
  const query = (sql, args) => read('database', () => pool.query(sql, args));
  const member = await read('member', () => guild.members.fetch({ user: userId, force: true }));
  if (member.user.bot || member.pending !== false) throw new Error('Conversation member is not eligible.');
  const [roles, channelMap, bot] = await Promise.all([
    read('roles', () => guild.roles.fetch()), read('channels', () => guild.channels.fetch()),
    read('botMember', () => guild.members.fetchMe({ force: true })),
  ]);
  for (const actor of [member, bot]) {
    if ([...(actor.roles?.cache?.keys() ?? [])].some(id => !roles.has(id)))
      throw new Error('Conversation role listing freshness is uncertain.');
  }
  // Use the returned authoritative listing, NOT the SDK cache (which can still
  // contain deleted channels). Threads are not returned by the guild listing.
  const listed = channelMap.get(channelId);
  const channel = listed && !listed.isThread?.() ? listed :
    await read('channel', () => guild.channels.fetch(channelId, { force: true }));
  lookups?.check?.();
  if ((!listed && !channel?.isThread?.()) ||
      (channel?.isThread?.() && !channelMap.has(channel.parentId)))
    throw new Error('Conversation channel listing freshness is uncertain.');
  if (!channel || channel.guildId !== guild.id || !hasPermission(member, P.ViewChannel, channel) ||
      !hasPermission(member, P.ReadMessageHistory, channel) || !hasPermission(bot, P.ViewChannel, channel) ||
      !hasPermission(bot, channel.isThread?.() ? P.SendMessagesInThreads : P.SendMessages, channel))
    throw new Error('Conversation channel is not authorized.');
  if (channel.type === 12) {
    for (const actor of [member, bot]) {
      if (!hasPermission(actor, P.ManageThreads, channel)) {
        const joined = await read('threadMember', () => channel.members.fetch({ member: actor.id, force: true }));
        if (joined?.id !== actor.id) throw new Error('Private thread membership is required.');
      }
    }
  }
  const [resources, records, grants, balances, inventory, rewards, onboarding] = await Promise.all([
    query('SELECT kind,name,discord_id FROM resources WHERE guild_id=$1', [guild.id]),
    query('SELECT primary_framework,accepted_at FROM members WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]),
    query('SELECT framework FROM grants WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]),
    query('SELECT framework,xp,faith_approved FROM progression_balances WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]),
    query('SELECT title FROM community_inventory WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]),
    lookups?.publicRewards ?
      lookups.publicRewards(() => pool.query('SELECT title,price FROM community_shop WHERE guild_id=$1 AND enabled=true ORDER BY title LIMIT 100', [guild.id])) :
      read('rewards', () => pool.query('SELECT title,price FROM community_shop WHERE guild_id=$1 AND enabled=true ORDER BY title LIMIT 100', [guild.id])),
    query('SELECT legacy_enabled,cutover_status FROM onboarding_state WHERE guild_id=$1', [guild.id]),
  ]);
  const roleId = name => resources.rows.find(row => row.kind === 'role' && row.name === name)?.discord_id;
  const record = records.rows[0];
  const approved = frameworks.filter(framework => record?.accepted_at &&
    member.roles.cache.has(roleId('Member')) && member.roles.cache.has(roleId(framework)) &&
    (record.primary_framework === framework || grants.rows.some(row => row.framework === framework)));
  const admin = isAdmin(member, cfg, guild);
  const frameworkFor = target => {
    const parentId = target.isThread?.() ? channelMap.get(target.parentId)?.parentId : target.parentId;
    const parentName = channelMap.get(parentId)?.name?.toUpperCase();
    return frameworks.find(framework => parentName === framework.toUpperCase() ||
      resources.rows.some(row => row.kind === 'category' && row.discord_id === parentId && row.name.toUpperCase() === framework.toUpperCase()));
  };
  const visible = [...channelMap.values()].filter(target => !target.isThread?.() &&
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
  channels.sort((a, b) => a.id.localeCompare(b.id));
  const selectedInterests = Object.values(interests).flat().filter(name =>
    member.roles.cache.has(roleId(`Interest: ${name}`)));
  const progression = balances.rows.filter(row => approved.includes(row.framework)).map(row => {
    const level = currentLevel(row.framework, Number(row.xp), row.faith_approved);
    return { framework: row.framework, xp: Number(row.xp), level, rank: rankName(row.framework, level) };
  });
  let events = [];
  if (guild.scheduledEvents?.fetch) {
    try {
      const scheduled = await read('events', () => guild.scheduledEvents.fetch());
      const ids = new Set(channels.map(c => c.id));
      events = [...scheduled.values()].filter(event => !event.channelId || ids.has(event.channelId))
        .slice(0, 10).map(event => ({ name: safeText(event.name, 100), startsAt: event.scheduledStartAt?.toISOString() ?? null }));
    } catch { /* Optional event-read failure may omit events, never invent them. */ }
  }
  lookups?.check?.();
  const roleIds = [...member.roles.cache.keys()].sort();
  return {
    // Metadata changes matter too: an old topic/event can reveal information
    // even when the set of visible channel IDs has not changed.
    accessSignature: createHash('sha256').update(JSON.stringify([approved, roleIds, channels, events])).digest('hex'),
    server: { name: safeText(guild.name, 100), frameworks, events,
      rulesChannelId: channels.some(c => c.id === guild.rulesChannelId) ? guild.rulesChannelId : channels.find(c => c.name === 'rules')?.id ?? null,
      accessProcess: onboarding.rows[0]?.legacy_enabled === true ?
        'Use /accept for the current rules, then /join to choose one primary framework. Additional access requires human review through /request.' :
        'Complete Discord rules screening and choose one primary community in Channels & Roles. Additional access requires human review through /request.',
      faithDisclaimer,
      achievementTracking: false, rewards: rewards.rows.map(row => ({ title: safeText(row.title, 100), price: row.price })) },
    member: { displayName: safeText(member.displayName, 80), primaryFramework: approved.includes(record?.primary_framework) ? record.primary_framework : null,
      frameworks: approved, interests: selectedInterests,
      availableInterests: Object.values(interests).flat().filter(name => roles.has(roleId(`Interest: ${name}`))),
      cosmeticBadges: inventory.rows.map(row => safeText(row.title, 100)),
      roles: [...member.roles.cache.values()].filter(role => role.id !== guild.id).map(role => safeText(role.name, 80)),
      progression },
    channels,
  };
}
