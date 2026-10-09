import { FEATURE_CATALOG, LEGACY_LIMIT_KEYS } from './feature-catalog.js';
import { resolveAssignment } from './entitlement-policy.js';
import { TARGET_GUILD_ID } from '../config.js';

export async function usageSnapshot(pool, guildId) {
  const queries = [
    ["SELECT collection,count(*)::int AS count FROM platform_records WHERE guild_id=$1 GROUP BY collection", [guildId]],
    ["SELECT count(*)::int AS count FROM platform_xp_events WHERE guild_id=$1 AND created_at>=date_trunc('month',now())", [guildId]],
    ["SELECT count(*)::int AS count FROM community_shop WHERE guild_id=$1", [guildId]],
    ["SELECT count(*)::int AS count FROM platform_ticket_channels WHERE guild_id=$1", [guildId]],
    ["SELECT requests,input_tokens,output_tokens FROM platform_ai_periods WHERE guild_id=$1 AND period=date_trunc('month',now())::date", [guildId]],
  ];
  const [records, xp, shop, tickets, ai] = await Promise.all(queries.map(([sql, values]) => pool.query(sql, values)));
  const collections = Object.fromEntries(records.rows.map(r => [r.collection, Number(r.count)]));
  return { feed_source_count: collections.feeds ?? 0, youtube_source_count: collections.youtube ?? 0,
    ticket_panel_count: collections['ticket-panels'] ?? 0, achievement_count: collections.achievements ?? 0,
    event_count: collections.events ?? 0, level_reward_count: collections.rewards ?? 0,
    xp_events_monthly: Number(xp.rows[0]?.count ?? 0), shop_item_count: guildId === TARGET_GUILD_ID ?
      Number(shop.rows[0]?.count ?? 0) : collections.shop ?? 0,
    ticket_count: Number(tickets.rows[0]?.count ?? 0), ai_requests_monthly: Number(ai.rows[0]?.requests ?? 0) };
}
export async function entitlementView(service, pool, guildId, canAssign = false) {
  const [data, usage] = await Promise.all([service.state(guildId), usageSnapshot(pool, guildId)]);
  const resolved = resolveAssignment(data.assignment, data.legacy.plan, Date.now(), data.legacy.status);
  const enforced = service.enforced(guildId);
  const config = key => data.moduleRows.find(r => r.module_key === key)?.configuration_json ?? {};
  usage.custom_role_count = config('roles').selfAssignableRoles?.length ?? 0;
  usage.onboarding_step_count = config('onboarding').steps?.length ?? 0;
  usage.level_milestone_count = config('leveling').thresholds?.length ?? 0;
  usage.module_configuration_count = data.moduleRows.filter(r => r.enabled).length;
  const features = data.catalog.map(f => {
    const d = service.decision(guildId, data, f.key);
    const limits = FEATURE_CATALOG.find(c => c.key === f.key).limits.map(key => {
      const value = guildId === TARGET_GUILD_ID ? null : d.reviewed && Object.hasOwn(d.limits, key) ? d.limits[key] :
        LEGACY_LIMIT_KEYS[key] ? data.legacy.limits[LEGACY_LIMIT_KEYS[key]] : null;
      // Native Hallowed Core uses independent historical ledgers. Zero in a
      // platform-only table is not evidence of zero native usage.
      const used = guildId === TARGET_GUILD_ID ? null : usage[key] ?? null;
      const monthly = /monthly$/.test(key);
      const now = new Date();
      return { key, value, used, remaining: value === null || value === -1 || used === null ? null : Math.max(0, value - used),
        resetAt: monthly ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() : null,
        overLimit: value !== null && value !== -1 && used !== null && used > value };
    });
    const enabled = data.modules[f.module] === true;
    const reached = limits.some(l => l.value !== null && l.value !== -1 && l.used !== null && l.used >= l.value);
    const supported = guildId === TARGET_GUILD_ID ?
      new Set(['onboarding', 'roles', 'moderation', 'automod', 'xp', 'levels', 'reward_roles', 'economy', 'shop',
        'feeds', 'youtube', 'ai', 'analytics', 'audit_log']).has(f.key) : f.supported;
    return { featureKey: f.key, displayName: f.displayName, description: f.description, module: f.module,
      minimumPlan: d.minimumPlan, entitled: d.entitled, enabled, policyApproved: d.reviewed,
      state: !supported ? 'UNSUPPORTED' : !d.entitled ? 'LOCKED_BY_PLAN' : reached ? 'LIMIT_REACHED' :
        data.modules[f.module] === false ? 'DISABLED' : enabled ? 'ENABLED' : 'AVAILABLE',
      reason: !supported ? 'Runtime support is not implemented; a plan does not activate it.' :
        guildId === TARGET_GUILD_ID ? 'Native access is preserved; platform configuration is not live native-service acceptance evidence.' : d.reason,
      dependencies: f.dependencies, limits, downgradeBehavior: f.downgradeBehavior };
  });
  const a = resolved.assignment;
  return { plan: resolved.plan, effectivePlan: enforced ? resolved.effectivePlan : data.legacy.plan,
    status: resolved.status, policyMode: enforced ? 'REVIEWED_RULES' : 'PRESERVE_ACCESS',
    billingEnabled: false, canAssign,
    assignment: a ? { source: a.source, assignedAt: new Date(a.assigned_at).toISOString(),
      expiresAt: a.expires_at ? new Date(a.expires_at).toISOString() : null, revision: a.revision } : null,
    features };
}
