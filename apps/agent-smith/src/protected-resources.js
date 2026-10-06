import { PermissionFlagsBits as P } from 'discord.js';
import { PROTECTED_CHANNEL_NAMES, PROTECTED_ROLE_NAMES } from './security-policy.js';

// One ID-based registry, assembled from tracked identities and live security roles.
// Names identify configured resources, but enforcement thereafter uses their IDs.
export function protectedResources({ guild, bot, owner, rows }) {
  const registry = new Map();
  const add = (id, kind, reason) => { if (id) registry.set(id, { id, kind, reason }); };
  for (const row of rows) {
    if (row.kind === 'role' && PROTECTED_ROLE_NAMES.has(row.name)) add(row.discord_id, 'role', row.name);
    if (row.kind === 'starter-channel' || row.kind === 'community-channel'
      || row.kind === 'channel' && PROTECTED_CHANNEL_NAMES.has(row.name)) add(row.discord_id, 'channel', row.name);
  }
  for (const role of guild.roles.cache.values()) {
    if (PROTECTED_ROLE_NAMES.has(role.name) || role.permissions?.has(P.Administrator)
      || role.permissions?.has(P.ManageGuild) || bot.roles.cache.has(role.id)) add(role.id, 'role', role.name);
  }
  add(owner?.roles.highest.id, 'role', 'Owner security role');
  for (const channel of guild.channels?.cache?.values() ?? []) {
    if (PROTECTED_CHANNEL_NAMES.has(channel.name)) add(channel.id, 'channel', channel.name);
  }
  return registry;
}
export function assertUnprotected(registry, id, operation) {
  if (registry.has(id)) throw new Error(`Protected ${registry.get(id).kind}: ${operation} is disabled.`);
}
