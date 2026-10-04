import { Client, GatewayIntentBits, PermissionFlagsBits as P } from 'discord.js';
import { config } from './config.js';
export async function connect() {
  const cfg = config();
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], allowedMentions: { parse: [] } });
  await client.login(cfg.token);
  if (!client.isReady()) await new Promise(resolve => client.once('clientReady', resolve));
  if (client.user.id !== cfg.clientId) throw new Error('Application ID does not match bot');
  const guild = await client.guilds.fetch(cfg.guildId);
  if (!cfg.owners.includes(guild.ownerId)) throw new Error('Target guild owner must be in OWNER_IDS');
  await guild.roles.fetch(); await guild.channels.fetch();
  return { client, guild, cfg };
}
export const read = [P.ViewChannel, P.ReadMessageHistory, P.UseApplicationCommands];
export const write = [...read, P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.AddReactions, P.Connect, P.Speak];
export const botPermissions = [...write, P.ManageChannels, P.ManageRoles, P.ManageThreads];
export function overwrites(guild, cfg, botId, gate, roles, readonly = false) {
  const entries = [{ id: guild.id, deny: [P.ViewChannel] }, { id: botId, allow: botPermissions }];
  for (const id of new Set([...cfg.owners, ...cfg.approvers])) entries.push({ id, allow: write });
  if (gate !== 'staff') {
    const id = gate ? roles[gate] : guild.id;
    const allow = readonly ? read : write;
    const deny = readonly ? [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads] : [];
    if (id === guild.id) entries[0] = { id, allow, deny };
    else entries.push({ id, allow, deny });
  }
  return entries;
}
