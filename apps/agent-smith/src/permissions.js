import { readFileSync } from 'node:fs';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { categories } from './blueprint.js';
import { manualChannelPolicy, permitsManualRoleOverwrite } from './manual-channels.js';

const data=JSON.parse(readFileSync(new URL('./permission-capabilities.json', import.meta.url), 'utf8'));
for(const value of Object.values(data))if(Array.isArray(value))Object.freeze(value);
export const capabilities = Object.freeze(data);
const allowed = new PermissionsBitField(capabilities.allowed.map(name => P[name]));
const known = Object.values(P).reduce((bits, flag) => bits | flag, 0n);
const legacyBit47 = 1n << 47n;
const configuredLegacy = (capabilities.inheritedLegacyBits ?? []).reduce((bits, value) => {
  const bit = BigInt(value);
  if (bit !== legacyBit47) throw new Error('Only the Owner-approved legacy bit 47 exception is supported.');
  return bits | bit;
}, 0n);

export function inheritedLegacyPermissionBits(bot) {
  const everyone = bot.guild?.roles?.everyone;
  if (!everyone || !bot.roles?.cache) return 0n;
  // Do not exempt a newly named permission after an SDK upgrade, or a bit
  // separately assigned to Smith's own roles. No live permission is changed.
  const inherited = configuredLegacy & ~known & everyone.permissions.bitfield;
  const separatelyAssigned = [...bot.roles.cache.values()].some(role =>
    role.id !== everyone.id && (role.permissions.bitfield & inherited) !== 0n);
  return separatelyAssigned ? 0n : inherited;
}

// Use discord.js's Discord-compatible resolver: owner/admin override, aggregate
// role overwrites, then member overwrites. Role position is NOT a channel grant.
export function resolvedPermissions(member, channel = null) {
  return channel ? channel.permissionsFor(member) : member.permissions;
}
export function hasPermission(member, permission, channel = null) {
  return resolvedPermissions(member, channel)?.has(permission) === true;
}
export function assertPermission(member, permission, channel = null, description = 'Required Discord permission missing') {
  if (!hasPermission(member, permission, channel)) throw new Error(description);
}
export function unsafeBotPermissions(bot) {
  const extra = bot.permissions.bitfield & ~(allowed.bitfield | inheritedLegacyPermissionBits(bot));
  const names = Object.entries(P).filter(([, flag]) => (extra & flag) !== 0n).map(([name]) => name);
  if (extra & ~known) names.push(`unknown bits 0x${(extra & ~known).toString(16)}`);
  return names;
}
export function assertBotCapabilities(bot) {
  const names = unsafeBotPermissions(bot);
  if (names.length) throw new Error(`UNSAFE: Smith has permissions outside its capability allowlist: ${names.join(', ')}. The Owner must remove these manually.`);
}
export function assertHigherRole(actor, target, guildOwnerId, description) {
  if (actor.id !== guildOwnerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new Error(description ?? 'Your highest role must be above the member’s highest role.');
  }
}
export function assertStaffChannel(channel, guild, cfg, extraRoleId = null) {
  if (!channel?.isTextBased?.() || channel.guildId !== guild.id
    || hasPermission(guild.roles.everyone, P.ViewChannel, channel)) throw new Error('Escalation/audit channel must be private to staff.');
  const humans = new Set([guild.ownerId, cfg.clientId, ...cfg.owners, ...(cfg.approvers ?? [])]);
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (!overwrite.allow.has(P.ViewChannel)) continue;
    if (overwrite.type === 1 && humans.has(overwrite.id)) continue;
    const role = guild.roles.cache.get(overwrite.id);
    if (overwrite.type === 0 && (overwrite.id === extraRoleId || role?.permissions.has(P.Administrator))) continue;
    throw new Error('Escalation/audit channel exposes alerts beyond designated staff.');
  }
}
export function assertRoleChannelGrants(role, guild) {
  const category=categories.find(c=>c.gate===role.name);
  const permitted=new Set(category?[category.name,...category.channels.map(([name])=>name)]:[]);
  const allow=new PermissionsBitField([P.ViewChannel,P.ReadMessageHistory,P.UseApplicationCommands,
    P.SendMessages,P.SendMessagesInThreads,P.CreatePublicThreads,P.AddReactions,P.Connect,P.Speak]).bitfield;
  const deny=new PermissionsBitField([P.ViewChannel,P.SendMessages,P.SendMessagesInThreads,
    P.CreatePublicThreads,P.CreatePrivateThreads]).bitfield;
  for(const channel of guild.channels?.cache?.values()??[]) {
    const overwrite=channel.permissionOverwrites.cache.get(role.id);
    if(!overwrite || (overwrite.allow.bitfield===0n && overwrite.deny.bitfield===0n))continue;
    const manual = manualChannelPolicy(guild, channel);
    if (manual) {
      if (permitsManualRoleOverwrite(manual, channel, role, overwrite)) continue;
      throw new Error('Role has unexpected channel permission grants/denials on an approved manual channel; Owner reconciliation required.');
    }
    if(!permitted.has(channel.name) || (overwrite.allow.bitfield & ~allow)!==0n || (overwrite.deny.bitfield & ~deny)!==0n) {
      throw new Error('Role has unexpected channel permission grants/denials; Owner reconciliation required.');
    }
  }
}
