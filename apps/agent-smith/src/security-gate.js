import { PROTECTED_CHANNEL_NAMES, assertNotOwner, assertOwnerConfiguration, assertSafeBot, assertSafeHierarchy, assertSafeRole,
  assertCommandTree, mutationScope, securityLimits } from './security-policy.js';
import { withPrivilegedPipeline } from './privileged-pipeline.js';
import { protectedResources, assertUnprotected } from './protected-resources.js';
import { assertPermission, assertHigherRole, assertRoleChannelGrants } from './permissions.js';
import { PermissionFlagsBits as P } from 'discord.js';
import { moderationPermissions, assertTarget } from './moderation-policy.js';
import { canModerate,canGrantFramework } from './authorization.js';
import { smithCommand } from './conversation-commands.js';
import { isLookupWarningContent } from './lookup-warning-policy.js';
import { smithControlCommand } from './smith-control.js';
import { platformTransportAllowed } from './platform/transport.js';

// Every SDK REST write passes this gate, including workers, recovery and CLIs.
// Unknown management writes fail closed; no destructive admin APIs are exposed.
export function installSecurityGate({ client, guild, cfg, readResources, writeAudit }) {
  const original = client.rest.request.bind(client.rest);
  const limits = securityLimits();
  client.rest.request = async request => {
    const method = request.method.toUpperCase(), route = request.fullRoute, body = request.body ?? {};
    if (['GET', 'HEAD'].includes(method)) return original(request);
    if (platformTransportAllowed(client, request)) return original(request);
    const context = mutationScope();
    async function lookupWarningOwner(recipientId) {
      if (recipientId !== cfg.ownerDiscordId || recipientId !== context.subject)
        throw new Error('Lookup warnings require the exact configured Owner.');
      await guild.fetch();
      assertOwnerConfiguration(cfg, guild.ownerId);
      await context.authorize();
    }
    const privileged = (validate = async () => {}) => withPrivilegedPipeline({
      action: { operation: context?.operation ?? method.toLowerCase(), source: context?.source ?? context?.kind,
        target: context?.subject, channel: context?.channel,
        role: /^\/guilds\/\d+\/members\/\d+\/roles\/(\d+)$/.exec(route)?.[1],
        messageIds: context?.messageIds },
      validate, record: writeAudit && ((action, detail) => writeAudit(context?.actorId ?? cfg.clientId, action, detail))
    }, () => original(request));
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
        if(guild.channels?.fetch) await guild.channels.fetch();
        const trackedNames = new Map(rows.filter(r => r.kind === 'role').map(r => [r.discord_id, r.name]));
        assertSafeRole({ role: guild.roles.cache.get(rid), bot, trackedNames,
          botRoleIds: [...bot.roles.cache.keys()] });
        assertRoleChannelGrants(guild.roles.cache.get(rid),guild);
        return privileged(async () => {
          assertPermission(bot,P.ManageRoles);
          const target=await guild.members.fetch({user:uid,force:true});
          assertHigherRole(bot,target,guild.ownerId,'Smith must be above the member receiving role changes.');
          if(context.actorId && context.actorId!==uid) {
            const actor=await guild.members.fetch({user:context.actorId,force:true});
            if(!canGrantFramework(actor,cfg,guild))throw new Error('Role approval/revocation requires an allowlisted human or Admin.');
            assertHigherRole(actor,target,guild.ownerId);
          }
        });
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
          || context.operation !== op || context.subject !== uid || !context.actorId
          || (['kick','ban','unban'].includes(op)&&!cfg.owners.includes(context.actorId))) {
          throw new Error('Moderation requires the authenticated, validated interactive workflow; role replacement and nickname management are disabled.');
        }
        return privileged(async () => {
          const actor = await guild.members.fetch({ user: context.actorId, force: true });
          if(!canModerate(actor,cfg,guild))throw new Error('Authenticated moderator authority required.');
          assertPermission(actor, moderationPermissions[op]);
          assertPermission(bot, moderationPermissions[op]);
          if (op !== 'unban') assertTarget({ actor, bot, target: await guild.members.fetch({ user: uid, force: true }),
            guildOwnerId: guild.ownerId, ownerDiscordId: cfg.ownerDiscordId, owners: cfg.owners, operation: op });
        });
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
          const bot = await guild.members.fetchMe({ force: true });
          assertSafeBot(bot);
          const owner = await guild.members.fetch({ user: guild.ownerId, force: true });
          assertSafeHierarchy(bot, owner);
          assertUnprotected(protectedResources({ guild, bot, owner, rows }), channelId, 'channel cleanup');
          return privileged(async () => {
            const target = await guild.channels.fetch(channelId);
            assertPermission(await guild.members.fetch({ user: context.actorId, force: true }), moderationPermissions.purge, target);
            assertPermission(bot, moderationPermissions.purge, target);
            const messages = await target.messages.fetch({ limit: 100 });
            for (const id of body.messages) {
              const message = messages.get(id);
              if (!message || message.pinned || Date.now() - message.createdTimestamp >= 14 * 86400000 - 60000) throw new Error('Protected, missing or expired purge target.');
              assertNotOwner(guild, message.author.id, cfg);
            }
          });
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
        const bot = await guild.members.fetchMe({ force: true });
        const owner = await guild.members.fetch({ user: guild.ownerId, force: true });
        assertSafeBot(bot); assertSafeHierarchy(bot, owner);
        assertUnprotected(protectedResources({ guild, bot, owner, rows }), channelId, 'channel cleanup');
        const target = await guild.channels.fetch(channelId);
        const message = await target.messages.fetch({ message: messageId, force: true });
        assertNotOwner(guild, message.author.id, cfg);
        if (message.pinned || Date.now() - message.createdTimestamp >= 14 * 86400000 - 60000) throw new Error('Protected or expired purge target.');
        return privileged(async () => {
          assertPermission(await guild.members.fetch({ user: context.actorId, force: true }), moderationPermissions.purge, target);
          assertPermission(bot, moderationPermissions.purge, target);
        });
      }
      if (!/^\/messages(?:\/|$)|^\/threads(?:\/|$)|^\/typing$/.test(suffix)) throw new Error('Unknown channel write disabled.');
      const target = await client.channels.fetch(channelId);
      if (target.guildId && target.guildId !== guild.id) throw new Error('Foreign channel write.');
      if (target.guildId && context?.kind === 'notification' && context.source === 'conversation-lookups')
        throw new Error('Lookup warnings are Owner DM only.');
      if (!target.guildId) {
        const recipientId = target.recipientId ?? target.recipient?.id;
        if (context?.kind === 'notification' && context.source === 'conversation-lookups') {
          await lookupWarningOwner(recipientId);
          if (method !== 'POST' || suffix !== '/messages' || body.content !== context.content ||
              !isLookupWarningContent(body.content) ||
              !Array.isArray(body.allowed_mentions?.parse) || body.allowed_mentions.parse.length ||
              body.embeds?.length || body.components?.length || body.attachments?.length || request.files?.length ||
              body.allowed_mentions.users?.length || body.allowed_mentions.roles?.length ||
              body.allowed_mentions.replied_user || body.message_reference || body.poll || body.sticker_ids?.length ||
              body.tts || body.username || body.avatar_url) {
            throw new Error('Only fixed-label lookup warnings may be sent to the Owner.');
          }
          return original(request);
        }
        if (context?.kind === 'notification' && context.source === 'request-expiry' && recipientId === context.subject
          && method === 'POST' && suffix === '/messages') return original(request);
        if (context?.kind !== 'moderation' || context.operation !== 'warn'
          || !context.actorId || recipientId !== context.subject) {
          throw new Error('Direct messages require the exact authenticated warning recipient.');
        }
        if(!canModerate(await guild.members.fetch({user:context.actorId,force:true}),cfg,guild))throw new Error('Warning delivery requires authenticated moderator authority.');
        assertNotOwner(guild, recipientId, cfg);
      }
      return !target.guildId ? privileged() : original(request);
    }
    if (route === '/users/@me/channels' && method === 'POST'
      && context?.kind === 'notification' && context.source === 'conversation-lookups') {
      await lookupWarningOwner(body.recipient_id);
      return original(request);
    }
    if (route === '/users/@me/channels' && method === 'POST'
      && context?.kind === 'notification' && context.source === 'request-expiry' && body.recipient_id === context.subject) return original(request);
    if (/^\/users\/@me\/channels$/.test(route) && method === 'POST'
      && context?.kind === 'moderation' && context.operation === 'warn' && body.recipient_id === context.subject) {
      if(!context.actorId||!canModerate(await guild.members.fetch({user:context.actorId,force:true}),cfg,guild))throw new Error('Warning notification requires authenticated moderator authority.');
      assertNotOwner(guild, body.recipient_id, cfg); return privileged();
    }
    if (/^\/applications\/\d+\/guilds\/\d+\/commands(?:\/\d+)?$/.test(route)) {
      if (!route.startsWith(`/applications/${cfg.clientId}/guilds/${guild.id}/`)) throw new Error('Foreign command management.');
      if (method === 'PUT') assertCommandTree(body);
      else if (method === 'POST' && route === `/applications/${cfg.clientId}/guilds/${guild.id}/commands`
        && [smithCommand, smithControlCommand].some(command => JSON.stringify(body) === JSON.stringify(command.toJSON())))
        assertCommandTree([body]);
      else if (method !== 'DELETE') throw new Error('Unsupported command management.');
      return original(request);
    }
    // Acknowledgements and ephemeral replies for this bot's interactions.
    if (method === 'POST' && /^\/interactions\/\d+\/[^/]+\/callback$/.test(route)) return original(request);
    if (route.startsWith(`/webhooks/${cfg.clientId}/`) && ['POST','PATCH','DELETE'].includes(method)) return original(request);
    throw new Error('Unknown privileged API write disabled.');
  };
}
