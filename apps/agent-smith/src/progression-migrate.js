import { readFile } from 'node:fs/promises';
import { pool, audit } from './db.js';
import { config } from './config.js';
import { importLegacyBalances } from './progression-legacy.js';
const cfg = config();
const apply = process.argv.includes('--apply');
// This flag is an explicit provenance attestation, never inferred from a
// member's current framework or from a multiple-of-ten balance.
const verified = process.argv.includes('--verified-gaming-trivia');
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`progression-migration:${cfg.guildId}`]);
  let report;
  if (apply) {
    await db.query(await readFile(new URL('./progression-schema.sql', import.meta.url), 'utf8'));
    report = await importLegacyBalances(db, { guildId: cfg.guildId, actor: cfg.clientId, verifiedGamingSource: verified, audit });
    await audit(db, cfg.clientId, 'progression-schema-ready', report);
    await db.query('COMMIT');
  } else {
    report = await importLegacyBalances(db, { guildId: cfg.guildId, actor: cfg.clientId, verifiedGamingSource: verified, audit, apply: false });
    await db.query('ROLLBACK');
  }
  console.log(JSON.stringify(report));
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { db.release(); await pool.end(); }
