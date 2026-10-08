import { randomUUID } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord.js';
import { MODULE_KEYS, PlatformError, authorizeTenant, dashboardCan, permitScope, snowflake } from './catalog.js';
import { createGuildConfigurationService, validateConfiguration } from './configuration.js';
import { createEntitlementService } from './entitlements.js';
import { MODULE_FIELDS, COLLECTIONS } from './fields.js';
import { thresholds } from '../progression-config.js';
import { hasPermission } from '../permissions.js';
import { TARGET_GUILD_ID } from '../config.js';
import { validatePublicFeedSource } from './source-policy.js';
import { calculateLevel } from './activity.js';
import { safetyReply } from '../ai-safety.js';

const record = row => ({
  id: String(row.record_id ?? row.id), title: row.title ?? row.action ?? 'Record',
  data: row.data ?? {}, revision: Number(row.revision ?? 1),
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
});
export function defaultModule(key, legacy, env) {
  const settings = {
    ai: { allowedChannels: legacy ? (env.AGENT_SMITH_CHAT_CHANNEL_IDS ?? '').split(',').filter(Boolean) : [],
      mentionOnly: true, maxTokens: Number(env.AI_MAX_RESPONSE_TOKENS ?? 2048), ttlMinutes: 20,
      cooldownSeconds: 5, model: env.AI_MODEL ?? 'gpt-5.4-mini', personalityAdditions: '' },
    onboarding: { primaryFrameworks: legacy ? ['Faith', 'Gaming', 'Tech'] : [],
      humanApprovalForExtras: true, steps: [
        { type: 'MESSAGE', title: 'Welcome', content: 'Welcome to the community.' },
        { type: 'RULES_ACCEPTANCE', title: 'Rules', content: 'Read and accept the community rules.' },
        { type: 'ROLE_SELECT', title: 'Choose a primary community', content: '' },
        { type: 'ROLE_SELECT', title: 'Choose interests', content: '' },
        { type: 'FINALIZATION', title: 'Finish', content: '' },
      ] },
    leveling: { textEnabled: true, textAmount: 5, cooldownSeconds: 60, dailyCap: 60,
      eligibleChannels: [], excludedChannels: [], thresholds },
    automod: { inviteFilter: false, duplicateMessages: true, maxMentions: 5,
      capsThreshold: 80, emojiThreshold: 20, blockedDomains: [], bannedTerms: [],
      excludedChannels: [], excludedRoles: [], action: 'LOG' },
    economy: { currencyName: 'Community credits', dailyAmount: 25, cooldownHours: 24 },
    roles: { selfAssignableRoles: [], rewardableRoles: [], protectedRoles: [], roleGroups: [] },
    welcome: { channelId: null, message: 'Welcome {user} to {server}.', embedTitle: 'Welcome', description: '' },
    analytics: { collectActivity: true }, feeds: { pollMinutes: 15 }, youtube: { pollMinutes: 15 },
  };
  return { moduleKey: key, enabled: legacy ?
    !['tickets', 'achievements', 'welcome', 'events'].includes(key) : key === 'analytics',
  configuration: settings[key] ?? {}, revision: 0 };
}

export function createPlatformService({ pool, discord, env = process.env, legacyActions = () => null, ticketActions }) {
  const configuration = createGuildConfigurationService(pool, { onSave: async (db, change) => {
    if (change.guildId !== TARGET_GUILD_ID) return;
    if (change.key === 'leveling' || change.key === 'economy') {
      const key = change.key === 'leveling' ? 'text-xp' : 'economy-enabled';
      const value = change.key === 'leveling' ? {
        enabled: change.enabled && change.configuration.textEnabled,
        excludedChannels: change.configuration.excludedChannels,
      } : change.enabled;
      const previous = (await db.query('SELECT value FROM bot_settings WHERE guild_id=$1 AND key=$2 FOR UPDATE',
        [change.guildId, key])).rows[0]?.value;
      const next = change.key === 'leveling' ? { ...previous, ...value } : value;
      await db.query(
        `INSERT INTO bot_settings(guild_id,key,value) VALUES($1,$2,$3)
         ON CONFLICT(guild_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
        [change.guildId, key, JSON.stringify(next)]);
    }
  } });
  const entitlements = createEntitlementService(pool);
  async function adopt(guild) {
    const legacy = guild.id === TARGET_GUILD_ID;
    await pool.query(
      `INSERT INTO platform_guilds(guild_id,policy_key,settings,setup_complete)
       VALUES($1,$2,$3,$4) ON CONFLICT(guild_id) DO UPDATE SET installed=true,updated_at=now()`,
      [guild.id, legacy ? 'hallowed-core' : 'standard', { name: guild.name }, legacy]);
    // Grandfather existing Hallowed Core capacity; no retroactive free-tier shutdown.
    await pool.query(
      `INSERT INTO platform_entitlements(guild_id,limit_overrides) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [guild.id, legacy ? { feeds: -1, ticket_panels: -1, custom_rank_cards: -1, ai_monthly_requests: -1 } : {}]);
    return guild;
  }
  async function authorize(userId, guildId, capability, write = false) {
    let authority;
    const permit = await authorizeTenant({ userId, guildId, capability, write,
      resolve: async () => {
        authority = await discord.authority({ guildId, userId, pool });
        return authority;
      } });
    // Authenticated installed guilds are adopted without touching legacy records.
    await adopt(authority.guild);
    return { permit, ...authority };
  }
  function guildDTO(authority, row) {
    return { id: authority.guild.id, name: authority.guild.name,
      icon: authority.guild.icon ?? null, role: authority.role,
      setupComplete: row?.setup_complete ?? authority.guild.id === TARGET_GUILD_ID,
      policy: row?.policy_key ?? (authority.guild.id === TARGET_GUILD_ID ? 'hallowed-core' : 'standard') };
  }
  async function listGuilds(session) {
    const guilds = [];
    let after;
    for (let page = 0; page < 20; page++) {
      const batch = await session.api(`/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`);
      if (!Array.isArray(batch)) throw new PlatformError('discord_identity_unavailable', 503);
      guilds.push(...batch);
      if (batch.length < 200) break;
      after = batch.at(-1).id;
    }
    const result = [];
    // Avoid a burst of parallel fresh guild permission requests.
    for (const guild of guilds) {
      const manageable = guild.owner || (BigInt(guild.permissions ?? '0') & (P.ManageGuild | P.Administrator)) !== 0n;
      const manager = manageable ? true : (await pool.query(
        'SELECT 1 FROM platform_managers WHERE guild_id=$1 AND user_id=$2', [guild.id, session.userId])).rows.length;
      if (!manager) continue;
      const authority = await discord.authority({ guildId: guild.id, userId: session.userId, pool });
      if (!authority) continue;
      await adopt(authority.guild);
      const row = (await pool.query('SELECT setup_complete,policy_key FROM platform_guilds WHERE guild_id=$1', [guild.id])).rows[0];
      result.push(guildDTO(authority, row));
    }
    return result;
  }
  function presentModule(row, authority) {
    const base = defaultModule(row.module_key, authority.guild.id === TARGET_GUILD_ID, env);
    const runtimeStatus = ['ai', 'analytics'].includes(row.module_key) ||
      ['leveling', 'tickets'].includes(row.module_key) && authority.guild.id !== TARGET_GUILD_ID ?
      'Platform runtime' : authority.guild.id === TARGET_GUILD_ID ?
      ['moderation', 'automod', 'onboarding', 'roles', 'leveling', 'economy', 'rewards', 'feeds', 'youtube'].includes(row.module_key) ?
        'Existing Hallowed Core service; protected policy retained. Some settings remain draft.' :
        'Configuration foundation; runtime activation pending' : 'Configuration foundation; runtime activation pending';
    return { moduleKey: row.module_key, enabled: row.enabled,
      configuration: { ...base.configuration, ...row.configuration_json },
      revision: row.revision, editable: dashboardCan(authority.role, row.module_key, true),
      fields: MODULE_FIELDS[row.module_key], runtimeStatus };
  }
  async function modules(authority) {
    const rows = (await pool.query(
      'SELECT module_key,enabled,configuration_json,revision FROM platform_modules WHERE guild_id=$1',
      [authority.guild.id])).rows;
    return MODULE_KEYS.filter(key => dashboardCan(authority.role, key)).map(key => {
      const row = rows.find(row => row.module_key === key);
      return row ? presentModule(row, authority) : presentModule({
        module_key: key, enabled: defaultModule(key, authority.guild.id === TARGET_GUILD_ID, env).enabled,
        configuration_json: {}, revision: 0,
      }, authority);
    });
  }
  async function validateFields(data, fields, authority) {
    const sanitized = validateConfiguration(data);
    for (const key of Object.keys(sanitized)) {
      if (!fields.some(field => field.key === key)) throw new PlatformError('unknown_configuration_field');
    }
    const configuredRewardable = (await pool.query(
      `SELECT configuration_json FROM platform_modules WHERE guild_id=$1 AND module_key='roles'`,
      [authority.guild.id])).rows[0]?.configuration_json.rewardableRoles ?? [];
    for (const field of fields) {
      const value = sanitized[field.key];
      if (value === undefined) continue;
      if (value === null) {
        if (!['channel', 'role', 'text'].includes(field.type)) throw new PlatformError('invalid_null');
        continue;
      }
      if (field.type === 'boolean' && typeof value !== 'boolean') throw new PlatformError('invalid_boolean');
      if (field.type === 'number' && (!Number.isSafeInteger(value) || value < field.min || value > field.max)) throw new PlatformError('invalid_number');
      if (['text', 'select'].includes(field.type) && (typeof value !== 'string' || value.length > 2000)) throw new PlatformError('invalid_text');
      if (field.type === 'select' && !field.options.includes(value)) throw new PlatformError('invalid_option');
      if (field.key === 'personalityAdditions' && safetyReply(value)) throw new PlatformError('unsafe_personality_additions');
      if (field.key === 'mentionOnly' && value !== true) throw new PlatformError('outside_channel_mentions_are_required');
      if (field.key === 'questions' && (!Array.isArray(value) || value.length > 5 ||
          new Set(value.map(q => q?.id)).size !== value.length || value.some(q => !q ||
          typeof q.id !== 'string' || !/^[a-z0-9_-]{1,30}$/.test(q.id) || typeof q.label !== 'string' ||
          !q.label.trim() || q.label.length > 45 || q.required !== undefined && typeof q.required !== 'boolean' ||
          q.maxLength !== undefined && (!Number.isSafeInteger(q.maxLength) || q.maxLength < 1 || q.maxLength > 1000)))) {
        throw new PlatformError('invalid_ticket_questions');
      }
      if (['roles', 'channels'].includes(field.type) && (!Array.isArray(value) || value.length > 100)) throw new PlatformError('invalid_choices');
      if (['role', 'roles', 'channel', 'channels'].includes(field.type)) {
        for (const id of Array.isArray(value) ? value : [value]) {
          snowflake(id);
          if (field.key === 'supportRoles' && id === authority.guild.id) throw new PlatformError('everyone_cannot_be_ticket_support');
          if (['role', 'roles'].includes(field.type)) {
            const role = authority.guild.roles.cache.get(id);
            if (!role) throw new PlatformError('role_not_in_guild');
            if (['roleId', 'rewardRoleId', 'rewardableRoles', 'selfAssignableRoles'].includes(field.key)) {
              discord.assertRewardRole(role, authority.guild, authority.actor);
              if (['roleId', 'rewardRoleId'].includes(field.key) && !configuredRewardable.includes(id)) {
                throw new PlatformError('role_not_marked_bot_rewardable');
              }
            }
          } else {
            const channel = authority.guild.channels.cache.get(id);
            if (!channel || !hasPermission(authority.actor, P.ViewChannel, channel) ||
                !hasPermission(authority.guild.members.me, P.ViewChannel, channel)) throw new PlatformError('channel_not_authorized');
          }
        }
      }
      if (field.type === 'steps') {
        if (!Array.isArray(value) || value.length > 30 || value.some(step =>
          !['MESSAGE', 'RULES_ACCEPTANCE', 'ROLE_SELECT', 'QUESTION', 'BUTTON', 'FINALIZATION'].includes(step.type) ||
          typeof step.title !== 'string' || step.title.length > 150 ||
          typeof step.content !== 'string' || step.content.length > 2000)) throw new PlatformError('invalid_onboarding_steps');
      }
    }
    return sanitized;
  }
  async function updateModule(authority, key, input) {
    const fields = MODULE_FIELDS[key];
    if (!fields) throw new PlatformError('unknown_module');
    const sanitized = await validateFields(input.configuration, fields, authority);
    // No dashboard replacement of stable native access or staff safety.
    if (authority.guild.id === TARGET_GUILD_ID && ['onboarding', 'roles', 'moderation', 'automod'].includes(key) &&
        input.enabled !== true) throw new PlatformError('hallowed_core_safety_module_cannot_be_disabled');
    if (authority.guild.id === TARGET_GUILD_ID && key === 'leveling' && input.enabled &&
        sanitized.textEnabled && env.SMITH_ENABLE_MESSAGE_CONTENT !== 'true') throw new PlatformError('message_content_intent_required');
    if (authority.guild.id === TARGET_GUILD_ID && key === 'onboarding') {
      if (JSON.stringify(sanitized.primaryFrameworks) !== JSON.stringify(['Faith', 'Gaming', 'Tech']) ||
          sanitized.humanApprovalForExtras !== true) throw new PlatformError('hallowed_core_access_policy_is_protected');
    }
    const saved = await configuration.updateGuildModuleConfig(authority.permit, key, { ...input, configuration: sanitized });
    return presentModule({ module_key: key, ...saved }, authority);
  }
  async function resources(authority) {
    return {
      channels: [...authority.guild.channels.cache.values()].filter(c => !c.isThread?.() &&
        hasPermission(authority.actor, P.ViewChannel, c) && hasPermission(authority.guild.members.me, P.ViewChannel, c))
        .map(c => ({ id: c.id, name: c.name })),
      roles: [...authority.guild.roles.cache.values()].map(role => ({
        id: role.id, name: role.name, protected: discord.protectedRole(role, authority.guild),
        rewardable: !discord.protectedRole(role, authority.guild),
      })),
    };
  }
  async function audit(db, authority, action, module, before, after) {
    await db.query(
      `INSERT INTO platform_audit(guild_id,actor_user_id,action,module,before_state,after_state)
       VALUES($1,$2,$3,$4,$5,$6)`, [authority.guild.id, authority.actor.id, action, module, before, after]);
  }
  async function collection(authority, key) {
    const descriptor = COLLECTIONS[key];
    if (!descriptor) throw new PlatformError('unknown_collection');
    permitScope(authority.permit, descriptor.module);
    const id = authority.guild.id;
    let records, editable = !!descriptor.fields.length && dashboardCan(authority.role, descriptor.module, true);
    const descriptions = {
      cases: 'Existing moderation cases. Closing a case never removes an active restriction.',
      reports: 'Existing member reports. Only authorized staff can review these.',
      profiles: 'Recorded member progression; no spiritual worth or authority is implied.',
      leaderboard: 'Actual recorded XP, isolated to this server.',
      feeds: 'Feed source changes require approval before delivery; uncertain deliveries are never auto-reposted.',
      entitlements: 'Configurable plan limits. Payments are disabled.',
      achievements: 'Achievement definitions. Automatic triggers remain inactive until the corresponding activity engine is enabled.',
      events: 'Event planning records; Discord scheduled-event publication is not automatic.',
    };
    if (key === 'cases') records = (await pool.query(
      'SELECT case_id,action_type,reason,status,user_id,created_at FROM moderation_cases WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 100', [id])).rows
      .map(row => record({ record_id: row.case_id, title: row.action_type, data: row, created_at: row.created_at }));
    else if (key === 'reports') records = (await pool.query(
      'SELECT id,reporter_id,target_id,status,created_at FROM member_reports WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 100', [id])).rows
      .map(row => record({ record_id: row.id, title: `Report ${row.id}`, data: row, created_at: row.created_at }));
    else if (['leaderboard', 'profiles'].includes(key)) {
      if (id === TARGET_GUILD_ID) records = (await pool.query(
        'SELECT user_id,framework,xp,faith_approved FROM progression_balances WHERE guild_id=$1 ORDER BY xp DESC LIMIT 100', [id])).rows
        .map(row => record({ record_id: `${row.user_id}:${row.framework}`, title: `${row.framework} · ${row.user_id}`, data: row }));
      else {
        const config = (await pool.query(
          `SELECT configuration_json FROM platform_modules WHERE guild_id=$1 AND module_key='leveling'`, [id])).rows[0]?.configuration_json ??
          defaultModule('leveling', false, env).configuration;
        records = (await pool.query(
          'SELECT user_id,xp,created_at FROM platform_member_profiles WHERE guild_id=$1 ORDER BY xp DESC LIMIT 100', [id])).rows
          .map(row => record({ record_id: row.user_id, title: row.user_id,
            data: { userId: row.user_id, xp: Number(row.xp), level: calculateLevel(Number(row.xp), config.thresholds) }, created_at: row.created_at }));
      }
    }
    else if (key === 'audit') records = (await pool.query(
      'SELECT id,action,module,actor_user_id,before_state,after_state,created_at FROM platform_audit WHERE guild_id=$1 ORDER BY id DESC LIMIT 100', [id])).rows
      .map(row => record({ ...row, data: row }));
    else if (key === 'entitlements') {
      const data = await entitlements.getPlan(authority.permit);
      records = [record({ record_id: 'plan', title: data.plan, data })]; editable = false;
    } else if (key === 'tickets') records = (await pool.query(
      'SELECT ticket_id,creator_id,channel_id,claimed_by,status,created_at FROM platform_ticket_channels WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 100', [id])).rows
      .map(row => record({ record_id: row.ticket_id, title: `Ticket ${row.ticket_id.slice(0, 8)}`, data: row, created_at: row.created_at }));
    else if (key === 'managers') {
      editable = authority.role === 'OWNER';
      records = (await pool.query('SELECT user_id,dashboard_role,created_at FROM platform_managers WHERE guild_id=$1', [id])).rows
        .map(row => record({ record_id: row.user_id, title: row.user_id, data: { userId: row.user_id, role: row.dashboard_role }, created_at: row.created_at }));
    } else if (key === 'shop') records = (await pool.query(
      'SELECT item_id,title,price,enabled FROM community_shop WHERE guild_id=$1 ORDER BY title LIMIT 100', [id])).rows
      .map(row => record({ record_id: row.item_id, title: row.title, data: { price: row.price, enabled: row.enabled } }));
    else records = (await pool.query(
      'SELECT record_id,title,data,revision,created_at FROM platform_records WHERE guild_id=$1 AND collection=$2 ORDER BY created_at DESC LIMIT 100',
      [id, key])).rows.map(record);
    return { records, editable, fields: descriptor.fields,
      description: descriptions[key] ?? 'Configuration records belong only to this server. Changes are audited.' };
  }
  async function saveRecord(authority, key, input, recordId) {
    const descriptor = COLLECTIONS[key];
    if (!descriptor?.fields.length) throw new PlatformError('read_only_collection');
    permitScope(authority.permit, descriptor.module, true);
    const fieldsInput = { ...input.data };
    if (key === 'ticket-panels') {
      for (const field of ['publishedChannelId', 'publishedMessageId', 'publishedRevision']) delete fieldsInput[field];
    }
    const data = await validateFields(fieldsInput, descriptor.fields, authority);
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 150) throw new PlatformError('invalid_title');
    const id = authority.guild.id;
    if (key === 'managers') {
      if (authority.role !== 'OWNER') throw new PlatformError('owner_required', 403);
      snowflake(data.userId);
      await authority.guild.members.fetch({ user: data.userId, force: true });
      if (data.userId === authority.guild.ownerId) throw new PlatformError('owner_role_cannot_be_overridden');
      recordId = data.userId;
    }
    if (key === 'feeds') {
      validatePublicFeedSource(data.source);
      // A saved feed starts as a draft. Explicit source approval is separate.
      data.enabled = false; data.approvalStatus = 'draft';
    }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT guild_id FROM platform_guilds WHERE guild_id=$1 FOR UPDATE', [id]);
      const old = recordId ? (await db.query(
        'SELECT title,data,revision FROM platform_records WHERE guild_id=$1 AND collection=$2 AND record_id=$3 FOR UPDATE', [id, key, recordId])).rows[0] : null;
      if (recordId && !['shop', 'managers'].includes(key) && !old) throw new PlatformError('record_not_found', 404);
      if (old && old.revision !== input.revision) throw new PlatformError('record_changed_reload', 409);
      if (!recordId && ['feeds', 'ticket-panels'].includes(key)) {
        const count = Number((await db.query(
          'SELECT count(*) AS count FROM platform_records WHERE guild_id=$1 AND collection=$2', [id, key])).rows[0].count);
        const scopedPlan = (await db.query(
          'SELECT plan,limit_overrides FROM platform_entitlements WHERE guild_id=$1', [id])).rows[0];
        const { DEFAULT_PLANS } = await import('./catalog.js');
        const feature = key === 'feeds' ? 'feeds' : 'ticket_panels';
        const plan = Object.hasOwn(DEFAULT_PLANS, scopedPlan?.plan) ? scopedPlan.plan : 'FREE';
        const limit = scopedPlan?.limit_overrides?.[feature] ?? DEFAULT_PLANS[plan][feature];
        if (limit !== -1 && count >= limit) throw new PlatformError('plan_limit_reached', 409);
      }
      recordId ??= randomUUID();
      if (key === 'shop') await db.query(
        `INSERT INTO community_shop(guild_id,item_id,title,price,enabled) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(guild_id,item_id) DO UPDATE SET title=EXCLUDED.title,price=EXCLUDED.price,enabled=EXCLUDED.enabled`,
        [id, recordId, input.title.trim(), data.price, data.enabled === true]);
      if (key === 'managers') await db.query(
        `INSERT INTO platform_managers(guild_id,user_id,dashboard_role,added_by) VALUES($1,$2,$3,$4)
         ON CONFLICT(guild_id,user_id) DO UPDATE SET dashboard_role=EXCLUDED.dashboard_role,added_by=EXCLUDED.added_by`,
        [id, data.userId, data.role, authority.actor.id]);
      const saved = (await db.query(
        `INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by,revision)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(guild_id,collection,record_id) DO UPDATE SET title=EXCLUDED.title,data=EXCLUDED.data,
          revision=EXCLUDED.revision,updated_at=now() RETURNING *`,
        [id, key, recordId, input.title.trim(), data, authority.actor.id, (old?.revision ?? 0) + 1])).rows[0];
      await audit(db, authority, old ? 'record_updated' : 'record_created', descriptor.module,
        old ? { title: old.title, data: old.data } : {}, { title: input.title.trim(), data });
      await db.query('COMMIT');
      return record(saved);
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  async function deleteRecord(authority, key, recordId) {
    const descriptor = COLLECTIONS[key];
    if (!descriptor?.fields.length) throw new PlatformError('read_only_collection');
    permitScope(authority.permit, descriptor.module, true);
    if (key === 'managers' && authority.role !== 'OWNER') throw new PlatformError('owner_required', 403);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const old = (await db.query(
        'DELETE FROM platform_records WHERE guild_id=$1 AND collection=$2 AND record_id=$3 RETURNING title,data',
        [authority.guild.id, key, recordId])).rows[0];
      if (key === 'managers') await db.query(
        'DELETE FROM platform_managers WHERE guild_id=$1 AND user_id=$2', [authority.guild.id, recordId]);
      else if (key === 'shop') await db.query(
        'UPDATE community_shop SET enabled=false WHERE guild_id=$1 AND item_id=$2', [authority.guild.id, recordId]);
      if (!old && !['shop', 'managers'].includes(key)) throw new PlatformError('record_not_found', 404);
      await audit(db, authority, 'record_removed', descriptor.module, old ?? { recordId }, {});
      await db.query('COMMIT');
      return { ok: true, message: key === 'shop' ? 'Shop item disabled; existing inventory retained.' : 'Record removed.' };
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  async function overview(authority) {
    const id = authority.guild.id;
    const result = (await pool.query(
      `SELECT
        CASE WHEN $1=$2 THEN (SELECT count(*) FROM members WHERE guild_id=$1 AND left_at IS NULL)
         ELSE (SELECT count(*) FROM platform_member_profiles WHERE guild_id=$1) END AS members,
       (SELECT count(*) FROM moderation_cases WHERE guild_id=$1 AND closed_at IS NULL) AS cases,
       (SELECT count(*) FROM member_reports WHERE guild_id=$1 AND status='open') AS reports,
        CASE WHEN $1=$2 THEN (SELECT COALESCE(sum(xp),0) FROM progression_balances WHERE guild_id=$1)
         ELSE (SELECT COALESCE(sum(xp),0) FROM platform_member_profiles WHERE guild_id=$1) END AS xp,
       (SELECT count(*) FROM platform_activity WHERE guild_id=$1 AND kind='message' AND occurred_at>=date_trunc('day',now())) AS messages,
       (SELECT count(*) FROM platform_activity WHERE guild_id=$1 AND kind='join' AND occurred_at>=date_trunc('day',now())) AS joins,
       (SELECT count(*) FROM platform_activity WHERE guild_id=$1 AND kind='leave' AND occurred_at>=date_trunc('day',now())) AS leaves,
       (SELECT count(DISTINCT user_hash) FROM platform_activity WHERE guild_id=$1 AND occurred_at>=date_trunc('day',now())) AS active`,
       [id, TARGET_GUILD_ID])).rows[0];
    const data = [
      ['members', id === TARGET_GUILD_ID ? 'Recorded members' : 'Recorded XP profiles', result.members], ['messages', 'Messages today (UTC)', result.messages],
      ['active', 'Active today (UTC)', result.active], ['joins', 'New members today (UTC)', result.joins],
      ['leaves', 'Members left today (UTC)', result.leaves], ['xp', 'Recorded XP', result.xp],
    ];
    if (dashboardCan(authority.role, 'moderation')) data.push(['cases', 'Open moderation cases', result.cases], ['reports', 'Pending reports', result.reports]);
    const row = (await pool.query('SELECT setup_complete,policy_key FROM platform_guilds WHERE guild_id=$1', [id])).rows[0];
    const planRow = (await pool.query('SELECT plan FROM platform_entitlements WHERE guild_id=$1', [id])).rows[0];
    const recentActions = dashboardCan(authority.role, 'audit') ? (await pool.query(
      'SELECT id,action,module,created_at FROM platform_audit WHERE guild_id=$1 ORDER BY id DESC LIMIT 6', [id])).rows.map(row => record({ ...row, data: { module: row.module } })) : [];
    return { guild: guildDTO(authority, row), metrics: [
      ...data.map(([key, label, value]) => ({ key, label, value: Number(value) })),
      { key: 'voice', label: 'Voice hours', value: null, reason: 'Voice tracking is not yet enabled; no fabricated historical data.' },
      { key: 'retention', label: 'Retention', value: null, reason: 'Requires a sufficient observed history.' },
    ], recentActions, warnings: ['Activity counts begin when collection is enabled; they are not a backfill of Discord history.',
      id === TARGET_GUILD_ID ? 'Hallowed Core access, Owner protection and native onboarding remain guarded.' :
        'Second-server runtime verification is required before broader installation.'],
    botOnline: discord.client.isReady(), plan: planRow?.plan ?? 'FREE' };
  }
  async function setup(authority, input) {
    if (authority.role !== 'OWNER') throw new PlatformError('owner_required', 403);
    if (!Array.isArray(input.modules) || input.modules.some(key => !MODULE_KEYS.includes(key))) throw new PlatformError('unknown_module');
    for (const id of [input.logChannelId, input.welcomeChannelId].filter(Boolean)) {
      const channel = authority.guild.channels.cache.get(snowflake(id));
      if (!channel || !hasPermission(authority.actor, P.ViewChannel, channel)) throw new PlatformError('channel_not_authorized');
    }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT guild_id FROM platform_guilds WHERE guild_id=$1 FOR UPDATE', [authority.guild.id]);
      await db.query('UPDATE platform_guilds SET setup_complete=true,settings=settings||$2::jsonb,updated_at=now() WHERE guild_id=$1',
        [authority.guild.id, { logChannelId: input.logChannelId, welcomeChannelId: input.welcomeChannelId }]);
      for (const key of MODULE_KEYS) {
        const defaults = defaultModule(key, authority.guild.id === TARGET_GUILD_ID, env);
        await db.query(
          `INSERT INTO platform_modules(guild_id,module_key,enabled,configuration_json,updated_by)
           VALUES($1,$2,$3,$4,$5) ON CONFLICT(guild_id,module_key) DO NOTHING`,
          [authority.guild.id, key, input.modules.includes(key), defaults.configuration, authority.actor.id]);
      }
      await audit(db, authority, 'setup_completed', 'settings', {}, input);
      await db.query('COMMIT');
      return { ok: true, message: 'Setup saved. No bulk channels, roles or permissions were created.' };
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  async function action(authority, input) {
    if (typeof input.action === 'string' && input.action.startsWith('ticket-')) {
      if (!ticketActions) throw new PlatformError('ticket_runtime_not_available_in_readonly_preview', 409);
      return ticketActions(authority, input);
    }
    const actions = legacyActions(authority.guild.id);
    if (input.action === 'case-note') {
      if (!actions?.cases) throw new PlatformError('guarded_runtime_not_available', 503);
      await actions.cases.note(input.target, authority.actor.id, input.note ?? '');
    } else if (input.action === 'case-close') {
      if (!input.confirmed) throw new PlatformError('confirmation_required');
      if (!actions?.cases) throw new PlatformError('guarded_runtime_not_available', 503);
      await actions.cases.close(input.target, authority.actor.id);
    } else if (input.action === 'report-review') {
      throw new PlatformError('review_report_through_existing_staff_controls', 409);
    } else throw new PlatformError('unsupported_or_unsafe_action', 400);
    await audit(pool, authority, input.action, 'moderation', {}, { target: input.target });
    return { ok: true, message: 'Guarded action completed. Existing restrictions are unchanged.' };
  }
  return { authorize, adopt, listGuilds, modules, updateModule, resources, collection,
    saveRecord, deleteRecord, overview, setup, action, entitlements };
}
