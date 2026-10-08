import { createHash } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord.js';
import { createPlatformHttp } from './http.js';
import { createDiscordAccess } from './discord-access.js';
import { defaultModule } from './service.js';
import { createConversationHandlers } from '../conversation-handler.js';
import { conversationSettings } from '../conversation-settings.js';
import { hasPermission } from '../permissions.js';
import { safeText } from '../ai-safety.js';
import { TARGET_GUILD_ID } from '../config.js';
import { communicationGuard, setPlatformTransportGuard, withPlatformCommunication } from './transport.js';
import { createAIProvider } from '../ai-provider.js';
import { meterProvider } from './ai-usage.js';
import { createActivityService } from './activity.js';
import { createTicketService } from './tickets.js';

/**
 * Shares the existing Discord client. Never logs in, migrates or provisions
 * Discord resources. Hallowed Core's guarded modules remain the legacy adapter.
 */
export function createPlatformRuntime({ client, pool, cfg, legacyActions }) {
  const discord = createDiscordAccess({ client });
  const origin = process.env.PLATFORM_PUBLIC_URL;
  const tickets = createTicketService({ client, pool, discord });
  const web = createPlatformHttp({ pool, discord, origin, legacyActions, ticketActions: tickets.staffAction });
  setPlatformTransportGuard(client, communicationGuard);
  const conversations = new Map();
  const activity = createActivityService(pool);
  async function moduleConfig(guildId, key) {
    const row = (await pool.query(
      'SELECT enabled,configuration_json,revision FROM platform_modules WHERE guild_id=$1 AND module_key=$2',
      [guildId, key])).rows[0];
    const base = defaultModule(key, guildId === TARGET_GUILD_ID, process.env);
    return row ? { enabled: row.enabled, configuration: { ...base.configuration, ...row.configuration_json }, revision: row.revision } : base;
  }
  async function genericContext(guild, userId, channelId) {
    const member = await guild.members.fetch({ user: userId, force: true });
    if (member.pending !== false || member.user.bot) throw new Error('Member not eligible.');
    const [roles, channels] = await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
    // Returned authoritative lists, not potentially non-evicted cached ghosts.
    if ([...member.roles.cache.keys()].some(id => !roles.has(id))) throw new Error('Member roles could not be freshly verified.');
    const channel = channels.get(channelId) ?? await guild.channels.fetch(channelId);
    const bot = await guild.members.fetchMe({ force: true });
    if (!channel || !hasPermission(member, P.ViewChannel, channel) ||
        !hasPermission(member, P.ReadMessageHistory, channel) || !hasPermission(bot, P.ViewChannel, channel)) throw new Error('Channel not authorized.');
    if (channel.type === 12) {
      for (const actor of [member, bot]) {
        if (!hasPermission(actor, P.ManageThreads, channel)) await channel.members.fetch(actor.id);
      }
    }
    const visible = [...channels.values()].filter(c => !c.isThread?.() &&
      hasPermission(member, P.ViewChannel, c) && hasPermission(bot, P.ViewChannel, c));
    const mapped = visible.map(c => ({ id: c.id, name: safeText(c.name, 100), topic: safeText(c.topic, 500),
      type: c.type, framework: null, tags: (c.availableTags ?? []).map(t => safeText(t.name, 80)) }));
    const signature = [[...member.roles.cache.keys()].sort(),
      mapped.map(c => c.id).sort(), channel.id];
    return { accessSignature: createHash('sha256').update(JSON.stringify(signature)).digest('hex'),
      server: { name: safeText(guild.name, 100), frameworks: [], events: [], rewards: [],
        rulesChannelId: mapped.find(c => c.id === guild.rulesChannelId)?.id ?? null,
        achievementTracking: false, accessProcess: 'Follow the server’s configured onboarding. Additional protected access requires human approval.' },
      member: { displayName: safeText(member.displayName, 80), primaryFramework: null, frameworks: [],
        interests: [], availableInterests: [], cosmeticBadges: [], progression: [],
        roles: [...member.roles.cache.values()].filter(r => r.id !== guild.id).map(r => safeText(r.name, 80)) },
      channels: mapped };
  }
  async function conversation(guildId) {
    const value = await moduleConfig(guildId, 'ai');
    if (!value.enabled) {
      conversations.get(guildId)?.handlers.stop();
      conversations.delete(guildId);
      return null;
    }
    const current = conversations.get(guildId);
    if (current?.revision === value.revision) return current.handlers;
    current?.handlers.stop();
    const guild = await client.guilds.fetch(guildId);
    await web.service.adopt(guild);
    const guildCfg = guildId === cfg.guildId ? cfg : {
      ...cfg, guildId, owners: [guild.ownerId], ownerDiscordId: guild.ownerId, approvers: [],
    };
    const config = value.configuration;
    const settings = { ...conversationSettings(), enabled: true, model: config.model,
      channelIds: config.allowedChannels, maxTokens: config.maxTokens,
      ttlMs: config.ttlMinutes * 60000, cooldownMs: config.cooldownSeconds * 1000,
      personalityAdditions: config.personalityAdditions, genericServer: guildId !== cfg.guildId };
    const handlers = createConversationHandlers({ client, guild, cfg: guildCfg, pool }, {
      settings,
      provider: meterProvider({ provider: createAIProvider(settings), pool, guildId }),
      sendScope: withPlatformCommunication,
      ...(guildId === cfg.guildId ? {} : { buildContext: ({ userId, channelId }) => genericContext(guild, userId, channelId) }),
    });
    conversations.set(guildId, { revision: value.revision, handlers });
    return handlers;
  }
  async function recordActivity(kind, guildId, eventKey, userId, channelId) {
    const row = (await pool.query('SELECT installed FROM platform_guilds WHERE guild_id=$1', [guildId])).rows[0];
    if (!row?.installed) return;
    const settings = await moduleConfig(guildId, 'analytics');
    if (!settings.enabled || settings.configuration.collectActivity === false) return;
    // Hash identity; never retain message body, voice audio or moderation evidence.
    await pool.query(
      `INSERT INTO platform_activity(guild_id,event_key,kind,channel_id,user_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [guildId, eventKey, kind, channelId ?? null,
        userId ? createHash('sha256').update(`${guildId}:${userId}`).digest('hex') : null]);
  }
  const events = {
    guildCreate: guild => { void web.service.adopt(guild).catch(() => console.error('Platform guild initialization deferred.')); },
    guildDelete: guild => { void pool.query('UPDATE platform_guilds SET installed=false,updated_at=now() WHERE guild_id=$1', [guild.id]).catch(() => {}); },
    guildMemberAdd: member => { void recordActivity('join', member.guild.id, `join:${member.id}:${Date.now()}`, member.id).catch(() => {}); },
    guildMemberRemove: member => { void recordActivity('leave', member.guild.id, `leave:${member.id}:${Date.now()}`, member.id).catch(() => {}); },
    messageCreate: message => {
      if (!message.guildId || message.author.bot || message.webhookId) return;
      void recordActivity('message', message.guildId, message.id, message.author.id, message.channelId).catch(() => {});
      if (message.guildId !== cfg.guildId) void moduleConfig(message.guildId, 'leveling').then(async settings => {
        if (settings.enabled) await activity.awardText(message, settings.configuration);
      }).catch(() => console.error('Platform XP unavailable; no message content logged.'));
    },
  };
  for (const [event, handler] of Object.entries(events)) client.on(event, handler);
  return {
    handler: web.handler, service: web.service,
    async handleMessage(message) {
      if (!message.guildId) return false;
      if (message.guildId === cfg.guildId && !(await pool.query(
        `SELECT 1 FROM platform_modules WHERE guild_id=$1 AND module_key='ai'`, [cfg.guildId])).rows.length) return false;
      const handlers = await conversation(message.guildId);
      if (handlers) await handlers.handleMessage(message);
      // Once the dashboard owns this AI module, do not fall through to old settings.
      return true;
    },
    async handleInteraction(interaction) {
      if (interaction.guildId && await tickets.handleInteraction(interaction)) return true;
      if (!interaction.guildId || !(
        interaction.isChatInputCommand?.() && interaction.commandName === 'smith' && interaction.options.getSubcommand() !== 'status' ||
        interaction.isButton?.() && interaction.customId.startsWith('smith:chat:')
      )) return false;
      if (interaction.guildId === cfg.guildId && !(await pool.query(
        `SELECT 1 FROM platform_modules WHERE guild_id=$1 AND module_key='ai'`, [cfg.guildId])).rows.length) return false;
      const handlers = await conversation(interaction.guildId);
      if (handlers) return handlers.handleInteraction(interaction);
      await interaction.reply({ content: 'Conversation is disabled for this server. Existing server controls remain available.', flags: 64 });
      return true;
    },
    async initialize() {
      for (const guild of client.guilds.cache.values()) await web.service.adopt(guild);
    },
    stop() {
      tickets.stop();
      for (const [event, handler] of Object.entries(events)) client.off(event, handler);
      for (const value of conversations.values()) value.handlers.stop();
      conversations.clear();
    },
  };
}
