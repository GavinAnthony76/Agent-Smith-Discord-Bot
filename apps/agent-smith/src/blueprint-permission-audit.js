import { ChannelType, OverwriteType, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { TARGET_GUILD_ID } from './config.js';

// Owner approved retaining this observed restriction, not editing Discord or
// relaxing the blueprint on any other channel/principal/permission.
export const communityHelpRestriction = Object.freeze({
  guildId: TARGET_GUILD_ID,
  channelId: '1556432961044484127',
  parentId: '1556432959244869804',
  memberRoleId: '1556432550119866469'
});

export function compareBlueprintPermissions({ guild, channel, expected, botId, rows }) {
  const policy = communityHelpRestriction;
  const tracked = (kind, name, id) => rows.some(row =>
    row.kind === kind && row.name === name && row.discord_id === id);
  const approvedIdentity = guild.id === policy.guildId
    && channel.id === policy.channelId && channel.name === 'community-help'
    && channel.type === ChannelType.GuildForum && channel.parentId === policy.parentId
    && tracked('channel', 'community-help', policy.channelId)
    && tracked('channel', 'SHARED HUB', policy.parentId)
    && tracked('role', 'Member', policy.memberRoleId)
    && guild.roles.cache.get(policy.memberRoleId)?.name === 'Member'
    && expected.some(entry => entry.id === policy.memberRoleId && entry.type === OverwriteType.Role);
  let preservedRestriction = false;
  const norm = (entries, live = false) => entries.map(entry => {
    let allow = new PermissionsBitField(entry.allow).bitfield;
    let deny = new PermissionsBitField(entry.deny).bitfield;
    // Preserve the existing audit treatment of Owner-installed Manage
    // Permissions on Smith; no such exception applies to other principals.
    if (entry.id === botId) allow &= ~P.ManageRoles;
    if (live && approvedIdentity && entry.id === guild.id && entry.type === OverwriteType.Role
      && allow === 0n && deny === (P.ViewChannel | P.SendMessages)
      && expected.some(x => x.id === guild.id && x.type === OverwriteType.Role
        && new PermissionsBitField(x.allow).bitfield === 0n
        && new PermissionsBitField(x.deny).bitfield === P.ViewChannel)) {
      deny &= ~P.SendMessages;
      preservedRestriction = true;
    }
    return `${entry.id}:${entry.type}:${allow}:${deny}`;
  }).sort().join('|');
  const matches = norm([...channel.permissionOverwrites.cache.values()], true) === norm(expected);
  return {
    matches,
    reviewed: matches && preservedRestriction
      ? `Owner-approved restriction: community-help (${policy.channelId}); @everyone additionally denied SendMessages; all other overwrites match the blueprint.`
      : null
  };
}
