import { PROTECTED_CHANNEL_NAMES, assertNotOwner, assertOwnerConfiguration, assertSafeBot, assertSafeHierarchy, assertSafeRole,
  assertCommandTree, mutationScope, securityLimits } from './security-policy.js';

// Every SDK REST write passes this gate, including workers, recovery and CLIs.
// Unknown management writes fail closed; no destructive admin APIs are exposed.
export function installSecurityGate({ client, guild, cfg, readResources }) {
  const original = client.rest.request.bind(client.rest);
  const limits = securityLimits();
  client.rest.request = async request => {
    const method = request.method.toUpperCase(), route = request.fullRoute, body = request.body ?? {};
    if (['GET', 'HEAD'].includes(method)) return original(request);
    const context = mutationScope();
    if (route.startsWith('/guilds/')) {
      if (!route.startsWith(`/guilds/${guild.id}/`)) throw new Error('Server-level reconfiguration and foreign guild writes are disabled.');
      await guild.fetch();
      assertOwnerConfiguration(cfg, guild.ownerId);
      await guild.roles.fetch();
      const bot = await guild.members.fetchMe({ force: true });
      assertSafeBot(bot);
      assertSafeHierarchy(bot, await guild.members.fetch({ user: guild.ownerId, force: true }));
      const memberRole = /^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/.exec(route);
      if (memberRole && ['PUT', 'DELETE'].includes(method)) {
        const [, uid, rid] = memberRole;
        assertNotOwner(guild, uid, cfg);
        if (uid === cfg.clientId || context?.kind !== 'roles' || context.subject !== uid) throw new Error('Role changes require an approved static workflow; bot self-management is disabled.');
        const rows = await readResources();
        const trackedNames = new Map(rows.filter(r => r.kind === 'role').map(r => [r.discord_id, r.name]));
        assertSafeRole({ role: guild.roles.cache.get(rid), bot, trackedNames,
          botRoleIds: [...bot.roles.cache.keys()] });
        return original(request);
      }
      const member = /^\/guilds\/\d+\/members\/(\d+)$/.exec(route);
      const ban = /^\/guilds\/\d+\/bans\/(\d+)$/.exec(route);
      if (member || ban) {
        const uid = (member ?? ban)[1];
        assertNotOwner(guild, uid, cfg);
        const op = ban ? (method === 'PUT' ? 'ban' : method === 'DELETE' ? 'unban' : null)
          : method === 'DELETE' ? 'kick' : method === 'PATCH' && Object.keys(body).every(k => k === 'communication_disabled_until')
            ? body.communication_disabled_until === null ? 'untimeout' : 'timeout' : null;
        if (!op || uid === cfg.clientId || context?.kind !== 'moderation'
          || context.operation !== op || context.subject !== uid || !cfg.owners.includes(context.actorId)) {
          throw new Error('Moderation requires the authenticated, validated interactive workflow; role replacement and nickname management are disabled.');
        }
        return original(request);
      }
      // No role/channel creation, deletion, positions, permission edits, bulk
      // bans, ownership transfer, guild reset, onboarding or Guide writes.
      throw new Error('Server administration is disabled through Smith; the Server Owner must perform this action manually.');
    }
    const channel = /^\/channels\/(\d+)(.*)$/.exec(route);
    if (channel) {
      const [, channelId, suffix] = channel;
      if (!suffix || suffix === '/messages/bulk-delete') {
        if (suffix === '/messages/bulk-delete' && method === 'POST') {
          await guild.fetch(); assertOwnerConfiguration(cfg, guild.ownerId);
          if (context?.kind !== 'moderation' || context.operation !== 'purge' || context.channel !== channelId
            || !context.confirmed || !cfg.owners.includes(context.actorId) || !Array.isArray(body.messages)
            || body.messages.some(id => !context.messageIds.includes(id))
            || body.messages.length < 1 || body.messages.length > limits.purge) throw new Error('Bulk message cleanup lacks a validated, bounded confirmation.');
          const rows = await readResources();
          assertSafeBot(await guild.members.fetchMe({ force: true }));
          if (rows.some(r => r.discord_id === channelId && (r.kind !== 'channel'
            || PROTECTED_CHANNEL_NAMES.has(r.name)))) {
            throw new Error('Protected channel cleanup is disabled.');
          }
          return original(request);
        }
        if (method === 'PATCH') {
          throw new Error('No authenticated channel-management command is implemented; use manual Owner action.');
        }
        throw new Error('Channel deletion is disabled, including protected categories and threads.');
      }
      if (/\/permissions\//.test(suffix)) throw new Error('Permission overwrite management requires manual Owner action.');
      // Posting, edits of bot messages, reactions and approved thread APIs are
      // ordinary communication; they cannot delete channels or roles.
      if (method === 'DELETE' && /^\/messages\/\d+$/.test(suffix)) {
        const messageId = suffix.split('/').at(-1);
        if (context?.kind !== 'moderation' || context.operation !== 'purge' || !context.confirmed
          || !cfg.owners.includes(context.actorId) || context.channel !== channelId
          || !context.messageIds.includes(messageId)) throw new Error('Individual message deletion requires confirmed bounded purge.');
        await guild.fetch(); assertOwnerConfiguration(cfg, guild.ownerId);
        const rows = await readResources();
        if (rows.some(r => r.discord_id === channelId && (r.kind !== 'channel' || PROTECTED_CHANNEL_NAMES.has(r.name)))) throw new Error('Protected channel cleanup is disabled.');
        const target = await guild.channels.fetch(channelId);
        const message = await target.messages.fetch({ message: messageId, force: true });
        assertNotOwner(guild, message.author.id, cfg);
        if (message.pinned || Date.now() - message.createdTimestamp >= 14 * 86400000 - 60000) throw new Error('Protected or expired purge target.');
        return original(request);
      }
      if (!/^\/messages(?:\/|$)|^\/threads(?:\/|$)|^\/typing$/.test(suffix)) throw new Error('Unknown channel write disabled.');
      const target = await client.channels.fetch(channelId);
      if (target.guildId && target.guildId !== guild.id) throw new Error('Foreign channel write.');
      if (!target.guildId) {
        const recipientId = target.recipientId ?? target.recipient?.id;
        if (context?.kind !== 'moderation' || context.operation !== 'warn'
          || !cfg.owners.includes(context.actorId) || recipientId !== context.subject) {
          throw new Error('Direct messages require the exact authenticated warning recipient.');
        }
        assertNotOwner(guild, recipientId, cfg);
      }
      return original(request);
    }
    if (/^\/users\/@me\/channels$/.test(route) && method === 'POST'
      && context?.kind === 'moderation' && context.operation === 'warn' && body.recipient_id === context.subject) {
      assertNotOwner(guild, body.recipient_id, cfg); return original(request);
    }
    if (/^\/applications\/\d+\/guilds\/\d+\/commands(?:\/\d+)?$/.test(route)) {
      if (!route.startsWith(`/applications/${cfg.clientId}/guilds/${guild.id}/`)) throw new Error('Foreign command management.');
      if (method === 'PUT') assertCommandTree(body);
      else if (method !== 'DELETE') throw new Error('Unsupported command management.');
      return original(request);
    }
    // Acknowledgements and ephemeral replies for this bot's interactions.
    if (method === 'POST' && /^\/interactions\/\d+\/[^/]+\/callback$/.test(route)) return original(request);
    if (route.startsWith(`/webhooks/${cfg.clientId}/`) && ['POST','PATCH','DELETE'].includes(method)) return original(request);
    throw new Error('Unknown privileged API write disabled.');
  };
}
