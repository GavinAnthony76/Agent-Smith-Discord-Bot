import { SlashCommandBuilder,PermissionFlagsBits as P } from 'discord.js';
const c=(n,d)=>new SlashCommandBuilder().setName(n).setDescription(d).setDMPermission(false);
const staff=c=>c.setDefaultMemberPermissions(P.ModerateMembers);
const caseId=c=>c.addStringOption(o=>o.setName('id').setDescription('Case number').setRequired(true).setMaxLength(19));
export const maintenanceCommands=[
 c('onboarding','Privately inspect or recover your durable onboarding state'),
 c('interests','Manage saved interests in your approved frameworks'),
 c('onboarding-recover','Admin: reconcile failed onboarding without erasing security history')
  .setDefaultMemberPermissions(P.Administrator).addUserOption(o=>o.setName('user').setDescription('Member to reconcile').setRequired(true)),
 c('smith','Agent Smith health').addSubcommand(s=>s.setName('status').setDescription('Basic health; authorized staff see operational details')),
 c('report','Submit a private report to staff').addUserOption(o=>o.setName('user').setDescription('Reported member')),
 staff(c('cases','Privately list persistent moderation cases')).addUserOption(o=>o.setName('user').setDescription('Filter by member')),
 caseId(staff(c('case','Privately inspect a persistent case and notes'))),
 caseId(staff(c('case-note','Append a persistent, attributed case note')))
  .addStringOption(o=>o.setName('note').setDescription('Note').setRequired(true).setMinLength(3).setMaxLength(1000)),
 caseId(staff(c('case-close','Close the review, retaining history and any active restriction'))),
 staff(c('member-info','Privately inspect persistent lifecycle and restrictions'))
  .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
 c('mod-history','Privately inspect durable moderation history').setDefaultMemberPermissions(P.ModerateMembers)
  .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
 c('balance','Your optional cosmetic community credit balance'),
 c('daily','Claim the optional daily community credit reward'),
 c('shop','Browse optional cosmetic profile badges'),
 c('buy','Buy an optional cosmetic profile badge').addStringOption(o=>o.setName('item').setDescription('Shop item ID').setRequired(true).setMaxLength(40)),
 c('inventory','Your owned cosmetic profile badges')
];
