import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MODULE_KEYS, PlatformError } from './catalog.js';
import { LMOC_TEST_ID, platformAllowlist } from './activation.js';

export const configurationDigest = bundle => createHash('sha256').update(JSON.stringify(bundle)).digest('hex');

export function validateReleaseConfiguration(bundle) {
  if (bundle?.guildId !== LMOC_TEST_ID || bundle.setupComplete !== true ||
      bundle.version !== 1 || !bundle.settings || !Array.isArray(bundle.modules) ||
      bundle.modules.length !== MODULE_KEYS.length ||
      new Set(bundle.modules.map(m => m.moduleKey)).size !== MODULE_KEYS.length ||
      bundle.modules.some(m => !MODULE_KEYS.includes(m.moduleKey) || typeof m.enabled !== 'boolean' ||
        !Number.isSafeInteger(m.revision) || m.revision < 1 ||
        Object.keys(m).some(key => !['moduleKey','enabled','revision','configuration'].includes(key)) ||
        !m.configuration || typeof m.configuration !== 'object' || Array.isArray(m.configuration))) {
    throw new PlatformError('invalid_reviewed_lmoc_configuration', 503);
  }
  if (Object.keys(bundle).some(key => !['version','guildId','setupComplete','settings','modules'].includes(key)))
    throw new PlatformError('unrelated_release_data_refused', 503);
  if (Object.keys(bundle.settings).some(key => !['name','logChannelId','welcomeChannelId'].includes(key)))
    throw new PlatformError('unrelated_release_settings_refused',503);
  return bundle;
}

/** Explicit, digest-approved configuration seed; no DDL, history, identities or legacy data. */
export async function seedReviewedConfiguration({ pool, client, env = process.env, bundle }) {
  if (!env.PLATFORM_LMOC_CONFIG_SHA256) return { skipped: true };
  bundle = validateReleaseConfiguration(bundle);
  const digest = configurationDigest(bundle);
  if (digest !== env.PLATFORM_LMOC_CONFIG_SHA256 ||
      !platformAllowlist(env).has(bundle.guildId) || !client.isReady() ||
      !client.guilds.cache.has(bundle.guildId)) throw new PlatformError('lmoc_release_seed_not_authorized', 503);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`release-config:${bundle.guildId}`]);
    const imported = (await db.query(`SELECT 1 FROM platform_audit WHERE guild_id=$1
      AND action='reviewed_configuration_import' AND after_state->>'digest'=$2`, [bundle.guildId,digest])).rowCount;
    if (imported) { await db.query('COMMIT'); return { alreadyImported: true, digest }; }
    // Never silently replace a production setup or changes made by its Owner.
    const guild = (await db.query(
      'SELECT setup_complete FROM platform_guilds WHERE guild_id=$1 FOR UPDATE', [bundle.guildId])).rows[0];
    const modules = (await db.query('SELECT 1 FROM platform_modules WHERE guild_id=$1 LIMIT 1', [bundle.guildId])).rowCount;
    if (guild?.setup_complete || modules) throw new PlatformError('existing_production_configuration_requires_review', 409);
    await db.query(`INSERT INTO platform_guilds(guild_id,policy_key,settings,setup_complete,installed)
      VALUES($1,'standard',$2,true,true) ON CONFLICT(guild_id) DO UPDATE SET
      policy_key='standard',settings=EXCLUDED.settings,setup_complete=true,installed=true,updated_at=now()`,
    [bundle.guildId,bundle.settings]);
    for (const module of bundle.modules) await db.query(`INSERT INTO platform_modules
      (guild_id,module_key,enabled,configuration_json,revision,updated_by) VALUES($1,$2,$3,$4,$5,$6)`,
    [bundle.guildId,module.moduleKey,module.enabled,module.configuration,module.revision,client.user.id]);
    await db.query('INSERT INTO platform_entitlements(guild_id) VALUES($1) ON CONFLICT DO NOTHING', [bundle.guildId]);
    await db.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
      VALUES($1,$2,'reviewed_configuration_import','settings',$3)`,
    [bundle.guildId,client.user.id,{digest,modules:bundle.modules.length,source:'reviewed-lmoc-only-configuration'}]);
    await db.query('COMMIT');
    return { imported: true, digest };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

export async function loadReviewedConfiguration() {
  return validateReleaseConfiguration(JSON.parse(await readFile(
    new URL('../../release/lmoc-config.json', import.meta.url), 'utf8')));
}
