import { TARGET_GUILD_ID } from '../config.js';
import { PlatformError } from './catalog.js';

export const STANDARD_MODULES = Object.freeze([
  'welcome', 'onboarding', 'roles', 'leveling', 'economy', 'tickets', 'ai', 'analytics',
]);
export const LMOC_TEST_ID = '1555330318569971743';

export function platformAllowlist(env = process.env) {
  const ids = (env.PLATFORM_ENABLED_GUILD_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  if (ids.some(id => !/^\d{17,20}$/.test(id) || id === TARGET_GUILD_ID)) {
    throw new PlatformError('invalid_standard_platform_allowlist', 503);
  }
  const allowed = new Set(ids);
  return Object.freeze({ has: id => id !== TARGET_GUILD_ID && allowed.has(id), ids: Object.freeze([...allowed]) });
}

export function createActivation({ pool, client, env = process.env }) {
  const allowed = platformAllowlist(env);
  async function refresh(guildId) {
    if (!allowed.has(guildId)) return false;
    const guild = client.guilds.cache.get(guildId);
    if (!client.isReady() || !guild) return false;
    const configured = (await pool.query(
      `SELECT setup_complete FROM platform_guilds WHERE guild_id=$1 AND installed`, [guildId])).rows[0];
    if (!configured?.setup_complete) return false;
    const modules = (await pool.query(
      'SELECT module_key,enabled FROM platform_modules WHERE guild_id=$1', [guildId])).rows;
    if (!STANDARD_MODULES.every(key => modules.some(m => m.module_key === key))) return false;
    const states = Object.fromEntries(STANDARD_MODULES.map(key =>
      [key, modules.some(m => m.module_key === key && m.enabled)]));
    await pool.query(`INSERT INTO platform_runtime_state(guild_id,activated_at,last_seen_at,bot_connected,runtime_active,module_states)
      VALUES($1,now(),now(),true,true,$2) ON CONFLICT(guild_id) DO UPDATE SET
      last_seen_at=now(),bot_connected=true,runtime_active=true,module_states=EXCLUDED.module_states`,
    [guildId, states]);
    return true;
  }
  async function active(guildId) {
    if (!allowed.has(guildId) || !client.isReady()) return false;
    return !!(await pool.query(`SELECT 1 FROM platform_runtime_state WHERE guild_id=$1 AND runtime_active
      AND last_seen_at>now()-interval '90 seconds'`, [guildId])).rowCount;
  }
  async function acceptsEvent(guildId, occurredAt) {
    if (!allowed.has(guildId) || !client.isReady() || !Number.isFinite(occurredAt)) return false;
    return !!(await pool.query(`SELECT 1 FROM platform_runtime_state WHERE guild_id=$1
      AND runtime_active AND last_seen_at>now()-interval '90 seconds'
      AND activated_at<=to_timestamp($2 / 1000.0)`, [guildId,occurredAt])).rowCount;
  }
  async function status(guildId) {
    const platformEnabled = allowed.has(guildId);
    const base = { botConnected: client.isReady(), platformEnabled,
      guildConfigured: false, runtimeActive: false, lastSeenAt: null, activatedAt: null, moduleStates: {} };
    if (!platformEnabled) return base;
    try {
      const row = (await pool.query(`SELECT g.setup_complete,s.* FROM platform_guilds g
        LEFT JOIN platform_runtime_state s USING(guild_id) WHERE g.guild_id=$1`, [guildId])).rows[0];
      if (!row) return base;
      const fresh = row.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < 90000;
      return { ...base, guildConfigured: row.setup_complete,
        runtimeActive: !!(base.botConnected && row.runtime_active && fresh),
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
        activatedAt: row.activated_at ? new Date(row.activated_at).toISOString() : null,
        moduleStates: Object.fromEntries(STANDARD_MODULES.map(key =>
          [key, !!(base.botConnected && row.runtime_active && fresh && row.module_states?.[key])])) };
    } catch {
      return { ...base, statusUnavailable: true };
    }
  }
  async function stop() {
    for (const guildId of allowed.ids) await pool.query(
      'UPDATE platform_runtime_state SET runtime_active=false,bot_connected=false WHERE guild_id=$1', [guildId]);
  }
  return { allowed, refresh, active, acceptsEvent, status, stop };
}

// Public operational booleans only: no identities, messages, configuration or tokens.
export function previewRuntimeStatus(env = process.env) {
  return async guildId => {
    const unknown = { botConnected: null, platformEnabled: false, guildConfigured: false,
      runtimeActive: false, lastSeenAt: null, activatedAt: null, moduleStates: {}, statusUnavailable: true };
    if (!/^\d{17,20}$/.test(guildId)) return unknown;
    if (!env.PLATFORM_RUNTIME_STATUS_URL) return unknown;
    try {
      const url = new URL(env.PLATFORM_RUNTIME_STATUS_URL);
      if (url.protocol !== 'https:' || url.username || url.password) return unknown;
      url.searchParams.set('guildId', guildId);
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) return unknown;
      const data = await response.json();
      if (typeof data.botConnected !== 'boolean' || typeof data.runtimeActive !== 'boolean' ||
          typeof data.platformEnabled !== 'boolean' || typeof data.guildConfigured !== 'boolean') return unknown;
      return { botConnected: data.botConnected, platformEnabled: data.platformEnabled,
        guildConfigured: data.guildConfigured, runtimeActive: data.runtimeActive,
        lastSeenAt: data.lastSeenAt ?? null, activatedAt: data.activatedAt ?? null,
        moduleStates: Object.fromEntries(STANDARD_MODULES.map(key => [key, data.moduleStates?.[key] === true])) };
    } catch { return unknown; }
  };
}
