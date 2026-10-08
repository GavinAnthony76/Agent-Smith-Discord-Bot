import { DEFAULT_PLANS, PlatformError, permitScope, validateLimits } from './catalog.js';

export function createEntitlementService(pool) {
  async function getPlan(permit) {
    const { guildId } = permitScope(permit, 'settings');
    const result = await pool.query(
      `SELECT plan,status,limit_overrides FROM platform_entitlements WHERE guild_id=$1`, [guildId]);
    const row = result.rows[0];
    const plan = row && row.status === 'active' && Object.hasOwn(DEFAULT_PLANS, row.plan) ? row.plan : 'FREE';
    return { plan, limits: { ...DEFAULT_PLANS[plan], ...validateLimits(row?.status === 'active' ? row.limit_overrides ?? {} : {}) },
      billingEnabled: false };
  }
  async function getLimit(permit, feature) {
    if (!Object.hasOwn(DEFAULT_PLANS.FREE, feature)) throw new PlatformError('unknown_feature');
    return (await getPlan(permit)).limits[feature];
  }
  async function canUse(permit, feature, used = 0) {
    if (!Number.isSafeInteger(used) || used < 0) throw new PlatformError('invalid_usage');
    const limit = await getLimit(permit, feature);
    return limit === -1 || used < limit;
  }
  return { getPlan, getLimit, canUse };
}
