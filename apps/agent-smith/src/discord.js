import { Client, GatewayIntentBits, Partials, PermissionFlagsBits as P, OverwriteType, Routes } from 'discord.js';
import { config, assertWriteTarget } from './config.js';
import { assertOwnerConfiguration, assertSafeBot, assertSafeHierarchy, registerSecurityConfiguration } from './security-policy.js';
import { installSecurityGate } from './security-gate.js';
import { loginWhenAllowed } from './gateway-startup.js';
export async function connect({ allowWrites = false, waitForSession = false, onStartupState } = {}) {
  const cfg = config();
  if (allowWrites) assertWriteTarget(cfg);
  const makeClient = () => new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    ...(cfg.contentEnabled?[GatewayIntentBits.MessageContent]:[])],partials:[Partials.Message,Partials.Channel], allowedMentions: { parse: [] } });
  let client = makeClient();
  try {
    client.rest.setToken(cfg.token);
    await loginWhenAllowed({
      getGateway: () => client.rest.get(Routes.gatewayBot()),
      login: () => client.login(cfg.token),
      waitForSession,
      onStartupState,
      resetAfterSessionLimit: async () => {
        await client.destroy();
        client = makeClient();
        client.rest.setToken(cfg.token);
      },
    });
    if (!client.isReady()) await new Promise(resolve => client.once('clientReady', resolve));
    if (client.user.id !== cfg.clientId) throw new Error('Application ID does not match bot');
    const guild = await client.guilds.fetch(cfg.guildId);
    if (!cfg.owners.includes(guild.ownerId)) throw new Error('Target guild owner must be in OWNER_IDS');
    await guild.roles.fetch(); await guild.channels.fetch();
    registerSecurityConfiguration(guild, cfg);
    if (allowWrites) {
      assertOwnerConfiguration(cfg, guild.ownerId);
      const bot = await guild.members.fetchMe({ force: true });
      assertSafeBot(bot);
      assertSafeHierarchy(bot, await guild.members.fetch({ user: guild.ownerId, force: true }));
      const { pool } = await import('./db.js');
      installSecurityGate({ client, guild, cfg, readResources: async () =>
         (await pool.query('SELECT kind,name,discord_id FROM resources WHERE guild_id=$1', [guild.id])).rows,
         writeAudit: async (actor, action, detail) => {
           await pool.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)',
             [guild.id, actor, action, JSON.stringify(detail)]);
         } });
    }
    return { client, guild, cfg };
  } catch (error) {
    client.destroy();
    throw error;
  }
}
export const read = [P.ViewChannel, P.ReadMessageHistory, P.UseApplicationCommands];
export const write = [...read, P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.AddReactions, P.Connect, P.Speak];
export const botPermissions = [...write, P.ManageChannels, P.ManageRoles, P.ManageThreads];
// Discord permits setting MANAGE_ROLES in channel creation overwrites only to
// administrators. The bot retains it on its guild role, not in new overwrites.
export const botChannelPermissions = botPermissions.filter(permission => permission !== P.ManageRoles);
export function overwrites(guild, cfg, botId, gate, roles, readonly = false) {
  const entries = [{ id: guild.id, type: OverwriteType.Role, deny: [P.ViewChannel] }, { id: botId, type: OverwriteType.Member, allow: botChannelPermissions }];
  // The actual guild owner always bypasses overwrites; never attempt to edit it.
  for (const id of new Set([...cfg.owners, ...cfg.approvers])) {
    if (id !== guild.ownerId) entries.push({ id, type: OverwriteType.Member, allow: write });
  }
  if (gate !== 'staff') {
    const id = gate ? roles[gate] : guild.id;
    const allow = readonly ? read : write;
    const deny = readonly ? [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads] : [];
    if (id === guild.id) entries[0] = { id, type: OverwriteType.Role, allow, deny };
    else entries.push({ id, type: OverwriteType.Role, allow, deny });
  }
  return entries;
}
