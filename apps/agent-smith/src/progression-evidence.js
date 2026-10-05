import { PermissionFlagsBits as P } from 'discord.js';

export function validateHelpfulMetadata({ message, uid, guildId, inFramework, memberCanView }) {
  if (!inFramework || !memberCanView || message.guildId !== guildId || message.author?.id !== uid
    || message.author.bot || message.webhookId || message.interactionMetadata || message.interaction
    || ![0, 19].includes(message.type)) {
    throw new Error('Helpful-answer evidence must be the recipient’s normal human message inside their approved private framework, not a bot, command or system message.');
  }
}
export async function verifiedEvidence({ guild, resource, framework, uid, source, evidence }) {
  if (source !== 'helpful_answer') return evidence;
  const match = evidence.match(/^(?:https:\/\/(?:www\.)?discord\.com\/channels\/(\d{17,20})\/)?(\d{17,20})\/(\d{17,20})$/);
  if (!match || (match[1] && match[1] !== guild.id)) throw new Error('Helpful answers require a Discord message link or channelID/messageID.');
  const [, , channelId, messageId] = match;
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || channel.guildId !== guild.id) throw new Error('Evidence channel is outside the authorized server.');
  const parent = channel.isThread() ? await guild.channels.fetch(channel.parentId) : channel;
  const expectedCategory = await resource('channel', framework.toUpperCase());
  const message = await channel.messages.fetch(messageId);
  const member = await guild.members.fetch({ user: uid, force: true });
  validateHelpfulMetadata({ message, uid, guildId: guild.id,
    inFramework: parent.parentId === expectedCategory && !channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel),
    memberCanView: channel.permissionsFor(member)?.has(P.ViewChannel) ?? false });
  // Canonical IDs deduplicate a full link and channel/message shorthand alike.
  return `${channelId}:${messageId}`;
}
