import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { frameworks } from './blueprint.js';

export const ACCEPT_RULES_ID = 'smith:onboarding:accept';
export const CHOOSE_FRAMEWORK_ID = 'smith:onboarding:join';

export function onboardingAction(interaction) {
  if (interaction.isButton() && interaction.customId === ACCEPT_RULES_ID) {
    return { name: 'accept', framework: null };
  }
  if (interaction.isStringSelectMenu() && interaction.customId === CHOOSE_FRAMEWORK_ID) {
    const [framework] = interaction.values;
    if (interaction.values.length !== 1 || !frameworks.includes(framework)) {
      throw new Error('Choose Faith, Gaming, or Tech.');
    }
    return { name: 'join', framework };
  }
  return null;
}

export function isOnboardingInteraction(interaction) {
  return (interaction.isButton() && interaction.customId === ACCEPT_RULES_ID)
    || (interaction.isStringSelectMenu() && interaction.customId === CHOOSE_FRAMEWORK_ID);
}

export function onboardingMessage() {
  return {
    content: [
      '**Start here — no typing required**',
      '1. Read #rules, then click **Accept rules** below. This gives you access to the shared hub.',
      '2. Use **Choose your community** below to choose ONE: Faith, Gaming, or Tech.',
      'Accepting rules is required before choosing a community. The other communities stay private.',
      'After joining, use `/interest` for topics. Use `/request` for another community; an allowlisted human must approve it.',
      'These channels are read-only, but the button and menu work without sending a message.',
      'Slash-command alternatives: `/accept`, then `/join framework:Faith`, `Gaming`, or `Tech`. Typing plain “accept” is not a command.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ACCEPT_RULES_ID).setLabel('Accept rules').setStyle(ButtonStyle.Success)
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(CHOOSE_FRAMEWORK_ID).setPlaceholder('Choose your community')
          .setMinValues(1).setMaxValues(1)
          .addOptions(frameworks.map(framework => ({ label: framework, value: framework })))
      )
    ],
    allowedMentions: { parse: [] }
  };
}