import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { frameworks, interests } from './blueprint.js';
import { moderationCommand } from './moderation-commands.js';
import { progressionCommands } from './progression-commands.js';
import { smithControlCommand } from './smith-control.js';
import { maintenanceCommands } from './maintenance-commands.js';
const command = (name, description) => new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);
const framework = c => c.addStringOption(o => o.setName('framework').setDescription('Community').setRequired(true).addChoices(...frameworks.map(x=>({name:x,value:x}))));
export const commands = [
  command('accept','Accept the server rules'), framework(command('join','Choose your first framework')),
  framework(command('request','Request human approval for another framework')),
  command('requests','View your requests and withdraw your own pending requests'),
  command('interest','Toggle a non-access interest role').addStringOption(o=>o.setName('name').setDescription('Interest').setRequired(true).addChoices(...Object.values(interests).flat().map(x=>({name:x,value:x})))),
  command('pending','List pending access requests').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  command('review','Approve or deny an access request').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o=>o.setName('id').setDescription('Request number from /pending, e.g. 1 — NOT the member’s Discord ID').setRequired(true))
    .addBooleanOption(o=>o.setName('approve').setDescription('Approve?').setRequired(true)),
  framework(command('revoke','Owner: revoke an additional framework')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
  command('trivia','Start a gaming trivia question'),
  command('answer','Answer your current trivia question').addStringOption(o=>o.setName('answer').setDescription('Your answer').setRequired(true)),
  command('profile','Privately view XP and ranks in each approved framework'),
  ...progressionCommands,
  moderationCommand, smithControlCommand, ...maintenanceCommands,
  ...Object.entries({warn:'warn',warnings:'history','clear-warning':'unwarn',timeout:'timeout',untimeout:'untimeout',
    kick:'kick',ban:'ban',unban:'unban',purge:'purge'}).map(([name,operation])=>({toJSON() {
    const sub=moderationCommand.toJSON().options.find(s=>s.name===operation);
    return {name,description:sub.description,options:sub.options??[],dm_permission:false,
      default_member_permissions:String(PermissionFlagsBits.ModerateMembers)};
  }})),
  framework(command('access-request','Request human-approved additional access')),
  ...['approve','deny'].map(verb=>command(`access-${verb}`,`Human: ${verb} an access request`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o=>o.setName('id').setDescription('Request number').setRequired(true))),
  framework(command('access-revoke','Owner: revoke additional access')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
];
