// Capabilities, not marketing policy. No proposed tier restriction is seeded here.
const entries = [
  ['configuration', 'Active module configurations', 'settings', [], ['module_configuration_count']],
  ['onboarding', 'Onboarding', 'onboarding', [], ['onboarding_step_count']],
  ['roles', 'Basic roles', 'roles', [], ['custom_role_count']],
  ['moderation', 'Core moderation', 'moderation', [], []],
  ['audit_log', 'Audit log', 'audit', [], []],
  ['automod', 'Automod', 'automod', ['moderation'], []],
  ['xp', 'XP', 'leveling', [], ['xp_events_monthly']],
  ['levels', 'Levels', 'leveling', ['xp'], ['level_milestone_count']],
  ['reward_roles', 'Level rewards', 'rewards', ['levels'], ['level_reward_count']],
  ['achievements', 'Achievements', 'achievements', ['xp'], ['achievement_count']],
  ['economy', 'Cosmetic economy', 'economy', [], []],
  ['shop', 'Shop', 'economy', ['economy'], ['shop_item_count']],
  ['tickets', 'Tickets', 'tickets', [], ['ticket_count', 'ticket_panel_count', 'ticket_retention_days']],
  ['ai', 'Conversational AI', 'ai', [], ['ai_requests_monthly']],
  ['advanced_ai', 'Advanced AI', 'ai', ['ai'], []],
  ['analytics', 'Analytics', 'analytics', [], ['analytics_retention_days']],
  ['feeds', 'Feeds', 'feeds', [], ['feed_source_count']],
  ['youtube', 'YouTube', 'youtube', ['feeds'], ['youtube_source_count']],
  ['events', 'Events', 'events', [], ['event_count']],
  ['welcome', 'Welcome', 'welcome', [], []],
  ['advanced_automod', 'Advanced automod', 'automod', ['automod'], []],
  ['advanced_roles', 'Advanced role automation', 'roles', ['roles'], ['role_mapping_count']],
  ['advanced_channels', 'Advanced channel automation', 'settings', [], ['channel_mapping_count']],
  ['patreon_perks', 'Supporter perks', 'roles', ['roles'], []],
];
const supported = new Set(['configuration', 'onboarding', 'roles', 'audit_log', 'xp', 'levels',
  'economy', 'shop', 'tickets', 'ai', 'analytics', 'welcome']);
export const FEATURE_CATALOG = Object.freeze(entries.map(([key, displayName, module, dependencies, limits]) =>
  Object.freeze({ key, displayName, description: `${displayName} capability; tier policy is not finalized.`,
    module, minimumPlan: null, enabled: true, supported: supported.has(key), dependencies, limits,
    rolePrivileges: ['roles', 'reward_roles', 'advanced_roles', 'patreon_perks', 'onboarding'].includes(key)
      ? 'Existing guarded cosmetic/rewardable roles only; never overrides protected accounts or hierarchy.' : 'None added.',
    channelPrivileges: ['tickets', 'advanced_channels'].includes(key)
      ? 'Existing guarded channel authority only; preserve opening-time ticket access.' : 'Existing visibility rules; no new grants.',
    workers: ['xp', 'analytics', 'feeds', 'youtube', 'events', 'ai', 'welcome'].includes(key) ? [module] : [],
    databaseRecords: module === 'leveling' ? ['platform_member_profiles', 'platform_xp_events'] :
      module === 'ai' ? ['platform_ai_periods'] : ['platform_modules', 'platform_records'],
    downgradeBehavior: 'PRESERVE_EARNED; DISABLE_NEW_GRANTS; preserve configuration, history and Discord resources.',
  })));
export const FEATURE_KEYS = new Set(FEATURE_CATALOG.map(f => f.key));
export const MODULE_FEATURES = Object.freeze({
  onboarding: 'onboarding', roles: 'roles', moderation: 'moderation', audit: 'audit_log',
  automod: 'automod', leveling: 'xp', rewards: 'reward_roles', achievements: 'achievements',
  economy: 'economy', tickets: 'tickets', ai: 'ai', analytics: 'analytics',
  feeds: 'feeds', youtube: 'youtube', events: 'events', welcome: 'welcome',
});
export const COLLECTION_FEATURES = Object.freeze({
  achievements: 'achievements', rewards: 'reward_roles', shop: 'shop', feeds: 'feeds',
  youtube: 'youtube', events: 'events', 'ticket-panels': 'tickets', 'rank-cards': 'levels',
});
export const LIMIT_KEYS = new Set(FEATURE_CATALOG.flatMap(f => f.limits));
export const LEGACY_LIMIT_KEYS = Object.freeze({
  feed_source_count: 'feeds', ticket_panel_count: 'ticket_panels',
  ai_requests_monthly: 'ai_monthly_requests',
});
