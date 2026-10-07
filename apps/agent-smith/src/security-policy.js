import { AsyncLocalStorage } from 'node:async_hooks';
import { PermissionFlagsBits as P } from 'discord.js';
import { categories, roleNames } from './blueprint.js';
import { assertBotCapabilities, capabilities } from './permissions.js';

const scope = new AsyncLocalStorage();
const configurations = new WeakMap();
export const PROTECTED_CHANNEL_NAMES = new Set([
  ...categories.map(c => c.name),
  ...categories.flatMap(c => c.channels.filter(([, , readonly]) => readonly || c.gate === 'staff' || !c.gate).map(([name]) => name)),
  'moderation-log', 'audit-log', 'smith-control',
  'smith-controls', 'access-review', 'rules', 'onboarding', 'welcome', 'access-requests', 'automod-escalations'
]);
export const PROTECTED_ROLE_NAMES = new Set([
  'Server Owner', 'SERVER OWNER', 'Owner', 'Agent Smith', 'AGENT SMITH',
  'Administrator', 'Administrators', 'ADMINISTRATORS', ...roleNames
]);
export const FORBIDDEN_COMMAND_NAMES = new Set([
  'delete-all-channels', 'delete-all-roles', 'reset-server', 'nuke-server', 'mass-ban',
  'nuke', 'reset', 'delete-channel', 'delete-role'
]);
export const ROLE_WORKFLOWS = new Set(['member-command', 'native-reconciliation', 'progression-reconciliation', 'approval-recovery']);
export const GRANTABLE_ROLE_NAMES = new Set([...roleNames,'NEW ARRIVAL']);
export function securityLimits(env = process.env) {
  const purge = Number(env.SMITH_MAX_PURGE ?? 50);
  if (!Number.isInteger(purge) || purge < 1 || purge > 100) throw new Error('SMITH_MAX_PURGE must be an integer from 1 to 100.');
  // Deletion commands are deliberately absent: zero is stricter than one.
  return Object.freeze({ channelDeletes: 0, roleDeletes: 0, bansPerOperation: 1, purge, cooldownMs: 60000 });
}
export function registerSecurityConfiguration(guild, cfg) { configurations.set(guild, cfg); }
export function isOwner(userId, cfg = {}, actualOwnerId) {
  return !!userId && [cfg.ownerDiscordId, actualOwnerId, ...(cfg.owners ?? [])].includes(userId);
}
export function assertNotOwner(guild, userId, cfg = configurations.get(guild) ?? {}) {
  if (isOwner(userId, cfg, guild.ownerId)) throw new Error('The Server Owner and protected owner accounts are immune to Smith management.');
}
export function isProtectedOwner(guild, userId) {
  return isOwner(userId, configurations.get(guild) ?? {}, guild.ownerId);
}
export async function refreshOwnerProtection(guild) {
  const cfg = configurations.get(guild);
  if (!cfg) throw new Error('Missing registered security configuration; management refused.');
  await guild.fetch();
  assertOwnerConfiguration(cfg, guild.ownerId);
}
export function assertOwnerConfiguration(cfg, actualOwnerId) {
  if (!cfg.ownerDiscordId || cfg.ownerDiscordId !== actualOwnerId || !cfg.owners.includes(actualOwnerId)) {
    throw new Error('OWNER_DISCORD_ID must match the actual Server Owner before privileged actions.');
  }
}
export function withRoleWorkflow(source, subject, fn, actorId) {
  if (!ROLE_WORKFLOWS.has(source) || !subject) throw new Error('Untrusted role-management origin.');
  return scope.run(Object.freeze({ kind: 'roles', source, subject, actorId }), fn);
}
export function withModerationWorkflow(action, actorId, fn, confirmed = false) {
  const operations = new Set(['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge']);
  if (!operations.has(action.operation) || !actorId) throw new Error('Untrusted moderation origin.');
  if (['kick','ban','unban','purge'].includes(action.operation) && !confirmed) throw new Error('Destructive moderation requires confirmation.');
  if (action.operation === 'purge' && (!Array.isArray(action.messageIds)
    || !action.messageIds.length || action.messageIds.length > securityLimits().purge)) {
    throw new Error('Purge requires a bounded list of approved messages.');
  }
  return scope.run(Object.freeze({ kind: 'moderation', operation: action.operation, subject: action.target,
    channel: action.channel, actorId, confirmed, messageIds: Object.freeze([...(action.messageIds ?? [])]) }), fn);
}
export function mutationScope() { return scope.getStore(); }
export function withRequestNotification(subject, fn) {
  if (!/^\d{17,20}$/.test(subject ?? '')) throw new Error('Invalid notification recipient.');
  return scope.run(Object.freeze({kind:'notification',source:'request-expiry',subject}),fn);
}
export function assertSafeBot(bot) {
  assertBotCapabilities(bot);
}
export function assertSafeHierarchy(bot, owner) {
  if (owner.roles.highest.position <= bot.roles.highest.position) {
    throw new Error('UNSAFE: the Server Owner security role must be above Smith. The Owner must correct the hierarchy manually.');
  }
  for(const id of capabilities.seniorRoleIds) {
    const role=bot.guild?.roles.cache.get(id);
    if(!role || role.position<=bot.roles.highest.position)throw new Error('UNSAFE: missing or below-Smith designated senior role.');
  }
}
export function assertSafeRole({ role, bot, botRoleIds = [], trackedNames }) {
  if (!role || role.managed || !role.editable || role.permissions.bitfield !== 0n
    || !GRANTABLE_ROLE_NAMES.has(role.name) || trackedNames.get(role.id) !== role.name
    || botRoleIds.includes(role.id) || role.position >= bot.roles.highest.position) {
    throw new Error('Role is not an explicitly tracked, permission-free role below Smith.');
  }
}
export function assertCommandTree(commands) {
  const visit = commands => { for (const command of commands) {
    if (FORBIDDEN_COMMAND_NAMES.has(command.name)) throw new Error('Unsafe destructive command registered.');
    if (command.options) visit(command.options);
  } };
  visit(commands);
}
