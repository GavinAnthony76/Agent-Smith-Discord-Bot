import { AsyncLocalStorage } from 'node:async_hooks';
import { withPrivilegedPipeline } from '../privileged-pipeline.js';
import { TARGET_GUILD_ID } from '../config.js';
import { PlatformError, snowflake } from './catalog.js';

const writes = new AsyncLocalStorage();
export function withSelfRoleWrite(plan, execute) {
  for (const id of [plan.guildId, plan.memberId, plan.roleId]) snowflake(id);
  if (plan.guildId === TARGET_GUILD_ID || typeof plan.validate !== 'function' || typeof plan.record !== 'function')
    throw new PlatformError('self_role_policy_unavailable', 403);
  return writes.run({ plan: Object.freeze({ ...plan, expires: Date.now() + 30000 }), used: false }, execute);
}
export function executeSelfRoleWrite(client, request, execute) {
  const scope = writes.getStore();
  if (!scope) return null;
  const p = scope.plan;
  const method = p.operation === 'remove' ? 'DELETE' : 'PUT';
  if (scope.used || client !== p.client || request.method !== method ||
      request.fullRoute !== `/guilds/${p.guildId}/members/${p.memberId}/roles/${p.roleId}` ||
      Object.keys(request.body ?? {}).length || request.files?.length || Date.now() > p.expires) {
    throw new PlatformError('self_role_request_not_authorized', 403);
  }
  scope.used = true;
  return withPrivilegedPipeline({ action: { operation: p.operation === 'remove' ? 'role.self-remove' : 'role.self-select', source: 'platform-onboarding',
    guildId: p.guildId, target: p.memberId, role: p.roleId },
    validate: async () => {
      await p.validate();
      if (Date.now() > p.expires || request.method !== method ||
          request.fullRoute !== `/guilds/${p.guildId}/members/${p.memberId}/roles/${p.roleId}` ||
          Object.keys(request.body ?? {}).length || request.files?.length)
        throw new PlatformError('self_role_scope_expired_or_changed', 403);
    },
    record: p.record }, execute);
}
