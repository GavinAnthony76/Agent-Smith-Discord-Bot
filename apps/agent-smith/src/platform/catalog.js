export const MODULE_KEYS = Object.freeze([
  'moderation', 'automod', 'onboarding', 'roles', 'leveling', 'economy',
  'achievements', 'rewards', 'tickets', 'welcome', 'feeds', 'youtube',
  'events', 'ai', 'analytics',
]);

export const DASHBOARD_ROLES = Object.freeze([
  'OWNER', 'ADMIN', 'MODERATOR', 'COMMUNITY_MANAGER', 'VIEW_ONLY',
]);

const capabilities = Object.freeze({
  OWNER: ['*'],
  ADMIN: ['overview', 'moderation', 'automod', 'onboarding', 'roles', 'leveling',
    'economy', 'achievements', 'rewards', 'tickets', 'welcome', 'feeds', 'youtube',
    'events', 'ai', 'analytics', 'audit', 'settings'],
  MODERATOR: ['overview', 'moderation', 'tickets', 'audit'],
  COMMUNITY_MANAGER: ['overview', 'onboarding', 'events', 'feeds', 'youtube', 'welcome'],
  VIEW_ONLY: ['overview', 'analytics', 'status'],
});

export class PlatformError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'PlatformError';
    this.code = code;
    this.status = status;
  }
}

export function snowflake(value) {
  if (typeof value !== 'string' || !/^\d{17,20}$/.test(value)) {
    throw new PlatformError('invalid_discord_id');
  }
  return value;
}

export function moduleKey(value) {
  if (!MODULE_KEYS.includes(value)) throw new PlatformError('unknown_module');
  return value;
}

export function dashboardCan(role, capability, write = false) {
  if (!DASHBOARD_ROLES.includes(role)) return false;
  if (write && role === 'VIEW_ONLY') return false;
  return capabilities[role].includes('*') || capabilities[role].includes(capability);
}

/**
 * The OAuth/session boundary supplies identity. Only a fresh membership/authority
 * resolver may issue this capability; HTTP params and JSON cannot create one.
 */
const permits = new WeakMap();
export async function authorizeTenant({ userId, guildId, capability, write = false, resolve }) {
  snowflake(userId);
  snowflake(guildId);
  let authority;
  try { authority = await resolve({ userId, guildId }); }
  catch { throw new PlatformError('guild_access_denied', 403); }
  if (!authority?.installed || !authority.member ||
      !dashboardCan(authority.role, capability, write)) {
    // Uniform refusal does not disclose whether another tenant exists.
    throw new PlatformError('guild_access_denied', 403);
  }
  const permit = Object.freeze({});
  permits.set(permit, Object.freeze({ userId, guildId, role: authority.role, capability, write }));
  return permit;
}

export function permitScope(permit, capability, write = false) {
  const scope = permits.get(permit);
  if (!scope || (scope.capability !== capability && scope.capability !== 'settings') ||
      (write && !scope.write) || !dashboardCan(scope.role, capability, write)) {
    throw new PlatformError('guild_access_denied', 403);
  }
  return scope;
}

export const DEFAULT_PLANS = Object.freeze({
  FREE: Object.freeze({
    feeds: 3, ticket_panels: 1, custom_rank_cards: 0, ai_monthly_requests: 100,
  }),
  PRO: Object.freeze({
    feeds: 25, ticket_panels: 10, custom_rank_cards: 5, ai_monthly_requests: 2000,
  }),
  ULTIMATE: Object.freeze({
    feeds: 100, ticket_panels: 50, custom_rank_cards: 25, ai_monthly_requests: 10000,
  }),
});

export function validateLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new PlatformError('invalid_limits');
  }
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_PLANS.FREE, key) || !Number.isSafeInteger(value) || value < -1) {
      throw new PlatformError('invalid_limits');
    }
  }
  return { ...limits };
}
