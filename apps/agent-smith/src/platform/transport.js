import { AsyncLocalStorage } from 'node:async_hooks';
import { PermissionFlagsBits as P } from 'discord.js';
import { hasPermission } from '../permissions.js';
import { assertProductionGuildWritable } from './guild-lifecycle.js';

const communication = new AsyncLocalStorage();
const guards = new WeakMap();
export function installSecurityGateForRestOnly(client) {
  const original = client.rest.request.bind(client.rest);
  client.rest.request = async request => {
    if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      throw new Error('REST-only identity client refuses Discord mutations.');
    }
    return original(request);
  };
}
export function withPlatformCommunication({ guild, userId, channelId }, callback) {
  return communication.run({ guild, userId, channelId }, callback);
}
export function setPlatformTransportGuard(client, guard) { guards.set(client, guard); }
export function platformTransportAllowed(client, request) {
  return guards.get(client)?.(request) ?? false;
}
export function communicationGuard(request) {
  const scope = communication.getStore();
  if (!scope) return false;
  assertProductionGuildWritable(scope.guild.id);
  // No guild/role/channel-management endpoints; ordinary bounded communication only.
  if (request.method !== 'POST' || request.fullRoute !== `/channels/${scope.channelId}/messages`) return false;
  const channel = scope.guild.channels.cache.get(scope.channelId);
  const actor = scope.guild.members.cache.get(scope.userId);
  const bot = scope.guild.members.me;
  if (!channel || !actor || !bot || actor.user.bot ||
      !hasPermission(actor, P.ViewChannel, channel) || !hasPermission(actor, P.ReadMessageHistory, channel) ||
      !hasPermission(bot, P.ViewChannel, channel) ||
      !hasPermission(bot, channel.isThread?.() ? P.SendMessagesInThreads : P.SendMessages, channel)) {
    throw new Error('Platform conversation communication not authorized.');
  }
  const body = request.body ?? {};
  if (typeof body.content !== 'string' || body.content.length > 2000 ||
      body.allowed_mentions?.parse?.length !== 0 || body.allowed_mentions?.replied_user !== false) {
    throw new Error('Platform replies require bounded text and suppressed mentions.');
  }
  return true;
}
