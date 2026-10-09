import { randomUUID } from 'node:crypto';
import { conversationIdentity } from './conversation-identity.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits as P } from 'discord.js';
import { hasPermission } from './permissions.js';
import { conversationSettings } from './conversation-settings.js';
import { createAIProvider } from './ai-provider.js';
import { createConversationService, isLocalConversation } from './ai-conversation.js';
import { buildConversationContext } from './conversation-context.js';
import { registerSmithCommand } from './conversation-commands.js';
import { splitDiscord, unavailable } from './ai-safety.js';
import { createConversationBudget, budgetStatusText } from './conversation-budget.js';
import { createBudgetStore } from './conversation-budget-store.js';
import { createConversationLookups } from './conversation-lookups.js';
import { createLookupWarnings } from './lookup-warnings.js';
import { registerSmithControlCommand } from './smith-control.js';

export async function conversationTrigger(message, { clientId, channelIds, triggers = [] }) {
  if (!message.guildId || message.author?.bot || message.author?.id === clientId || message.webhookId) return null;
  const content = message.content ?? '';
  if (!content.trim()) return null;
  const mention = new RegExp(`<@!?${clientId}>`, 'g');
  if (mention.test(content)) return content.replace(new RegExp(`<@!?${clientId}>`, 'g'), '').trim() || 'hello';
  if (message.reference?.messageId) {
    const reference = message.referencedMessage ?? await message.fetchReference().catch(() => null);
    if (reference?.author?.id === clientId) return content;
  }
  if (channelIds.includes(message.channelId) || message.channel?.isThread?.() && channelIds.includes(message.channel.parentId)) return content;
  const lower = content.toLowerCase();
  const trigger = triggers.find(value => lower === value || lower.startsWith(`${value} `) || lower.startsWith(`${value},`));
  return trigger ? content.slice(trigger.length).replace(/^[,\s]+/, '') || 'hello' : null;
}

export function createConversationHandlers({ client, guild, cfg, pool }, dependencies = {}) {
  const settings = dependencies.settings ?? conversationSettings();
  const provider = dependencies.provider ?? createAIProvider(settings);
  const budget = dependencies.budget ?? createConversationBudget({
    store: createBudgetStore({ pool, guildId: guild.id }), defaults: settings.dailyBudget,
  });
  const service = dependencies.service ?? createConversationService({ settings, provider, budget });
  const lookups = createConversationLookups({ client, guild, ...dependencies.lookupOptions });
  const lookupWarnings = createLookupWarnings({ client, guild, cfg, pool,
    snapshot: () => lookups.snapshot(), ...dependencies.warningOptions });
  const contextBuilder = dependencies.buildContext ?? (args => buildConversationContext({ guild, cfg, pool, ...args }));
  const build = args => lookups.run(async scope => ({
    ...await contextBuilder({ ...args, lookups: scope }), lookupVersion: scope.version,
  }));
  const pending = new Map(), seen = new Map();
  let registrationReady = false, registrationTimer, attempts = 0;
  const options = { clientId: cfg.clientId, channelIds: settings.channelIds, triggers: settings.triggers };
  const allowedMentions = { parse: [], repliedUser: false };
  const owner = id => cfg.owners.includes(id) && id === guild.ownerId;
  function statusText(userId) {
    const status = service.status();
    const lookupStatus = lookups.snapshot();
    return `Conversation AI: ${status.enabled ? 'enabled' : 'disabled'} · provider ${status.configured ? 'configured' : 'not configured'} · availability ${status.available === null ? 'not yet checked' : status.available ? 'last request succeeded' : 'unavailable'}.\nModel: ${status.model}. Slash registration: ${registrationReady ? 'ready' : 'pending'}.\nContext: ${settings.ttlMs / 60000} minutes. Plain dedicated-channel chat: ${cfg.contentEnabled ? 'Message Content enabled' : 'Message Content disabled'}.${
      owner(userId) && userId === cfg.ownerDiscordId ? `\nRequests: ${status.requests}; AI: ${status.aiRequests}; errors: ${status.errors}; rate limits: ${status.rateLimits}; cumulative AI latency: ${status.latencyMs}ms.\nLookup metrics (counts and cumulative milliseconds only): ${JSON.stringify(lookupStatus)}\nLookup warning health: ${JSON.stringify(lookupWarnings.status())}` : ''}`;
  }
  function sweep() {
    const time = Date.now();
    for (const [key, value] of pending) if (value.expires <= time) pending.delete(key);
    for (const [key, timeSent] of seen) if (time - timeSent > settings.ttlMs) seen.delete(key);
    while (pending.size > 500) pending.delete(pending.keys().next().value);
    while (seen.size > 1000) seen.delete(seen.keys().next().value);
  }
  const cleanupTimer = setInterval(sweep, 60000);
  cleanupTimer.unref?.();
  function controls(userId, channelId, substantial) {
    sweep();
    const token = randomUUID();
    const entry = { userId, channelId, expires: Date.now() + settings.ttlMs, substantial, busy: false };
    pending.set(token, entry);
    const button = (action, label) => new ButtonBuilder().setCustomId(`smith:chat:${action}:${token}`).setLabel(label).setStyle(ButtonStyle.Secondary);
    const buttons = [button('follow', 'Ask follow-up'), button('help', 'Server help')];
    if (substantial) buttons.push(button('thread', 'Create thread'));
    return { entry, row: new ActionRowBuilder().addComponents(...buttons) };
  }
  async function respond({ userId, channelId, text, channel, send, isPrivate = false }) {
    try {
    const context = await build({ userId, channelId });
    const bot = guild.members.me;
    if (!hasPermission(bot, channel.isThread?.() ? P.SendMessagesInThreads : P.SendMessages, channel))
      throw new Error('Bot cannot send in the requested channel.');
    let typing;
    if (!isPrivate && !isLocalConversation(text, context)) {
      await channel.sendTyping().catch(() => {});
      typing = setInterval(() => channel.sendTyping().catch(() => {}), 8000);
      typing.unref?.();
    }
    let answer;
    try { answer = await service.answer({ userId, channelId, text, context }); }
    finally { clearInterval(typing); }
    // Revalidate after the model call: an access revocation must not leak a late answer.
    const fresh = await build({ userId, channelId });
    if (fresh.accessSignature !== context.accessSignature) {
      service.clear(userId, channelId);
      answer = 'Your access changed during this conversation. Please ask again using your current permissions.';
    }
    const pieces = splitDiscord(answer);
    const { entry, row } = controls(userId, channelId, !isPrivate &&
      (answer.length > 1000 || (service.turnCount?.(userId, channelId) ?? 0) >= 3 || /\bthread\b/i.test(text)));
    for (let index = 0; index < pieces.length; index++) {
      lookups.assertFresh(fresh.lookupVersion);
      const message = await send({ content: pieces[index], allowedMentions,
        ...(index === pieces.length - 1 ? { components: [row] } : {}) }, index);
      if (index === pieces.length - 1) entry.messageId = message?.id;
    }
    } catch (error) {
      service.clear(userId, channelId);
      throw error;
    }
  }
  async function handleMessage(message) {
    if (message.guildId !== guild.id) return false;
    const text = await conversationTrigger(message, options);
    if (!text) return false;
    sweep();
    if (seen.has(message.id)) return true;
    seen.set(message.id, Date.now());
    const limit = service.reserve(message.author.id, owner(message.author.id));
    const send = payload => dependencies.sendScope ?
      dependencies.sendScope({ guild, userId: message.author.id, channelId: message.channelId }, () => message.reply(payload)) :
      message.reply(payload);
    if (!limit.allowed) {
      if (limit.warning) await send({ content: 'Please wait a few seconds before asking again.', allowedMentions }).catch(() => {});
      return true;
    }
    try {
      await respond({ userId: message.author.id, channelId: message.channelId, text, channel: message.channel,
        send });
    } catch {
      console.error('Smith conversation unavailable; no prompt or private data logged.');
      // No fallback send after an authorization failure.
    }
    return true;
  }
  async function handleInteraction(interaction) {
    const command = interaction.isChatInputCommand?.() && interaction.commandName === 'smith';
    const button = interaction.isButton?.() && interaction.customId.startsWith('smith:chat:');
    if (!command && !button) return false;
    // Preserve operational health and its existing staff authorization.
    if (command && interaction.options.getSubcommand() === 'status') return false;
    if (interaction.guildId !== guild.id || interaction.user.bot) return true;
    try {
      if (button) {
        const [, , action, token] = interaction.customId.split(':');
        sweep();
        const entry = pending.get(token);
        if (!entry || entry.userId !== interaction.user.id || entry.channelId !== interaction.channelId ||
            entry.messageId !== interaction.message.id) {
          await interaction.reply({ content: 'This conversation control is expired or belongs to another member.', flags: 64 });
          return true;
        }
        await interaction.deferReply({ flags: 64 });
        if (action === 'follow') {
          await interaction.editReply('Reply to my message, mention me again, or use /smith ask. Your recent context is kept briefly for you only.');
        } else if (action === 'help') {
          await build({ userId: interaction.user.id, channelId: interaction.channelId });
          await interaction.editReply('Use /smith ask for a private question, /profile for your XP, /interest for interests, or /request for human-approved additional framework access.');
        } else if (action === 'thread') {
          if (!entry.substantial || entry.busy || entry.threadId) {
            await interaction.editReply(entry.threadId ? `Continue in <#${entry.threadId}>.` : 'A thread request is already in progress.');
            return true;
          }
          entry.busy = true;
          try {
            const sourceContext = await build({ userId: interaction.user.id, channelId: interaction.channelId });
            const member = await guild.members.fetch({ user: interaction.user.id, force: true });
            const channel = interaction.channel;
            if (channel.isThread?.() || !interaction.message.startThread ||
                ![member, guild.members.me].every(actor => hasPermission(actor, P.CreatePublicThreads, channel) &&
                  hasPermission(actor, P.SendMessagesInThreads, channel)))
              throw new Error('Thread creation is not allowed here.');
            lookups.assertFresh(sourceContext.lookupVersion);
            const thread = await interaction.message.startThread({ name: 'Agent Smith conversation', autoArchiveDuration: 60 });
            entry.threadId = thread.id;
            const threadContext = await build({ userId: interaction.user.id, channelId: thread.id });
            service.move(interaction.user.id, entry.channelId, thread.id, threadContext.accessSignature);
            await interaction.editReply({ content: `Continue in <#${thread.id}>; mention Smith or reply to his messages.`, allowedMentions });
          } finally { entry.busy = false; }
        }
        return true;
      }
      const action = interaction.options.getSubcommand();
      const isPrivate = action !== 'ask' || interaction.options.getBoolean('private') !== false;
      await interaction.deferReply(isPrivate ? { flags: 64 } : {});
      if (action === 'budget') {
        // Settings are an explicit human Owner action, never model-controlled.
        const freshGuild = await guild.fetch();
        if (!cfg.owners.includes(interaction.user.id) || interaction.user.id !== freshGuild.ownerId ||
            cfg.ownerDiscordId !== interaction.user.id) {
          await interaction.editReply('Only the configured human Server Owner can view or change this budget.');
          return true;
        }
        const requests = interaction.options.getInteger('requests');
        const tokens = interaction.options.getInteger('tokens');
        const timezone = interaction.options.getString('timezone');
        const editing = [requests, tokens, timezone].some(value => value !== null);
        if (editing && [requests, tokens, timezone].some(value => value === null)) {
          await interaction.editReply('To change the allowance, supply requests, tokens and timezone together. No settings changed.');
          return true;
        }
        try {
          const state = editing ? await budget.configure({ requests, tokens, timezone }, interaction.user.id) : await budget.status();
          await interaction.editReply(budgetStatusText(state));
        } catch (error) {
          await interaction.editReply(error.message.startsWith('Use an IANA') || error.message === 'Invalid reset timezone.'
            ? error.message : 'Budget storage is unavailable; no change is confirmed. Paid AI fails closed; server functions remain available.');
        }
      } else if (action === 'clear-context') {
        service.clear(interaction.user.id);
        await interaction.editReply('Your temporary conversation context has been cleared.');
      } else if (action === 'about') {
        await interaction.editReply(conversationIdentity(guild, settings));
      } else if (action === 'help') {
        await interaction.editReply('Mention me, reply to one of my messages, or use /smith ask (private by default). Configured Smith channels support plain conversation when Message Content is enabled. Use /smith clear-context to forget your short-lived history. Conversation never changes access or moderation.');
      } else if (action === 'ask') {
        const limit = service.reserve(interaction.user.id, owner(interaction.user.id));
        if (!limit.allowed) await interaction.editReply('Please wait a few seconds before asking again.');
        else await respond({ userId: interaction.user.id, channelId: interaction.channelId,
          text: interaction.options.getString('question', true), channel: interaction.channel, isPrivate,
          send: (payload, index) => index === 0 ? interaction.editReply(payload) : interaction.followUp({ ...payload, ...(isPrivate ? { flags: 64 } : {}) }) });
      }
    } catch {
      console.error('Smith conversation interaction failed; private request content omitted.');
      try {
        const payload = { content: unavailable, components: [], allowedMentions };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: 64 });
      } catch { /* Expired Discord interaction; core bot remains operational. */ }
    }
    return true;
  }
  async function register() {
    attempts++;
    try {
      await registerSmithCommand({ client, cfg, guild });
      await registerSmithControlCommand({ client, cfg, guild });
      registrationReady = true;
    }
    catch {
      console.error('Smith conversational slash registration unavailable; existing commands remain unchanged.');
      if (attempts < 5) { registrationTimer = setTimeout(register, 60000); registrationTimer.unref?.(); }
    }
  }
  return { handleMessage, handleInteraction, register, lookupWarnings,
    appendStatus: interaction => interaction.followUp({ content: statusText(interaction.user.id), flags: 64, allowedMentions }),
    stop() { clearTimeout(registrationTimer); clearInterval(cleanupTimer); lookupWarnings.stop(); lookups.stop(); service.stop(); pending.clear(); seen.clear(); } };
}
