import { Client, ClientUser, PermissionFlagsBits as P, Routes } from 'discord.js';
import { hasPermission, assertHigherRole } from '../permissions.js';
import { PROTECTED_ROLE_NAMES, assertNotOwner } from '../security-policy.js';
import { PlatformError } from './catalog.js';
import { installSecurityGateForRestOnly } from './transport.js';

/**
 * Development uses REST and SDK permission objects, never a Gateway session.
 * Production supplies its already-connected client.
 */
export function createDiscordAccess({ client, env = process.env } = {}) {
  let initializing;
  const roleSnapshots = new WeakMap();
  const ownsClient = !client;
  if (!client) client = new Client({ intents: [] });
  if (ownsClient) {
    client.rest.setToken(env.DISCORD_TOKEN);
    installSecurityGateForRestOnly(client);
  }
  async function initialize() {
    if (ownsClient && !client.user) {
      initializing ??= client.rest.get(Routes.user('@me')).then(data => { client.user = new ClientUser(client, data); });
      await initializing;
    }
  }
  async function freshGuild(guildId) {
    await initialize();
    const raw = await client.rest.get(Routes.guild(guildId));
    const guild = client.guilds._add(raw);
    const [roles] = await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.members.fetchMe({ force: true })]);
    roleSnapshots.set(guild, roles);
    return guild;
  }
  async function authority({ guildId, userId, pool }) {
    try {
      const guild = await freshGuild(guildId);
      const member = await guild.members.fetch({ user: userId, force: true });
      if (member.user.bot || member.pending !== false ||
          !memberRolesVerified(guild, member) || !memberRolesVerified(guild, guild.members.me)) return null;
      let role;
      if (guild.ownerId === userId) role = 'OWNER';
      else if (hasPermission(member, P.Administrator) || hasPermission(member, P.ManageGuild)) role = 'ADMIN';
      else role = (await pool.query(
        'SELECT dashboard_role FROM platform_managers WHERE guild_id=$1 AND user_id=$2',
        [guildId, userId])).rows[0]?.dashboard_role;
      return role ? { installed: true, member: true, role, guild, actor: member } : null;
    } catch { return null; }
  }
  function memberRolesVerified(guild, actor) {
    const roles = roleSnapshots.get(guild);
    return !!roles && !!actor && [...actor.roles.cache.keys()].every(id => roles.has(id));
  }
  function protectedRole(role, guild) {
    const me = guild.members.me;
    return role.id === guild.id || role.managed || PROTECTED_ROLE_NAMES.has(role.name) ||
      /owner|admin|moderat|security|agent smith/i.test(role.name) ||
      role.permissions.has(P.Administrator) || role.permissions.has(P.ManageGuild) ||
      role.permissions.has(P.ManageRoles) || role.permissions.has(P.BanMembers) ||
      role.permissions.has(P.KickMembers) || role.permissions.has(P.ModerateMembers) ||
      role.permissions.has(P.ManageChannels) || !me || role.position >= me.roles.highest.position;
  }
  function assertRewardRole(role, guild, actor) {
    if (!role || protectedRole(role, guild)) throw new PlatformError('protected_or_unmanageable_reward_role');
    if (actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) throw new PlatformError('role_above_actor');
  }
  async function assertTarget(guild, actor, targetId, cfg) {
    assertNotOwner(guild, targetId, cfg);
    const target = await guild.members.fetch({ user: targetId, force: true });
    assertHigherRole(actor, target, guild.ownerId);
    assertHigherRole(guild.members.me, target, guild.ownerId);
    return target;
  }
  return { client, freshGuild, authority, memberRolesVerified, protectedRole, assertRewardRole, assertTarget,
    close() { if (ownsClient) client.destroy(); } };
}
