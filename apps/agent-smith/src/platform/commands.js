import { AsyncLocalStorage } from 'node:async_hooks';
import { SlashCommandBuilder, Routes } from 'discord.js';
import { TARGET_GUILD_ID } from '../config.js';
import { PlatformError } from './catalog.js';
import { withPrivilegedPipeline } from '../privileged-pipeline.js';
import { smithCommand } from '../conversation-commands.js';

export const communityCommand=new SlashCommandBuilder().setName('smith-community')
  .setDescription('This server’s configured community features; cosmetic credits have no real-money value.')
  .addSubcommand(c=>c.setName('onboard').setDescription('Start or resume this server’s onboarding'))
  .addSubcommand(c=>c.setName('balance').setDescription('Your cosmetic community-credit balance'))
  .addSubcommand(c=>c.setName('daily').setDescription('Claim the configured cosmetic daily allowance'))
  .addSubcommand(c=>c.setName('shop').setDescription('View this server’s enabled cosmetic shop items'))
  .addSubcommand(c=>c.setName('buy').setDescription('Buy a cosmetic item using community credits')
    .addStringOption(o=>o.setName('item').setDescription('Item ID shown by shop').setRequired(true).setMaxLength(100))
    .addIntegerOption(o=>o.setName('price').setDescription('Confirm the price shown by shop').setRequired(true).setMinValue(1).setMaxValue(1000000)))
  .addSubcommand(c=>c.setName('inventory').setDescription('Your cosmetic inventory'))
  .addSubcommand(c=>c.setName('role-select').setDescription('Select an allowed cosmetic role')
    .addRoleOption(o=>o.setName('role').setDescription('Configured cosmetic role').setRequired(true)))
  .addSubcommand(c=>c.setName('role-remove').setDescription('Remove an allowed cosmetic role')
    .addRoleOption(o=>o.setName('role').setDescription('Configured cosmetic role').setRequired(true)));
const context=new AsyncLocalStorage();
export function executePlatformCommandWrite(client, request, execute){
  const scope=context.getStore();
  if(!scope)return null;
  if(scope.used||client!==scope.client||request.method!=='POST'||request.fullRoute!==scope.route||
    JSON.stringify(request.body)!==scope.body||request.files?.length||Date.now()>scope.expires)
    throw new PlatformError('platform_command_request_not_authorized',403);
  scope.used=true;
  return withPrivilegedPipeline({action:{operation:'commands.register',source:'platform-commands',guildId:scope.guildId},
    validate:async()=>{
      await scope.validate();
      if(Date.now()>scope.expires||request.method!=='POST'||request.fullRoute!==scope.route||
        JSON.stringify(request.body)!==scope.body||request.files?.length)
        throw new PlatformError('platform_command_scope_expired_or_changed',403);
    },record:scope.record},execute);
}
export async function registerPlatformCommands({ client,pool,discord,guildId,applicationId }){
  if(guildId===TARGET_GUILD_ID)return;
  const route=Routes.applicationGuildCommands(applicationId,guildId);
  const existing=await client.rest.get(route);
  // Add missing static names only. Never replace an existing command tree,
  // delete a conflict or publish global commands.
  for(const builder of [smithCommand,communityCommand]){
    const body=builder.toJSON();
    if(body.name==='smith') body.description='Talk with Agent Smith or get help for this server';
    if(existing.some(c=>c.name===body.name))continue;
    await context.run({client,guildId,route,body:JSON.stringify(body),used:false,expires:Date.now()+30000,
      validate:async()=>{
        const guild=await discord.freshGuild(guildId);
        const installed=(await pool.query('SELECT installed FROM platform_guilds WHERE guild_id=$1',[guildId])).rows[0]?.installed;
        if(!installed||guild.id!==guildId||!discord.memberRolesVerified(guild,guild.members.me))
          throw new PlatformError('command_guild_not_verified',403);
      },
      record:(action,data)=>pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,$3,'settings',$4)`,[guildId,applicationId,action,data]),
    },()=>client.rest.post(route,{body}));
  }
}
