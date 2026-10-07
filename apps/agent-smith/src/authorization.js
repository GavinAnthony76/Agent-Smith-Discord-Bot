import { PermissionFlagsBits as P } from 'discord.js';
import { hasPermission } from './permissions.js';
import { isOwner as protectedOwner, assertSafeRole } from './security-policy.js';
export const isOwner=(member,cfg,guild)=>protectedOwner(member?.id??member?.user?.id,cfg,guild?.ownerId);
export const isAdmin=(member,cfg,guild)=>!member?.user?.bot && (isOwner(member,cfg,guild)||hasPermission(member,P.Administrator));
export const isModerator=(member,cfg,guild)=>isAdmin(member,cfg,guild)
 || (!member?.user?.bot && hasPermission(member,P.ModerateMembers));
export const isFrameworkLead=(member,cfg,framework)=>!member?.user?.bot
 && (cfg.frameworkLeadRoleIds?.[framework]??[]).some(id=>member.roles.cache.has(id));
export const canModerate=(member,cfg,guild)=>isModerator(member,cfg,guild);
export const canGrantFramework=(member,cfg,guild)=>!member?.user?.bot
 && (isAdmin(member,cfg,guild)||(cfg.approvers??[]).includes(member?.id??member?.user?.id));
export const canManageChannel=(member,cfg,guild,channel)=>canModerate(member,cfg,guild)
 && hasPermission(member,P.ManageChannels,channel);
export function canGrantRole(context) {try{assertSafeRole(context);return true;}catch{return false;}}
export function canPerformDangerousAction(member,cfg,guild,operation) {
 return isOwner(member,cfg,guild)&&['kick','ban','unban','purge'].includes(operation);
}
export function assertStaff(member,cfg,guild) {
 if(!canModerate(member,cfg,guild))throw new Error('Owner, Admin or Moderator authority required.');
}
export function assertHistoricalReviewer(member,cfg,guild) {
 if(member?.user?.bot||member?.guild?.id!==guild.id||!isOwner(member,cfg,guild))
  throw new Error('Only a configured human Owner may record historical framework access.');
}
