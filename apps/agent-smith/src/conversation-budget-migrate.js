import { pool } from './db.js';
import { readFile } from 'node:fs/promises';
import { runLocked } from './transaction.js';

try {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Budget migration is development-only. Use Publishing for production schema.');
  await runLocked(pool, 'smith-conversation-budget-migration', async db => {
    await db.query(await readFile(new URL('./conversation-budget-schema.sql', import.meta.url), 'utf8'));
  });
  console.log('Owner-approved additive conversation budget schema applied in development.');
} finally { await pool.end(); }
