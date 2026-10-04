import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const PREFIX = 'smith:review:';
export function parseRequestId(value) {
  if (!/^[1-9]\d{0,18}$/.test(value ?? '') || BigInt(value) > 9223372036854775807n) {
    throw new Error('Use the request number shown by /pending (for example 1), not a member ID.');
  }
  return value;
}

export function isReviewInteraction(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(PREFIX);
}

export function reviewAction(interaction) {
  if (!isReviewInteraction(interaction)) return null;
  const match = /^smith:review:(approve|deny):([1-9]\d{0,18})$/.exec(interaction.customId);
  if (!match) throw new Error('Invalid review button. Run /pending for current requests.');
  return { name: 'review', framework: null, requestId: parseRequestId(match[2]), approve: match[1] === 'approve' };
}

export function pendingMessage(requests) {
  return {
    content: requests.length ? [
      '**Pending access requests**',
      'Use the buttons below, or `/review id:<request number> approve:true|false`.',
      '**The request number is NOT the member’s Discord ID.**',
      ...requests.map(request => `**Request #${request.id}** — ${request.framework} — member <@${request.user_id}>`),
      ...(requests.length > 5 ? ['Buttons cover the first five requests; use /review for the others.'] : [])
    ].join('\n') : 'No pending requests.',
    components: requests.slice(0, 5).map(request => {
      const id = parseRequestId(String(request.id));
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}approve:${id}`).setLabel(`Approve #${id}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}deny:${id}`).setLabel(`Deny #${id}`).setStyle(ButtonStyle.Danger)
      );
    }),
    allowedMentions: { parse: [] }
  };
}