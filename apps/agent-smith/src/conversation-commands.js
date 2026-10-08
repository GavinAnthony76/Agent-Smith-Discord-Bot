import { SlashCommandBuilder, Routes } from 'discord.js';

export const smithCommand = new SlashCommandBuilder().setName('smith')
  .setDescription('Talk with Agent Smith or get Hallowed Core help').setDMPermission(false)
  .addSubcommand(command => command.setName('ask').setDescription('Ask Smith a question (private by default)')
    .addStringOption(option => option.setName('question').setDescription('Your question').setRequired(true).setMaxLength(2000))
    .addBooleanOption(option => option.setName('private').setDescription('Keep the answer private (default: true)')))
  .addSubcommand(command => command.setName('help').setDescription('Conversation and server help'))
  .addSubcommand(command => command.setName('about').setDescription('Who Agent Smith is'))
  .addSubcommand(command => command.setName('status').setDescription('Conversation service availability'))
  .addSubcommand(command => command.setName('clear-context').setDescription('Clear your temporary conversation context'));

// Exact static upsert: preserves every other command and uses the existing client.
export function registerSmithCommand({ client, cfg, guild }) {
  return client.rest.post(Routes.applicationGuildCommands(cfg.clientId, guild.id), { body: smithCommand.toJSON() });
}
