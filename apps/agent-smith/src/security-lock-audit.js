import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { categories, ARRIVAL_CHANNEL_ID } from './blueprint.js';
import { overwrites } from './discord.js';
import { hasPermission } from './permissions.js';

export function auditProtectedLocks({guild,cfg,client,rows}) {
  const failures=[];
  const id=(kind,name)=>rows.find(row=>row.kind===kind&&row.name===name)?.discord_id;
  const roles=Object.fromEntries(rows.filter(row=>row.kind==='role').map(row=>[row.name,row.discord_id]));
  const norm=entries=>entries.map(entry=>`${entry.id}:${entry.type}:${new PermissionsBitField(entry.allow).bitfield}:${new PermissionsBitField(entry.deny).bitfield}`).sort().join('|');
  for(const category of categories) {
    const expectedParent=id('channel',category.name);
    const parent=guild.channels.cache.get(expectedParent);
    if(!parent || parent.name!==category.name || parent.type!==4)failures.push(`Missing or changed protected category ${category.name}`);
    const protectedChildren=category.channels.filter(([, ,readonly])=>readonly || category.gate==='staff' || !category.gate);
    for(const [name] of [[category.name],...protectedChildren]) {
      const channel=guild.channels.cache.get(id('channel',name));
      if(!channel || channel.name!==name){failures.push(`Missing protected channel/category ${name}`);continue;}
      if(name!==category.name && channel.parentId!==expectedParent)failures.push(`Protected placement changed: ${name}`);
      if(name==='arrival-lounge') {
        if(channel.id!==ARRIVAL_CHANNEL_ID || channel.rateLimitPerUser!==5
          || ![P.ViewChannel,P.ReadMessageHistory,P.SendMessages].every(p=>hasPermission(guild.roles.everyone,p,channel)))failures.push('Arrival channel identity, slowmode or public access changed');
        continue;
      }
      const readonly=category.channels.find(([child])=>child===name)?.[2]??false;
      const expected=overwrites(guild,cfg,client.user.id,category.gate,roles,readonly);
      if(norm([...channel.permissionOverwrites.cache.values()])!==norm(expected))failures.push(`Protected permission overwrites drifted: ${name}`);
    }
  }
  return failures;
}
export function nativePrimaryIsSafe(onboarding) {
  // discord.js exposes Collection objects, not arrays; normalize explicitly.
  const prompts=[...onboarding.prompts.values()].filter(prompt=>[...prompt.options.values()]
    .some(option=>[...option.roles.values()].some(role=>role?.name.startsWith('Selection: '))));
  if(prompts.length!==1 || !prompts[0].singleSelect)return false;
  const options=[...prompts[0].options.values()];
  return options.length===3 && ['Faith','Gaming','Tech'].every(framework=>options.some(option=>{
    const roles=[...option.roles.values()];
    return roles.length===1 && roles[0]?.name===`Selection: ${framework}`;
  }));
}
