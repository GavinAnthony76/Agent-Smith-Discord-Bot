import { PlatformError, moduleKey, permitScope } from './catalog.js';

// Tenant additions cannot weaken immutable platform safety instructions.
const forbidden = /(?:^(?:(?:access|refresh|discord|bot)[_-]?)?token$|secret|password|api.?key|system.?prompt|security.?instructions|owner.?ids|bootstrap)/i;
function inspect(value, depth = 0) {
  if (depth > 8) throw new PlatformError('configuration_too_deep');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (value.length > 200) throw new PlatformError('configuration_too_large');
    for (const item of value) inspect(item, depth + 1);
    return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new PlatformError('invalid_configuration');
  }
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new PlatformError('protected_configuration');
    }
    inspect(item, depth + 1);
  }
}

export function validateConfiguration(configuration) {
  if (!configuration || Array.isArray(configuration) || typeof configuration !== 'object') {
    throw new PlatformError('invalid_configuration');
  }
  inspect(configuration);
  const encoded = JSON.stringify(configuration);
  if (Buffer.byteLength(encoded) > 16000) throw new PlatformError('configuration_too_large');
  return JSON.parse(encoded);
}

export function createGuildConfigurationService(pool, { onSave = async () => {}, beforeSave = async () => {} } = {}) {
  async function getGuildSettings(permit) {
    const { guildId } = permitScope(permit, 'settings');
    const result = await pool.query(
      'SELECT guild_id,settings,policy_key,setup_complete FROM platform_guilds WHERE guild_id=$1 AND installed=true',
      [guildId]);
    if (!result.rows[0]) throw new PlatformError('guild_access_denied', 403);
    return result.rows[0];
  }
  async function getGuildModuleConfig(permit, key) {
    moduleKey(key);
    const { guildId } = permitScope(permit, key);
    const result = await pool.query(
      'SELECT module_key,enabled,configuration_json,revision FROM platform_modules WHERE guild_id=$1 AND module_key=$2',
      [guildId, key]);
    return result.rows[0] ?? { module_key: key, enabled: false, configuration_json: {}, revision: 0 };
  }
  async function updateGuildModuleConfig(permit, key, { enabled, configuration, revision }) {
    moduleKey(key);
    const { guildId, userId } = permitScope(permit, key, true);
    if (typeof enabled !== 'boolean' || !Number.isSafeInteger(revision) || revision < 0) {
      throw new PlatformError('invalid_module_update');
    }
    const sanitized = validateConfiguration(configuration);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      // Lock even when the child module does not exist, preventing first-write races.
      const guild = await db.query(
        'SELECT guild_id FROM platform_guilds WHERE guild_id=$1 AND installed=true FOR UPDATE', [guildId]);
      if (!guild.rows.length) throw new PlatformError('guild_access_denied', 403);
      const old = (await db.query(
        'SELECT enabled,configuration_json,revision FROM platform_modules WHERE guild_id=$1 AND module_key=$2 FOR UPDATE',
        [guildId, key])).rows[0] ?? { enabled: false, configuration_json: {}, revision: 0 };
      if (old.revision !== revision) throw new PlatformError('configuration_changed_reload', 409);
      await beforeSave(db, { guildId, userId, key, enabled, configuration: sanitized });
      const next = (await db.query(
        `INSERT INTO platform_modules(guild_id,module_key,enabled,configuration_json,updated_by,revision)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,
          configuration_json=EXCLUDED.configuration_json,updated_by=EXCLUDED.updated_by,
          revision=EXCLUDED.revision,updated_at=now()
         RETURNING module_key,enabled,configuration_json,revision`,
        [guildId, key, enabled, sanitized, userId, revision + 1])).rows[0];
      await db.query(
        `INSERT INTO platform_audit(guild_id,actor_user_id,action,module,before_state,after_state)
         VALUES($1,$2,'module_configuration_updated',$3,$4,$5)`,
        [guildId, userId, key, { enabled: old.enabled, configuration: old.configuration_json }, { enabled, configuration: sanitized }]);
      await onSave(db, { guildId, userId, key, enabled, configuration: sanitized });
      await db.query('COMMIT');
      return next;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally { db.release(); }
  }
  return { getGuildSettings, getGuildModuleConfig, updateGuildModuleConfig };
}
