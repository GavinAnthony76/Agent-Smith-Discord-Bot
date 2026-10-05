import { SlashCommandBuilder } from 'discord.js';
import { titles, progressionConfig } from './progression-config.js';
const framework = sub => sub.addStringOption(o => o.setName('framework').setDescription('Approved community').setRequired(true)
  .addChoices(...Object.keys(titles).map(value => ({ name: value, value }))));
const recipient = sub => sub.addUserOption(o => o.setName('user').setDescription('Recipient (not yourself)').setRequired(true));
const reason = sub => sub.addStringOption(o => o.setName('reason').setDescription('Verification/correction reason, at least 10 characters').setRequired(true).setMinLength(10).setMaxLength(500));
export const progressionCommands = [
  new SlashCommandBuilder().setName('ranks').setDescription('Progression ladders, rates, daily limits and Faith approvals').setDMPermission(false),
  new SlashCommandBuilder().setName('xp').setDescription('Private allowlisted progression controls').setDMPermission(false)
    .addSubcommand(s => reason(framework(recipient(s.setName('award').setDescription('Human-reviewed verified contribution; daily limits apply'))))
      .addStringOption(o => o.setName('source').setDescription('Verified contribution type').setRequired(true)
        .addChoices(...Object.entries(progressionConfig.sources).filter(([, r]) => !r.automatic).map(([value]) => ({ name: value, value }))))
      .addStringOption(o => o.setName('event').setDescription('Helpful: message link or channelID/messageID; otherwise stable activity ID').setRequired(true).setMinLength(3).setMaxLength(100)))
    .addSubcommand(s => reason(framework(recipient(s.setName('correct').setDescription('Owner-only exceptional signed correction; separate audit'))))
      .addIntegerOption(o => o.setName('amount').setDescription('Signed XP adjustment, not an earned award').setRequired(true).setMinValue(-1000000).setMaxValue(1000000))
      .addStringOption(o => o.setName('event').setDescription('Stable correction/ticket ID; reuse it for retries').setRequired(true).setMinLength(3).setMaxLength(100)))
    .addSubcommand(s => s.setName('status').setDescription('Pending recovery, uncertain announcements and ambiguous legacy balances')),
  new SlashCommandBuilder().setName('faith-review').setDescription('Private allowlisted Faith promotion review').setDMPermission(false)
    .addSubcommand(s => s.setName('pending').setDescription('List pending Faith promotions')
      .addStringOption(o => o.setName('after').setDescription('Optional promotion ID cursor').setMaxLength(20)))
    .addSubcommand(s => reason(s.setName('decide').setDescription('Explicitly approve or deny an eligible Faith promotion'))
      .addStringOption(o => o.setName('id').setDescription('Promotion ID from pending list').setRequired(true).setMaxLength(20))
      .addBooleanOption(o => o.setName('approve').setDescription('Approve promotion?').setRequired(true)))
];
