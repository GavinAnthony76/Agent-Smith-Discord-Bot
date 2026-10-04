import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { frameworks, interests } from './blueprint.js';
const command = (name, description) => new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);
const framework = c => c.addStringOption(o => o.setName('framework').setDescription('Community').setRequired(true).addChoices(...frameworks.map(x=>({name:x,value:x}))));
export const commands = [
  command('accept','Accept the server rules'), framework(command('join','Choose your first framework')),
  framework(command('request','Request human approval for another framework')),
  command('interest','Toggle a non-access interest role').addStringOption(o=>o.setName('name').setDescription('Interest').setRequired(true).addChoices(...Object.values(interests).flat().map(x=>({name:x,value:x})))),
  command('pending','List pending access requests').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  command('review','Approve or deny an access request').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o=>o.setName('id').setDescription('Request ID').setRequired(true))
    .addBooleanOption(o=>o.setName('approve').setDescription('Approve?').setRequired(true)),
  framework(command('revoke','Owner: revoke an additional framework')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
  command('trivia','Start a gaming trivia question'),
  command('answer','Answer your current trivia question').addStringOption(o=>o.setName('answer').setDescription('Your answer').setRequired(true)),
  command('profile','View your XP and cosmetic reward tier')
];
