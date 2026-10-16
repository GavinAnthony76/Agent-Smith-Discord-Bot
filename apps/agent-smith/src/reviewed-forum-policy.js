import { ChannelType, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';

// Owner-reviewed identity. Names are display metadata, never an identity fallback.
export const reviewedGamingForum=Object.freeze({
  guildId:'1556423230590423042',
  channelId:'1556432973728063558',
  parentId:'1556432970326343821',
  roleId:'1556432551088889878',
  type:ChannelType.GuildForum,
  canonicalDisplayName:'mmo-adventures',
});
const communication=new PermissionsBitField([
  P.ViewChannel,P.ReadMessageHistory,P.UseApplicationCommands,P.SendMessages,
  P.SendMessagesInThreads,P.CreatePublicThreads,P.AddReactions,P.Connect,P.Speak,
]).bitfield;
const denials=new PermissionsBitField([
  P.ViewChannel,P.SendMessages,P.SendMessagesInThreads,P.CreatePublicThreads,P.CreatePrivateThreads,
]).bitfield;
const botAllow=communication|P.ManageChannels|P.ManageThreads;
// Framework access must not expose management rights inherited from @everyone.
const management=P.Administrator|P.ManageGuild|P.ManageRoles|P.ManageChannels|
  P.ManageThreads|P.ManageMessages|P.ModerateMembers|P.KickMembers|P.BanMembers;
const required= P.ViewChannel|P.ReadMessageHistory|P.SendMessages|P.SendMessagesInThreads;
const refuse=()=>{throw new Error('Role has unexpected channel permission grants/denials or reviewed forum identity/protection drift; Owner review required.');};
function bounds(channel,guild,bot) {
  const overwrites=channel.permissionOverwrites?.cache;
  if(!overwrites || typeof overwrites.values!=='function' || typeof channel.permissionsFor!=='function') refuse();
  const everyone=overwrites.get(guild.id),gaming=overwrites.get(reviewedGamingForum.roleId),smith=overwrites.get(bot.id);
  if(!everyone || everyone.type!==0 || everyone.allow.bitfield!==0n ||
      !everyone.deny.has(P.ViewChannel) || (everyone.deny.bitfield&~denials)!==0n ||
      !gaming || gaming.type!==0 || (gaming.allow.bitfield&~communication)!==0n ||
      (gaming.allow.bitfield&required)!==required || (gaming.deny.bitfield&~denials)!==0n ||
      !smith || smith.type!==1 || (smith.allow.bitfield&~botAllow)!==0n ||
      (smith.deny.bitfield&~denials)!==0n) refuse();
  for(const [id,overwrite] of overwrites) {
    if(![guild.id,reviewedGamingForum.roleId,bot.id].includes(id) || overwrite.id!==id) refuse();
  }
  if(channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)!==false ||
      !channel.permissionsFor(bot)?.has([P.ViewChannel,P.ReadMessageHistory,P.SendMessages,P.SendMessagesInThreads]) ||
      !channel.permissionsFor(guild.roles.cache.get(reviewedGamingForum.roleId))?.has(required)) refuse();
}
export function assertReviewedGamingForum({guild,role,bot,owner,rows,registry}) {
  const policy=reviewedGamingForum;
  if(guild.id!==policy.guildId || role?.id!==policy.roleId || role.name!=='Gaming' ||
      !bot || !owner || owner.id!==guild.ownerId || bot.id===guild.ownerId ||
      bot.guild?.id!==guild.id || role.guild?.id!==guild.id ||
      !bot.permissions?.has(P.ManageRoles) || !bot.roles?.highest || !owner.roles?.highest ||
      owner.roles.highest.position<=bot.roles.highest.position ||
      role.position>=bot.roles.highest.position || role.managed || !role.editable ||
      role.permissions?.bitfield!==0n || bot.roles.cache.has(role.id) ||
      !guild.roles.everyone?.permissions ||
      (guild.roles.everyone.permissions.bitfield&management)!==0n ||
      !Array.isArray(rows) || !registry) refuse();
  for(const [kind,id] of [['channel',policy.channelId],['channel',policy.parentId],['role',policy.roleId]])
    if(!rows.some(row=>row.kind===kind && row.discord_id===id)) refuse();
  const channel=guild.channels?.cache?.get(policy.channelId),parent=guild.channels?.cache?.get(policy.parentId);
  if(!channel || channel.id!==policy.channelId || channel.guildId!==guild.id ||
      channel.parentId!==policy.parentId || channel.type!==policy.type || channel.isThread?.() ||
      !parent || parent.id!==policy.parentId || parent.guildId!==guild.id ||
      parent.type!==ChannelType.GuildCategory || parent.parentId!==null ||
      registry.has(channel.id) || registry.get(parent.id)?.kind!=='channel' ||
      registry.get(owner.roles.highest.id)?.kind!=='role' ||
      registry.get(bot.roles.highest.id)?.kind!=='role') refuse();
  bounds(parent,guild,bot);
  bounds(channel,guild,bot);
  return channel;
}
