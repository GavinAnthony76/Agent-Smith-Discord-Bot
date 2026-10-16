import { Client, ClientUser, PermissionFlagsBits as P, Routes } from 'discord.js';
import { hasPermission, assertHigherRole } from '../permissions.js';
import { PROTECTED_ROLE_NAMES, assertNotOwner } from '../security-policy.js';
import { PlatformError } from './catalog.js';
import { installSecurityGateForRestOnly } from './transport.js';
import { measureDependency } from './diagnostics.js';

const instrumented=new WeakSet();

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
  if(typeof client.rest.request==='function' && !instrumented.has(client)) {
    const original=client.rest.request.bind(client.rest);
    client.rest.request=request=>measureDependency('discord',()=>original(request));
    instrumented.add(client);
  }
  const authorityReads=new Map(),guildReads=new Map();
  function coalesce(map,key,fn) {
    if(map.has(key)) return map.get(key);
    const pending=Promise.resolve().then(fn).finally(()=>map.delete(key));
    map.set(key,pending);
    return pending;
  }
  async function initialize() {
    if (ownsClient && !client.user) {
      initializing ??= client.rest.get(Routes.user('@me')).then(data => { client.user = new ClientUser(client, data); });
      await initializing;
    }
  }
  async function readGuild(guildId,channels) {
    await initialize();
    const raw = await client.rest.get(Routes.guild(guildId));
    const guild = client.guilds._add(raw);
    // GET guild already contains the current role definitions. The SDK patches
    // those objects but can retain removed entries in its cache, so bind role
    // identity verification to the response itself, not to that cache.
    const returnedRoles=Array.isArray(raw.roles)?
      new Map(raw.roles.map(role=>[role.id,guild.roles.cache.get(role.id)])):null;
    const [roles] = await Promise.all([returnedRoles??guild.roles.fetch(), channels?guild.channels.fetch():undefined,
      guild.members.fetchMe({ force: true })]);
    roleSnapshots.set(guild, roles);
    return guild;
  }
  const freshGuild=guildId=>readGuild(guildId,true);
  async function resolveAuthority({ guildId, userId, pool, write=false }) {
    try {
      // Share only concurrent reads, not time-based authorization snapshots.
      // Mutations always perform their own fresh authority/channel checks.
      const guild = write?await freshGuild(guildId):
        await coalesce(guildReads,guildId,()=>readGuild(guildId,false));
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
    } catch(error) {
      if([10004,10007,50001].includes(error?.code)) return null;
      throw new PlatformError('discord_authority_unavailable',error?.status===429?429:503);
    }
  }
  const authority=options=>options.write?resolveAuthority(options):
    coalesce(authorityReads,`${options.guildId}:${options.userId}`,()=>resolveAuthority(options));
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
    // A connected production Gateway maintains channel create/update/delete
    // events. Resource pickers may read that projection; actual writes still
    // take the freshGuild path above and refresh all channel permissions.
    readChannels:guild=>!ownsClient && client.isReady?.()?
      Promise.resolve(guild.channels.cache):
      coalesce(guildReads,`channels:${guild.id}`,()=>guild.channels.fetch()),
    close() { if (ownsClient) client.destroy(); } };
}
