import { ChannelType, Collection, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { reviewedGamingForum as policy } from '../../src/reviewed-forum-policy.js';

// Test-only structural fixture; no clients, REST, production data or writes.
export function seedReviewedForum({guild,role,bot,rows}) {
  role.guild=guild;bot.guild=guild;
  for(const [id,value] of bot.roles.cache) {
    value.permissions??=new PermissionsBitField();
    if(!guild.roles.cache.has(id)) guild.roles.cache.set(id,{
      id,name:'Agent Smith',position:bot.roles.highest.position,...value,
    });
  }
  const communication=[P.ViewChannel,P.ReadMessageHistory,P.UseApplicationCommands,P.SendMessages,
    P.SendMessagesInThreads,P.CreatePublicThreads,P.AddReactions,P.Connect,P.Speak];
  guild.roles.everyone??={id:guild.id,name:'@everyone',permissions:new PermissionsBitField()};
  guild.roles.cache.set(guild.id,guild.roles.everyone);
  const channel=(id,name,type,parentId)=>({
    id,name,type,parentId,guildId:guild.id,
    permissionOverwrites:{cache:new Collection([
      [guild.id,{id:guild.id,type:0,allow:new PermissionsBitField(),deny:new PermissionsBitField(P.ViewChannel)}],
      [role.id,{id:role.id,type:0,allow:new PermissionsBitField(communication),deny:new PermissionsBitField()}],
      [bot.id,{id:bot.id,type:1,allow:new PermissionsBitField([...communication,P.ManageChannels,P.ManageThreads]),deny:new PermissionsBitField()}],
    ])},
    permissionsFor(principal) {
      return new PermissionsBitField(principal.id===guild.id?[]:
        principal.id===role.id || principal.id===bot.id?communication:[]);
    },
  });
  const parent=channel(policy.parentId,'GAMING',ChannelType.GuildCategory,null);
  const forum=channel(policy.channelId,'mmo-thread',ChannelType.GuildForum,parent.id);
  guild.channels??={cache:new Collection(),fetch:async()=>{}};
  guild.channels.cache.set(parent.id,parent);guild.channels.cache.set(forum.id,forum);
  rows.push({kind:'channel',name:'GAMING',discord_id:parent.id},
    {kind:'channel',name:policy.canonicalDisplayName,discord_id:forum.id});
  return {parent,forum};
}
