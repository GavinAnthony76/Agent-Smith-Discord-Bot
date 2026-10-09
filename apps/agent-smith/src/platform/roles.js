import { PermissionFlagsBits as P, Routes } from 'discord.js';
import { PlatformError } from './catalog.js';
import { TARGET_GUILD_ID } from '../config.js';
import { hasPermission, assertHigherRole } from '../permissions.js';
import { withSelfRoleWrite } from './role-write.js';

const cosmetic = P.ViewChannel | P.ReadMessageHistory | P.SendMessages | P.AttachFiles | P.EmbedLinks |
  P.AddReactions | P.UseApplicationCommands | P.Connect | P.Speak | P.UseExternalEmojis | P.UseExternalStickers;
export function assertSelfRoleSafe(role, guild, protectedIds = []) {
  if (!role || protectedIds.includes(role.id) || role.id === guild.id || role.managed ||
      /owner|admin|moderat|security|agent smith/i.test(role.name) ||
      (role.permissions.bitfield & ~cosmetic) !== 0n || role.position >= guild.members.me.roles.highest.position) {
    throw new PlatformError('self_role_not_safe', 403);
  }
  for (const channel of guild.channels.cache.values()) {
    const everyone = channel.permissionOverwrites?.cache.get(guild.id), grant = channel.permissionOverwrites?.cache.get(role.id);
    if (grant?.allow.has(P.ViewChannel) && everyone?.deny.has(P.ViewChannel)) {
      throw new PlatformError('self_role_private_access_requires_review', 403);
    }
  }
}
export function createSelfRoleService({ client, pool, discord, moduleConfig, entitlements }) {
  async function assign({ guildId, memberId, roleId, operation = 'add' }) {
    if (!['add', 'remove'].includes(operation)) throw new PlatformError('invalid_cosmetic_role_operation');
    if (guildId === TARGET_GUILD_ID) throw new PlatformError('native_role_policy_retained', 409);
    async function validate() {
      // Member-requested cleanup remains possible; a downgrade never strips rewards.
      if (operation === 'add') await entitlements?.requireFeature(guildId, 'roles');
      const settings = await moduleConfig(guildId, 'roles');
      if (!settings.enabled || !settings.configuration.selfAssignableRoles?.includes(roleId))
        throw new PlatformError('role_not_self_assignable', 403);
      const guild = await discord.freshGuild(guildId), member = await guild.members.fetch({ user: memberId, force: true });
      if (member.pending !== false || member.user.bot || memberId === guild.ownerId ||
          !discord.memberRolesVerified(guild, member) || !discord.memberRolesVerified(guild, guild.members.me))
        throw new PlatformError('self_role_member_not_eligible', 403);
      if (!hasPermission(guild.members.me, P.ManageRoles) || hasPermission(guild.members.me, P.Administrator))
        throw new PlatformError('self_role_bot_permissions_invalid', 403);
      assertHigherRole(guild.members.me, member, guild.ownerId);
      assertSelfRoleSafe(guild.roles.cache.get(roleId), guild, settings.configuration.protectedRoles);
      return { guild, member };
    }
    const { member } = await validate();
    if (operation === 'add' && member.roles.cache.has(roleId)) return { alreadyAssigned: true };
    if (operation === 'remove' && !member.roles.cache.has(roleId)) return { alreadyRemoved: true };
    return withSelfRoleWrite({ client, guildId, memberId, roleId, operation, validate,
      record: (action, data) => pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,$3,'roles',$4)`, [guildId, memberId, action, data]) },
    () => operation === 'remove' ? client.rest.delete(Routes.guildMemberRole(guildId, memberId, roleId), { body: {} }) :
      client.rest.put(Routes.guildMemberRole(guildId, memberId, roleId), { body: {} }));
  }
  return { assign };
}
