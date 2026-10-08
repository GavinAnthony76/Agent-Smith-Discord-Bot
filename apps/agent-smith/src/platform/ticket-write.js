import { AsyncLocalStorage } from 'node:async_hooks';
import { PermissionFlagsBits as P } from 'discord.js';
import { withPrivilegedPipeline } from '../privileged-pipeline.js';
import { TARGET_GUILD_ID } from '../config.js';
import { PlatformError, snowflake } from './catalog.js';

const writes = new AsyncLocalStorage();
const operations = new Set(['ticket.create', 'ticket.close', 'ticket.panel', 'ticket.message']);

/** Closed SDK scope: one exact request, no roles, member writes or deletion. */
export function withTicketWrite(plan, execute) {
  snowflake(plan.guildId); snowflake(plan.actorId);
  if (plan.guildId === TARGET_GUILD_ID || !operations.has(plan.operation) ||
      typeof plan.validate !== 'function' || typeof plan.record !== 'function') {
    throw new PlatformError('ticket_write_policy_not_available', 403);
  }
  const snapshot = Object.freeze({ ...plan, payload: JSON.stringify(plan.body),
    expires: Date.now() + 30000, used: false });
  return writes.run({ snapshot, used: false }, execute);
}

export function executeTicketWrite(client, request, execute) {
  const scope = writes.getStore();
  if (!scope) return null;
  const plan = scope.snapshot;
  if (scope.used || client !== plan.client || Date.now() > plan.expires ||
      request.method !== plan.method || request.fullRoute !== plan.route ||
      JSON.stringify(request.body ?? {}) !== plan.payload || request.files?.length) {
    throw new PlatformError('ticket_sdk_request_not_authorized', 403);
  }
  const create = plan.operation === 'ticket.create';
  const close = plan.operation === 'ticket.close';
  const expected = create ? `/guilds/${plan.guildId}/channels` : `/channels/${plan.channelId}${close ? '' : '/messages'}`;
  if (plan.route !== expected || plan.method !== (close ? 'PATCH' : 'POST')) {
    throw new PlatformError('ticket_sdk_route_not_authorized', 403);
  }
  if (create || close) {
    const allowed = create ? ['name', 'type', 'parent_id', 'topic', 'permission_overwrites'] : ['permission_overwrites'];
    if (Object.keys(plan.body).some(key => !allowed.includes(key)) ||
        create && (plan.body.type !== 0 || !/^ticket-[a-f0-9]{8}$/.test(plan.body.name) ||
          !/^smith-ticket:[a-f0-9-]{36}$/.test(plan.body.topic))) {
      throw new PlatformError('ticket_channel_payload_not_authorized', 403);
    }
    const everyone = plan.body.permission_overwrites?.find(row => row.id === plan.guildId && row.type === 0);
    const communication = P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AttachFiles | P.EmbedLinks;
    if (!everyone || !(BigInt(everyone.deny) & P.ViewChannel) || BigInt(everyone.allow) !== 0n ||
        plan.body.permission_overwrites.some(row => (BigInt(row.allow) & ~communication) !== 0n)) {
      throw new PlatformError('ticket_channel_must_be_private', 403);
    }
  } else if (typeof plan.body.content !== 'string' || plan.body.content.length > 2000 ||
      plan.body.allowed_mentions?.parse?.length !== 0) {
    throw new PlatformError('ticket_message_payload_not_authorized', 403);
  }
  scope.used = true;
  return withPrivilegedPipeline({
    action: { operation: plan.operation, source: 'platform-tickets', guildId: plan.guildId,
      channel: plan.channelId ?? null },
    validate: async () => {
      await plan.validate();
      if (Date.now() > plan.expires || JSON.stringify(request.body ?? {}) !== plan.payload) {
        throw new PlatformError('ticket_sdk_scope_expired_or_changed', 403);
      }
    }, record: plan.record,
  }, execute);
}
