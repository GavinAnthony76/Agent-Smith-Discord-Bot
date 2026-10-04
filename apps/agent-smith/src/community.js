import { ChannelType, PermissionFlagsBits as P } from 'discord.js';

export function starterChannels(guild) {
  const expected = new Map([
    ['Text Channels', ChannelType.GuildCategory], ['Voice Channels', ChannelType.GuildCategory],
    ['general', ChannelType.GuildText], ['General', ChannelType.GuildVoice]
  ]);
  const channels = [...guild.channels.cache.values()].filter(c => expected.has(c.name));
  if (new Set(channels.map(c => c.name)).size !== channels.length ||
      channels.some(c => c.type !== expected.get(c.name))) {
    throw new Error('Unexpected default starter channel identity/type; review required.');
  }
  return channels;
}

// Only the channels designated by Discord's Community settings may be adopted.
export function communityChannels(guild, cfg, botId) {
  if (!guild.features.includes('COMMUNITY')) throw new Error('Enable Community first; forums require it.');
  const rules = guild.channels.cache.get(guild.rulesChannelId);
  const updates = guild.channels.cache.get(guild.publicUpdatesChannelId);
  if (!rules || rules.name !== 'rules' || rules.type !== ChannelType.GuildText) {
    throw new Error('Community Rules channel must be the existing text channel named rules.');
  }
  if ([...guild.channels.cache.values()].filter(c => c.name === 'rules').length !== 1) {
    throw new Error('Multiple rules channels found; adoption refused.');
  }
  if (!updates || updates.name !== 'moderator-only' || updates.type !== ChannelType.GuildText || updates.id === rules.id) {
    throw new Error('Community Updates channel must be the existing moderator-only text channel.');
  }
  if (updates.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel) !== false) {
    throw new Error('Community Updates channel is not private from everyone; setup refused.');
  }
  const staff = new Set([...cfg.owners, ...cfg.approvers, botId]);
  for (const entry of updates.permissionOverwrites.cache.values()) {
    if (!entry.allow.has(P.ViewChannel)) continue;
    const role = guild.roles.cache.get(entry.id);
    if (!staff.has(entry.id) && !role?.managed) {
      throw new Error('Community Updates channel grants visibility outside configured staff; setup refused.');
    }
  }
  return { rules, updates };
}