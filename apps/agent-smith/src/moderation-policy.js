import { randomUUID } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord.js';

export const moderationPermissions = {
  timeout: P.ModerateMembers, untimeout: P.ModerateMembers,
  kick: P.KickMembers, ban: P.BanMembers, unban: P.BanMembers, purge: P.ManageMessages
};

export function assertModerator(actorId, cfg) {
  if (!cfg.owners.includes(actorId)) throw new Error('Moderation is restricted to configured owners. Access reviewers are not moderators.');
}

export function assertTarget({ actor, target, bot, guildOwnerId, owners, operation }) {
  if (!target || target.user.bot || target.id === actor.id || target.id === guildOwnerId || owners.includes(target.id)) {
    throw new Error('You cannot moderate yourself, bot accounts, or protected owner accounts.');
  }
  if (actor.id !== guildOwnerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new Error('Your highest role must be above the member’s highest role.');
  }
  if (moderationPermissions[operation] && bot.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new Error('Agent Smith’s highest role must be above the member’s highest role.');
  }
  if (['timeout', 'untimeout'].includes(operation) && target.permissions.has(P.Administrator)) {
    throw new Error('Discord does not allow timing out administrators.');
  }
}

export function validReason(value) {
  const reason = value?.trim();
  if (!reason || reason.length > 400) throw new Error('A reason of 1–400 characters is required.');
  return reason;
}

export function discordId(value) {
  if (!/^\d{17,20}$/.test(value ?? '')) throw new Error('Enter a valid Discord user ID.');
  return value;
}

export function purgeCandidates(messages, now = Date.now()) {
  // A small margin avoids crossing Discord's 14-day bulk-delete cutoff.
  return [...messages.values()].filter(message =>
    !message.pinned && now - message.createdTimestamp < 14 * 86400000 - 60000
  );
}

export class Confirmations {
  constructor({ now = Date.now, id = randomUUID, ttl = 120000 } = {}) {
    this.now = now; this.id = id; this.ttl = ttl; this.entries = new Map();
  }
  create(action, context) {
    for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(key);
    if (this.entries.size >= 500) throw new Error('Too many pending confirmations. Please wait two minutes.');
    const token = this.id();
    this.entries.set(token, { action, ...context, expires: this.now() + this.ttl });
    return token;
  }
  consume(token, context) {
    const entry = this.entries.get(token);
    if (!entry || entry.expires <= this.now()) {
      this.entries.delete(token);
      throw new Error('This confirmation expired or was already used. Run the command again.');
    }
    if (['actorId', 'guildId', 'channelId'].some(key => entry[key] !== context[key])) {
      throw new Error('Only the requesting owner can confirm this action in its original channel.');
    }
    this.entries.delete(token);
    return entry.action;
  }
}