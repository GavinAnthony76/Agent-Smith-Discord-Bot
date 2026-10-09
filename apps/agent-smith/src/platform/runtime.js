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
import { createWelcomeService } from './welcome.js';
import { createOnboardingService } from './onboarding.js';
import { createEconomyService } from './economy.js';
import { registerPlatformCommands } from './commands.js';
import { PlatformError } from './catalog.js';
import { createActivation, STANDARD_MODULES } from './activation.js';
import { createSelfRoleService } from './roles.js';
import { loadReviewedConfiguration, seedReviewedConfiguration } from './release-config.js';
import { createAcceptanceResources } from './acceptance-resources.js';

/**
 * Shares the existing Discord client. Never logs in, migrates or provisions
 * Discord resources. Hallowed Core's guarded modules remain the legacy adapter.
 */
export function createPlatformRuntime({ client, pool, cfg, legacyActions, env = process.env }) {
  const discord = createDiscordAccess({ client });
  const origin = env.PLATFORM_PUBLIC_URL;
  const activation = createActivation({ pool, client, env });
  const tickets = createTicketService({ client, pool, discord });
  async function requireActive(guildId) {
    if (!await activation.active(guildId)) throw new PlatformError('standard_guild_runtime_not_active', 409);
  }
  const web = createPlatformHttp({ pool, discord, origin, env, legacyActions,
    runtimeStatus: activation.status,
    acceptanceActions: async authority => {
      const ids = await acceptanceResources.prepare(authority);
      const roleAuthority = await web.service.authorize(authority.actor.id,authority.guild.id,'roles',true);
      const roleSettings = await moduleConfig(authority.guild.id,'roles');
      if (!roleSettings.configuration.selfAssignableRoles.includes(ids.roleId)) {
        await web.service.updateModule(roleAuthority,'roles',{enabled:roleSettings.enabled,revision:roleSettings.revision,
          configuration:{...roleSettings.configuration,
            selfAssignableRoles:[...roleSettings.configuration.selfAssignableRoles,ids.roleId]}});
      }
      const ticketAuthority = await web.service.authorize(authority.actor.id,authority.guild.id,'tickets',true);
      const existing = (await pool.query(`SELECT record_id FROM platform_records WHERE guild_id=$1
        AND collection='ticket-panels' AND title='LMOC TEST disposable acceptance panel'`, [authority.guild.id])).rows;
      if (existing.length > 1) throw new PlatformError('acceptance_panel_duplicates_require_review',409);
      const panel = existing[0] ?? await web.service.saveRecord(ticketAuthority,'ticket-panels',{
        title:'LMOC TEST disposable acceptance panel',
        data:{description:'Disposable live acceptance ticket. No real support evidence.',buttonLabel:'Open test ticket',
          publishChannelId:ids.channelId,categoryId:ids.categoryId,ticketType:'Other',supportRoles:[],questions:[],enabled:true},
      });
      const panelId = panel.record_id ?? panel.id;
      const stored = (await pool.query(`SELECT data,revision FROM platform_records WHERE guild_id=$1
        AND collection='ticket-panels' AND record_id=$2`, [authority.guild.id,panelId])).rows[0];
      if (!stored || stored.data.categoryId !== ids.categoryId || stored.data.publishChannelId !== ids.channelId ||
          stored.data.supportRoles?.length || stored.data.publishedMessageId &&
          stored.data.publishedRevision !== stored.revision)
        throw new PlatformError('acceptance_panel_drift_requires_review',409);
      // No automatic duplicate message publication on repeated setup.
      if (!stored?.data.publishedMessageId) {
        const reserved = await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
          VALUES($1,'acceptance-publication','ticket-panel','Test panel publication','{"status":"creating"}',$2)
          ON CONFLICT DO NOTHING RETURNING record_id`, [authority.guild.id,authority.actor.id]);
        if (!reserved.rowCount) throw new PlatformError('acceptance_panel_publication_uncertain_inspect_before_retry',409);
        await tickets.staffAction(ticketAuthority,{action:'ticket-publish',target:panelId});
        await pool.query(`UPDATE platform_records SET data='{"status":"confirmed"}' WHERE guild_id=$1
          AND collection='acceptance-publication' AND record_id='ticket-panel'`, [authority.guild.id]);
      }
      const onboardingAuthority = await web.service.authorize(authority.actor.id,authority.guild.id,'onboarding',true);
      const onboardingConfig = await moduleConfig(authority.guild.id,'onboarding');
      const entry = (await pool.query(`SELECT data FROM platform_records WHERE guild_id=$1
        AND collection='onboarding-entry' AND record_id=$2`,
      [authority.guild.id,`entry:${onboardingConfig.revision}`])).rows[0];
      if (entry && entry.data.status !== 'confirmed')
        throw new PlatformError('acceptance_onboarding_entry_uncertain_inspect_before_retry',409);
      if (!entry) await onboarding.publish(onboardingAuthority);
      const economyAuthority = await web.service.authorize(authority.actor.id,authority.guild.id,'economy',true);
      const shop = (await pool.query(`SELECT 1 FROM platform_records WHERE guild_id=$1
        AND collection='shop' AND title='LMOC TEST disposable acceptance token'`, [authority.guild.id])).rowCount;
      if (!shop) await web.service.saveRecord(economyAuthority,'shop',{
        title:'LMOC TEST disposable acceptance token',data:{price:5,enabled:true},
      });
      return {ok:true,message:`Disposable LMOC TEST role/category/panel prepared. Cosmetic role ${ids.roleId}; panel channel ${ids.channelId}.`};
    },
    ticketActions: async (authority, input) => {
      await requireActive(authority.guild.id); return tickets.staffAction(authority, input);
    },
    onboardingActions: async authority => {
      await requireActive(authority.guild.id); return onboarding.publish(authority);
    } });
  const acceptanceResources = createAcceptanceResources({client,pool,discord,env,requireActive});
  setPlatformTransportGuard(client, communicationGuard);
  const conversations = new Map();
  let heartbeat;
  const activity = createActivityService(pool);
  const welcome = createWelcomeService({ pool, discord, moduleConfig });
  const onboarding = createOnboardingService({ client, pool, discord, moduleConfig });
  const economy = createEconomyService({ pool, moduleConfig });
  const selfRoles = createSelfRoleService({ client, pool, discord, moduleConfig });
  async function moduleConfig(guildId, key) {
    if (!STANDARD_MODULES.includes(key) || !await activation.active(guildId))
      return { enabled: false, configuration: {}, revision: 0 };
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
  async function recordActivity(kind, guildId, eventKey, userId, channelId, occurredAt = Date.now()) {
    if (!await activation.acceptsEvent(guildId,occurredAt)) return;
    const row = (await pool.query('SELECT installed FROM platform_guilds WHERE guild_id=$1', [guildId])).rows[0];
    if (!row?.installed) return;
    const settings = await moduleConfig(guildId, 'analytics');
    if (!settings.enabled || settings.configuration.collectActivity === false) return;
    // Hash identity; never retain message body, voice audio or moderation evidence.
    await pool.query(
       `INSERT INTO platform_activity(guild_id,event_key,kind,channel_id,user_hash,occurred_at)
        SELECT $1,$2,$3,$4,$5,to_timestamp($6 / 1000.0) FROM platform_runtime_state WHERE guild_id=$1
        AND runtime_active AND activated_at<=to_timestamp($6 / 1000.0) AND last_seen_at>now()-interval '90 seconds'
        ON CONFLICT DO NOTHING`,
      [guildId, eventKey, kind, channelId ?? null,
         userId ? createHash('sha256').update(`${guildId}:${userId}`).digest('hex') : null, occurredAt]);
  }
  const events = {
    guildCreate: guild => {
      if (!activation.allowed.has(guild.id)) return;
      void activation.refresh(guild.id).then(active => active && registerPlatformCommands({client,pool,discord,
        guildId:guild.id,applicationId:cfg.clientId})).catch(() => console.error('Platform guild initialization/command registration deferred.'));
    },
    guildDelete: guild => {
      if (!activation.allowed.has(guild.id)) return;
      void pool.query('UPDATE platform_guilds SET installed=false,updated_at=now() WHERE guild_id=$1', [guild.id]).catch(() => {});
    },
    guildMemberAdd: member => {
      if (!activation.allowed.has(member.guild.id)) return;
      void recordActivity('join', member.guild.id, `join:${member.id}:${Date.now()}`, member.id).catch(() => {});
      void welcome.join(member).catch(() => console.error('Welcome delivery held; no automatic resend.'));
    },
    guildMemberRemove: member => {
      if (activation.allowed.has(member.guild.id)) void recordActivity('leave', member.guild.id, `leave:${member.id}:${Date.now()}`, member.id).catch(() => {});
    },
    messageCreate: message => {
      if (!activation.allowed.has(message.guildId) || message.author.bot || message.webhookId) return;
      void recordActivity('message', message.guildId, message.id, message.author.id, message.channelId,
        message.createdTimestamp).catch(() => {});
      if (message.guildId !== cfg.guildId) void moduleConfig(message.guildId, 'leveling').then(async settings => {
        if (settings.enabled && await activation.acceptsEvent(message.guildId,message.createdTimestamp))
          await activity.awardText(message, settings.configuration);
      }).catch(() => console.error('Platform XP unavailable; no message content logged.'));
    },
  };
  for (const [event, handler] of Object.entries(events)) client.on(event, handler);
  return {
    handler: web.handler, service: web.service,
    async handleMessage(message) {
      if (!activation.allowed.has(message.guildId) || !await activation.active(message.guildId)) return false;
      if (message.guildId === cfg.guildId && !(await pool.query(
        `SELECT 1 FROM platform_modules WHERE guild_id=$1 AND module_key='ai'`, [cfg.guildId])).rows.length) return false;
      const handlers = await conversation(message.guildId);
      if (handlers) await handlers.handleMessage(message);
      // Once the dashboard owns this AI module, do not fall through to old settings.
      return true;
    },
    async handleInteraction(interaction) {
      if (!activation.allowed.has(interaction.guildId) || !await activation.active(interaction.guildId)) return false;
      if (interaction.guildId && await tickets.handleInteraction(interaction)) return true;
      if (interaction.guildId && await onboarding.handleInteraction(interaction)) return true;
      if (interaction.isChatInputCommand?.() && interaction.commandName === 'smith-community' &&
          interaction.guildId && interaction.guildId !== TARGET_GUILD_ID) {
        await interaction.deferReply({flags:64});
        try {
          const guild=await discord.freshGuild(interaction.guildId);
          const member=await guild.members.fetch({user:interaction.user.id,force:true});
          const channel=guild.channels.cache.get(interaction.channelId);
          if(member.pending!==false||member.user.bot||!discord.memberRolesVerified(guild,member)||
            !channel||!hasPermission(member,P.ViewChannel,channel)||!hasPermission(member,P.ReadMessageHistory,channel))
            throw new PlatformError('community_member_not_eligible',403);
          const command=interaction.options.getSubcommand();
          let content;
          if(command==='role-select'||command==='role-remove'){
            const result = await selfRoles.assign({guildId:guild.id,memberId:member.id,
              roleId:interaction.options.getRole('role',true).id,
              operation:command==='role-remove'?'remove':'add'});
            content = result.alreadyAssigned ? 'That cosmetic role is already selected.' :
              result.alreadyRemoved ? 'That cosmetic role is already removed.' :
                command==='role-remove'?'Cosmetic role removed.':'Cosmetic role selected.';
          }else if(command==='daily'||command==='buy'){
            const result=await economy.change({guildId:guild.id,userId:member.id,interactionId:interaction.id,kind:command,
              ...(command==='buy'?{itemId:interaction.options.getString('item',true),
                expectedPrice:interaction.options.getInteger('price',true)}:{})});
            content=`${command==='daily'?'Daily claimed':'Cosmetic item purchased'}. Balance: ${result.balance} ${result.currencyName}. No real-money value.`;
          }else if(command==='shop'){
            const rows=await economy.shop(guild.id);
            content=rows.length?rows.map(row=>`${row.title} · ${row.price} ${row.currencyName} · ID ${row.id}`).join('\n'):'No enabled cosmetic shop items.';
          }else if(command==='balance'||command==='inventory'){
            const value=await economy.wallet(guild.id,member.id);
            content=command==='balance'?`${value.balance} ${value.currencyName}. No real-money value.`:
              value.inventory.length?value.inventory.map(row=>row.title).join('\n'):'Your cosmetic inventory is empty.';
          }else throw new PlatformError('community_command_not_available',409);
          await interaction.editReply({content:safeText(content,1900),allowedMentions:{parse:[],repliedUser:false}});
        }catch(error){await interaction.editReply(error instanceof PlatformError?
          `Community action refused: ${error.code}.`:'Community action could not be confirmed. Inspect your balance/inventory before trying again.');}
        return true;
      }
      if (!interaction.guildId || !(
        interaction.isChatInputCommand?.() && interaction.commandName === 'smith' &&
          (interaction.guildId !== cfg.guildId || interaction.options.getSubcommand() !== 'status') ||
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
      if (env.PLATFORM_LMOC_CONFIG_SHA256) await seedReviewedConfiguration({
        pool,client,env,bundle:await loadReviewedConfiguration(),
      });
      for (const guild of client.guilds.cache.values()) {
        if (!activation.allowed.has(guild.id) || !await activation.refresh(guild.id)) continue;
        await registerPlatformCommands({client,pool,discord,guildId:guild.id,applicationId:cfg.clientId});
      }
      heartbeat = setInterval(() => {
        for (const guildId of activation.allowed.ids)
          void activation.refresh(guildId).catch(() => console.error('Platform heartbeat unavailable.'));
      }, 20000);
      heartbeat.unref();
    },
    stop() {
      clearInterval(heartbeat);
      void activation.stop().catch(() => {});
      tickets.stop();
      onboarding.stop();
      for (const [event, handler] of Object.entries(events)) client.off(event, handler);
      for (const value of conversations.values()) value.handlers.stop();
      conversations.clear();
    },
  };
}
