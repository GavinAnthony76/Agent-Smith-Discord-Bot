import { PlatformError } from './catalog.js';
import { FEATURE_CATALOG, FEATURE_KEYS, LIMIT_KEYS } from './feature-catalog.js';

export const PLANS = Object.freeze(['FREE', 'PRO', 'ULTIMATE']);
export const PLAN_STATUSES = Object.freeze(['ACTIVE', 'TRIAL', 'MANUAL', 'SUSPENDED', 'EXPIRED']);
export function validatePolicyLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits))
    throw new PlatformError('invalid_entitlement_limits');
  for (const [key, value] of Object.entries(limits)) {
    if (!LIMIT_KEYS.has(key) || !Number.isSafeInteger(value) || value < -1)
      throw new PlatformError('invalid_entitlement_limits');
  }
  return { ...limits };
}
export function resolveAssignment(assignment, legacyPlan = 'FREE', now = Date.now(), legacyStatus = 'ACTIVE') {
  if (!assignment) return { plan: legacyPlan, effectivePlan: legacyStatus === 'SUSPENDED' ? 'FREE' : legacyPlan,
    status: legacyStatus, assignment: null };
  if (!PLANS.includes(assignment.plan) || !PLAN_STATUSES.includes(assignment.status))
    throw new PlatformError('invalid_entitlement_assignment', 503);
  const expires = assignment.expires_at == null ? null : new Date(assignment.expires_at).getTime();
  if (expires !== null && !Number.isFinite(expires)) throw new PlatformError('invalid_entitlement_assignment', 503);
  const status = expires !== null && expires <= now ? 'EXPIRED' : assignment.status;
  return { plan: assignment.plan, effectivePlan: ['EXPIRED', 'SUSPENDED'].includes(status) ? 'FREE' : assignment.plan,
    status, assignment };
}
export function decideFeature({ featureKey, plan, enforced, catalog = FEATURE_CATALOG, policies = [],
  modules = {}, seen = new Set() }) {
  if (!FEATURE_KEYS.has(featureKey)) throw new PlatformError('unknown_feature');
  const feature = catalog.find(f => f.key === featureKey);
  if (!feature) throw new PlatformError('unknown_feature');
  const rule = policies.find(p => p.feature_key === featureKey && p.plan === plan && p.approved === true);
  const reviewed = enforced && !!rule;
  const minimumPlan = reviewed ? rule.minimum_plan ?? feature.minimumPlan ?? null : null;
  if (minimumPlan !== null && !PLANS.includes(minimumPlan))
    throw new PlatformError('invalid_feature_policy', 503);
  let entitled = true, reason = null;
  if (reviewed && (rule.available === false || feature.enabled === false ||
      minimumPlan && PLANS.indexOf(plan) < PLANS.indexOf(minimumPlan))) {
    entitled = false; reason = minimumPlan ? `Requires ${minimumPlan}` : 'Not available under the reviewed policy';
  }
  if (reviewed && entitled) {
    if (seen.has(featureKey)) return { entitled: false, reason: 'Feature dependency cycle', minimumPlan, reviewed };
    const next = new Set([...seen, featureKey]);
    for (const dependency of feature.dependencies ?? []) {
      if (!FEATURE_KEYS.has(dependency)) { entitled = false; reason = 'Unknown feature dependency'; break; }
      const result = decideFeature({ featureKey: dependency, plan, enforced, catalog, policies, modules, seen: next });
      const descriptor = catalog.find(f => f.key === dependency);
      if (!result.entitled || descriptor.module !== 'settings' && modules[descriptor.module] !== true) {
        entitled = false; reason = `Requires available and enabled ${dependency}`; break;
      }
    }
  }
  return { entitled, reason, minimumPlan, reviewed,
    limits: reviewed ? validatePolicyLimits(rule.limits ?? {}) : {} };
}
export function checkCapacity(limit, used, amount = 1) {
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < -1) ||
      !Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(amount) || amount < 0)
    throw new PlatformError('invalid_usage');
  return limit === null || limit === -1 || used + amount <= limit;
}
export function entitlementMemberMessage(error) {
  if (error?.code === 'feature_not_enabled_for_community') return 'This feature is not enabled for this community.';
  if (error?.code === 'plan_limit_reached') return 'This feature’s current community allowance has been reached.';
  return null;
}
