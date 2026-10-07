import pg from 'pg';
import { assertFeedSchema } from './feed-schema-check.js';

if (!process.env.DATABASE_URL) {
  console.error('Feed schema check requires the managed development DATABASE_URL.');
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  try {
    await assertFeedSchema(pool);
    console.log('Required feed schema verified read-only; no Discord login or database writes.');
  } catch (error) {
    console.error(error.code === 'SMITH_FEED_SCHEMA_MISSING'
      ? error.message
      : `Feed schema check failed (${error.code ?? 'connection error'}). No schema changes attempted.`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
