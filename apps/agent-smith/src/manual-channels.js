import { ChannelType, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { TARGET_GUILD_ID } from './config.js';

// Owner-approved manual resources are policy, not blueprint provisioning targets.
// Never discover approval by name, system-message destination, or parent category.
export const approvedManualChannels = Object.freeze([
  Object.freeze({
    guildId: TARGET_GUILD_ID,
    channelId: '1557008515401392319',
    label: 'bot-spam',
    type: ChannelType.GuildText,
    roleId: '1556432550119866469',
    roleName: 'Member',
    allow: new PermissionsBitField([
      P.AddReactions, P.ViewChannel, P.SendMessages, P.ReadMessageHistory,
      P.Connect, P.Speak, P.UseApplicationCommands, P.CreatePublicThreads,
      P.SendMessagesInThreads
    ]).bitfield,
    // Existing Smith overwrite observed read-only; this does not authorize
    // adding any permission or bypass the structural-write security gate.
    botAllow: new PermissionsBitField([
      P.ManageChannels, P.ManageThreads, P.AddReactions, P.ViewChannel,
      P.SendMessages, P.ReadMessageHistory, P.Connect, P.Speak,
      P.UseApplicationCommands, P.CreatePublicThreads, P.SendMessagesInThreads
    ]).bitfield,
    deny: new PermissionsBitField([
      P.AddReactions, P.ViewChannel, P.SendMessages, P.ReadMessageHistory,
      P.Connect, P.Speak, P.UseApplicationCommands, P.CreatePublicThreads,
      P.CreatePrivateThreads, P.SendMessagesInThreads
    ]).bitfield
  })
]);

export function manualChannelPolicy(guild, channel) {
  return approvedManualChannels.find(policy =>
    policy.guildId === guild.id && policy.channelId === channel.id);
}

export function permitsManualRoleOverwrite(policy, channel, role, overwrite) {
  return channel.type === policy.type && role.id === policy.roleId
    && role.name === policy.roleName && overwrite.type === 0
    && (overwrite.allow.bitfield & ~policy.allow) === 0n
    && (overwrite.deny.bitfield & ~policy.deny) === 0n;
}

export function auditManualChannels(guild, cfg = {}) {
  const reviewed = [], failures = [];
  for (const policy of approvedManualChannels.filter(p => p.guildId === guild.id)) {
    const channel = guild.channels.cache.get(policy.channelId);
    const role = guild.roles.cache.get(policy.roleId);
    reviewed.push(`Owner-approved manual channel: ${policy.label} (${policy.channelId}); bounded Member communication, stricter visibility allowed; not a blueprint target.`);
    if (!channel || channel.type !== policy.type || role?.name !== policy.roleName) {
      failures.push(`Approved manual channel identity/type or Member role drift: ${policy.label}`);
      continue;
    }
    const overwrite = channel.permissionOverwrites.cache.get(role.id);
    if (overwrite && !permitsManualRoleOverwrite(policy, channel, role, overwrite)) {
      failures.push(`Approved manual channel exceeds Member communication bounds: ${policy.label}`);
    }
    for (const entry of channel.permissionOverwrites.cache.values()) {
      // Match all reviewed principals by ID and type, not role names.
      if (entry.id === policy.roleId) continue; // Validated above.
      const isEveryone = entry.id === guild.id && entry.type === 0;
      const isSmith = entry.id === cfg.clientId && entry.type === 1;
      const allowed = isSmith ? policy.botAllow : 0n;
      if ((!isEveryone && !isSmith)
        || (entry.allow.bitfield & ~allowed) !== 0n
        || (entry.deny.bitfield & ~policy.deny) !== 0n) {
        failures.push(`Unapproved overwrite principal or permissions on manual channel: ${policy.label}`);
      }
    }
    if (channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel) !== false) {
      failures.push(`Approved private manual channel exposes @everyone: ${policy.label}`);
    }
  }
  return { reviewed, failures };
}
