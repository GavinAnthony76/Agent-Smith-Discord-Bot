import { DEFAULT_PLANS, PlatformError, permitScope, validateLimits } from './catalog.js';
import { TARGET_GUILD_ID } from '../config.js';
import { FEATURE_CATALOG, FEATURE_KEYS, LEGACY_LIMIT_KEYS, MODULE_FEATURES } from './feature-catalog.js';
import { checkCapacity, decideFeature, resolveAssignment } from './entitlement-policy.js';
import { entitlementView } from './entitlement-view.js';

export function createEntitlementService(pool, { env = process.env, loadState } = {}) {
  const rollout = new Set((env.PLATFORM_ENTITLEMENT_GUILD_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean));
  function enforced(guildId) {
    // Two explicit switches plus per-rule approval. Manual assignment is NOT activation.
    return guildId !== TARGET_GUILD_ID && rollout.has(guildId) &&
      env.PLATFORM_ENTITLEMENT_POLICY_APPROVED === 'true';
  }
  async function legacy(guildId, db = pool, historicalStatus = false) {
    const row = (await db.query('SELECT plan,status,limit_overrides FROM platform_entitlements WHERE guild_id=$1', [guildId])).rows[0];
    const active = historicalStatus || row?.status === 'active';
    const plan = row && active && Object.hasOwn(DEFAULT_PLANS, row.plan) ? row.plan : 'FREE';
    return { plan, status: row?.status === 'inactive' ? 'SUSPENDED' : 'ACTIVE',
      limits: { ...DEFAULT_PLANS[plan], ...validateLimits(active ? row?.limit_overrides ?? {} : {}) } };
  }
  async function state(guildId, db = pool) {
    if (!/^\d{17,20}$/.test(guildId)) throw new PlatformError('invalid_guild_id');
    if (loadState) return loadState(guildId, db);
    const [old, assignments, features, rules, modules] = await Promise.all([
      legacy(guildId, db, true),
      db.query('SELECT * FROM platform_plan_assignments WHERE guild_id=$1', [guildId]),
      db.query('SELECT * FROM platform_features'),
      db.query('SELECT * FROM platform_feature_policies'),
      db.query('SELECT module_key,enabled,configuration_json FROM platform_modules WHERE guild_id=$1', [guildId]),
    ]);
    const catalog = FEATURE_CATALOG.map(f => {
      const saved = features.rows.find(r => r.feature_key === f.key);
      return saved ? { ...f, displayName: saved.display_name, description: saved.description,
        minimumPlan: saved.minimum_plan, enabled: saved.enabled,
        dependencies: saved.configuration?.dependencies ?? f.dependencies } : f;
    });
    return { legacy: old, assignment: assignments.rows[0] ?? null, catalog,
      policies: rules.rows, moduleRows: modules.rows,
      modules: Object.fromEntries(modules.rows.map(r => [r.module_key, r.enabled])) };
  }
  function decision(guildId, data, key) {
    const resolved = resolveAssignment(data.assignment, data.legacy.plan, Date.now(), data.legacy.status);
    return decideFeature({ featureKey: key, plan: enforced(guildId) ? resolved.effectivePlan : data.legacy.plan,
      enforced: enforced(guildId), catalog: data.catalog, policies: data.policies, modules: data.modules });
  }
  async function hasFeature(guildId, key, db = pool) {
    if (!FEATURE_KEYS.has(key)) throw new PlatformError('unknown_feature');
    if (!enforced(guildId)) return true;
    return decision(guildId, await state(guildId, db), key).entitled;
  }
  async function requireFeature(guildId, key, db = pool) {
    if (!await hasFeature(guildId, key, db)) throw new PlatformError('feature_not_enabled_for_community', 403);
  }
  async function canUseModule(guildId, module, db = pool) {
    const key = MODULE_FEATURES[module];
    return key ? hasFeature(guildId, key, db) : true;
  }
  async function getFeatureLimit(guildId, key, limitKey, db = pool) {
    if (!FEATURE_KEYS.has(key) || !FEATURE_CATALOG.find(f => f.key === key).limits.includes(limitKey))
      throw new PlatformError('unknown_feature_limit');
    if (enforced(guildId)) {
      const d = decision(guildId, await state(guildId, db), key);
      if (!d.entitled) throw new PlatformError('feature_not_enabled_for_community', 403);
      if (Object.hasOwn(d.limits, limitKey)) return d.limits[limitKey];
    }
    // Preserve the pre-existing limits exactly until a reviewed rule overrides them.
    const oldKey = LEGACY_LIMIT_KEYS[limitKey];
    return oldKey ? (await legacy(guildId, db, true)).limits[oldKey] : null;
  }
  async function requireCapacity(guildId, key, limitKey, used, amount = 1, db = pool) {
    await requireFeature(guildId, key, db);
    if (!checkCapacity(await getFeatureLimit(guildId, key, limitKey, db), used, amount))
      throw new PlatformError('plan_limit_reached', 409);
  }
  async function requireModule(guildId, module, db = pool) {
    if (MODULE_FEATURES[module]) await requireFeature(guildId, MODULE_FEATURES[module], db);
  }
  async function checkConfiguration(guildId, module, config, db = pool) {
    if (!enforced(guildId)) return;
    const counts = module === 'roles' ? { custom_role_count: config.selfAssignableRoles?.length ?? 0 } :
      module === 'onboarding' ? { onboarding_step_count: config.steps?.length ?? 0 } :
      module === 'leveling' ? { level_milestone_count: config.thresholds?.length ?? 0 } : {};
    for (const [key, count] of Object.entries(counts)) {
      if (!count) continue; // No child feature is requested by an empty configuration.
      const feature = key === 'level_milestone_count' ? 'levels' : MODULE_FEATURES[module];
      const data = await state(guildId, db);
      // Called only for an enabled save. Validate the projected configuration
      // so enabling XP and its milestones together does not require a prior save.
      const projected = { ...data, modules: { ...data.modules, [module]: true } };
      const d = decision(guildId, projected, feature);
      if (!d.entitled) throw new PlatformError('feature_not_enabled_for_community', 403);
      const limit = Object.hasOwn(d.limits, key) ? d.limits[key] : null;
      if (!checkCapacity(limit, count, 0)) throw new PlatformError('plan_limit_reached', 409);
    }
  }
  async function checkModuleCapacity(guildId, module, db = pool) {
    if (!enforced(guildId)) return;
    const limit = await getFeatureLimit(guildId, 'configuration', 'module_configuration_count', db);
    if (limit === null || limit === -1) return;
    const used = Number((await db.query(`SELECT count(*) AS count FROM platform_modules
      WHERE guild_id=$1 AND enabled=true AND module_key<>$2`, [guildId, module])).rows[0].count);
    if (!checkCapacity(limit, used, 1)) throw new PlatformError('plan_limit_reached', 409);
  }
  async function getPlan(permit) {
    const { guildId } = permitScope(permit, 'settings');
    const old = await legacy(guildId);
    return { plan: old.plan, limits: old.limits, billingEnabled: false };
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
  async function getGuildPlan(guildId) {
    const data = await state(guildId);
    const resolved = resolveAssignment(data.assignment, data.legacy.plan, Date.now(), data.legacy.status);
    return { ...resolved,
      effectivePlan: enforced(guildId) ? resolved.effectivePlan : data.legacy.plan,
      policyMode: enforced(guildId) ? 'REVIEWED_RULES' : 'PRESERVE_ACCESS', billingEnabled: false };
  }
  async function retentionWindow(guildId, key, requestedDays, db = pool) {
    if (!Number.isSafeInteger(requestedDays) || requestedDays < 0) throw new PlatformError('invalid_retention_window');
    const cap = await getFeatureLimit(guildId, key, `${key}_retention_days`, db);
    return cap === null || cap === -1 ? requestedDays : Math.min(requestedDays, cap);
  }
  const service = { getPlan, getLimit, canUse, getGuildPlan, hasFeature, requireFeature, getFeatureLimit,
    canUseModule, requireModule, requireCapacity, checkConfiguration, checkModuleCapacity, state, decision, enforced, legacy, retentionWindow };
  service.getGuildEntitlements = (guildId, canAssign = false) => entitlementView(service, pool, guildId, canAssign);
  // Use this for every new scheduled/reconciliation/feed/channel-automation entry point.
  // It cannot activate an unsupported adapter or replace its existing security checks.
  service.runFeatureTask = async (guildId, key, operation) => {
    await requireFeature(guildId, key);
    const descriptor = FEATURE_CATALOG.find(f => f.key === key);
    if (guildId !== TARGET_GUILD_ID && !descriptor.supported)
      throw new PlatformError('runtime_module_not_implemented', 409);
    if (enforced(guildId) && descriptor.module !== 'settings' &&
        (await state(guildId)).modules[descriptor.module] !== true)
      throw new PlatformError('feature_not_enabled_for_community', 403);
    return operation();
  };
  return service;
}
