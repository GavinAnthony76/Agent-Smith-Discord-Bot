import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
export function requestAge(request, now = Date.now()) {
  if (!request.created_at) return '';
  const age = Math.max(0,Math.floor((now-new Date(request.created_at).getTime())/86400000));
  const remaining = request.expires_at ? Math.ceil((new Date(request.expires_at).getTime()-now)/86400000) : null;
  return ` — ${age}d old${remaining !== null && remaining <= 2 ? ` — **expires in ${Math.max(0,remaining)}d**` : ''}`;
}

const PREFIX = 'smith:review:';
const PENDING_PREFIX = 'smith:pending:';
export const PENDING_PAGE_SIZE = 15;
const REVIEW_ROWS = 4;
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

export function isPendingInteraction(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(PENDING_PREFIX);
}

export function pendingAction(interaction) {
  if (!isPendingInteraction(interaction)) return null;
  if (interaction.customId === `${PENDING_PREFIX}first`) {
    return { name: 'pending', framework: null, after: null };
  }
  const match = /^smith:pending:after:([1-9]\d{0,18})$/.exec(interaction.customId);
  if (!match) throw new Error('Invalid pending page button. Run /pending for current requests.');
  return { name: 'pending', framework: null, after: parseRequestId(match[1]) };
}

// The query includes one extra row solely to determine whether there is a next page.
export function pendingMessage(rows, after = null) {
  const requests = rows.slice(0, PENDING_PAGE_SIZE);
  const navigation = new ActionRowBuilder();
  if (after !== null) {
    parseRequestId(after);
    navigation.addComponents(new ButtonBuilder().setCustomId(`${PENDING_PREFIX}first`)
      .setLabel('First page').setStyle(ButtonStyle.Secondary));
  }
  if (rows.length > PENDING_PAGE_SIZE) {
    const cursor = parseRequestId(String(requests.at(-1).id));
    navigation.addComponents(new ButtonBuilder().setCustomId(`${PENDING_PREFIX}after:${cursor}`)
      .setLabel('Next page').setStyle(ButtonStyle.Primary));
  }
  return {
    content: requests.length ? [
      '**Pending access requests**',
      ...(after !== null ? [`Showing pending requests after Request #${after}.`] : []),
      'Use the buttons below, or `/review id:<request number> approve:true|false`.',
      '**The request number is NOT the member’s Discord ID.**',
      ...requests.map(request => `**Request #${request.id}** — ${request.framework} — member <@${request.user_id}>${requestAge(request)}`),
      ...(requests.length > REVIEW_ROWS ? ['Buttons cover the first four requests on this page; use /review for the others.'] : []),
      ...(rows.length > PENDING_PAGE_SIZE ? ['Use Next page for more pending requests.'] : [])
    ].join('\n') : after !== null
      ? `No pending requests after Request #${after}. Use First page or /pending to refresh the queue.`
      : 'No pending requests.',
    components: [...requests.slice(0, REVIEW_ROWS).map(request => {
      const id = parseRequestId(String(request.id));
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}approve:${id}`).setLabel(`Approve #${id}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}deny:${id}`).setLabel(`Deny #${id}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`smith:maintenance:moreinfo:${id}`).setLabel('Ask for more info').setStyle(ButtonStyle.Secondary)
      );
    }), ...(navigation.components.length ? [navigation] : [])],
    allowedMentions: { parse: [] }
  };
}