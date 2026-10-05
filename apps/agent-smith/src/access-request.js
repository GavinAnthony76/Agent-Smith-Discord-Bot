import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { frameworks } from './blueprint.js';

export const REQUEST_FRAMEWORK_ID = 'smith:access:request';

export function isAccessRequestInteraction(interaction) {
  return interaction.isStringSelectMenu() && interaction.customId === REQUEST_FRAMEWORK_ID;
}

export function accessRequestAction(interaction) {
  if (!isAccessRequestInteraction(interaction)) return null;
  const values = interaction.values;
  if (!Array.isArray(values) || values.length !== 1 || !frameworks.includes(values[0])) {
    throw new Error('Choose Faith, Gaming, or Tech.');
  }
  return { name: 'request', framework: values[0] };
}

export function accessRequestMessage() {
  return {
    content: [
      '**Request another community — no typing required**',
      'After accepting the rules and joining your first community, choose an additional community below.',
      'Your response is private. An allowlisted human must review and approve your request before access is granted.',
      'Submitting again reuses an existing pending request; it does not bypass approval.',
      'This channel is read-only, but the menu works without sending a message.',
      'Slash-command alternative: `/request framework:Faith`, `Gaming`, or `Tech`.',
      'Staff review requests with `/pending` and `/review` in the control room.'
    ].join('\n'),
    allowedMentions: { parse: [] },
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(REQUEST_FRAMEWORK_ID)
          .setPlaceholder('Request another community')
          .setMinValues(1).setMaxValues(1)
          .addOptions(frameworks.map(framework => ({ label: framework, value: framework })))
      )
    ]
  };
}
