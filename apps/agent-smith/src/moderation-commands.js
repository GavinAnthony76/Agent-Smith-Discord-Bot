import { SlashCommandBuilder, PermissionFlagsBits as P, ChannelType } from 'discord.js';

const reason = command => command.addStringOption(option =>
  option.setName('reason').setDescription('Required reason, saved in the audit history').setRequired(true).setMaxLength(400));
const member = command => command.addUserOption(option =>
  option.setName('user').setDescription('Member to moderate').setRequired(true));

export const moderationCommand = new SlashCommandBuilder()
  .setName('mod').setDescription('Owner-only moderation; destructive actions require confirmation')
  .setDMPermission(false).setDefaultMemberPermissions(P.Administrator)
  .addSubcommand(command => reason(member(command.setName('warn').setDescription('Record a warning and attempt a private notification'))))
  .addSubcommand(command => member(command.setName('history').setDescription('Show recent moderation cases for a member')))
  .addSubcommand(command => reason(command.setName('unwarn').setDescription('Mark a warning as withdrawn without deleting history')
    .addStringOption(option => option.setName('case').setDescription('Warning case number from history').setRequired(true))))
  .addSubcommand(command => reason(member(command.setName('timeout').setDescription('Temporarily prevent a member from participating'))
    .addIntegerOption(option => option.setName('minutes').setDescription('Duration: 1 minute to 28 days')
      .setRequired(true).setMinValue(1).setMaxValue(40320))))
  .addSubcommand(command => reason(member(command.setName('untimeout').setDescription('Remove a member’s timeout'))))
  .addSubcommand(command => reason(member(command.setName('kick').setDescription('Remove a member after confirmation'))))
  .addSubcommand(command => reason(member(command.setName('ban').setDescription('Ban a member after confirmation; preserve their messages'))))
  .addSubcommand(command => reason(command.setName('unban').setDescription('Lift a ban after confirmation')
    .addStringOption(option => option.setName('user_id').setDescription('Banned member’s Discord user ID').setRequired(true))))
  .addSubcommand(command => reason(command.setName('purge').setDescription('Confirm cleanup of recent, unpinned messages; protect system channels')
    .addChannelOption(option => option.setName('channel').setDescription('Text channel to clean').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addIntegerOption(option => option.setName('amount').setDescription('Inspect the latest 1–100 messages; skip pinned and old messages')
      .setRequired(true).setMinValue(1).setMaxValue(100))))
  .addSubcommand(command => command.setName('status').setDescription('Check bot moderation permissions and anti-spam mode'))
  .addSubcommand(command => reason(command.setName('antispam').setDescription('Turn alerts-only anti-spam monitoring on or off')
    .addBooleanOption(option => option.setName('enabled').setDescription('Monitor for spam without automatic punishment').setRequired(true))));