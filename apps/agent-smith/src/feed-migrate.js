import { pool } from './db.js';
import { readFile } from 'node:fs/promises';
import { runLocked } from './transaction.js';
try {
  await runLocked(pool,'smith-feed-migration',async db=>{
    await db.query(await readFile(new URL('./feed-schema.sql',import.meta.url),'utf8'));
  });
  console.log('Additive feed migration applied; source approval and feed history unchanged.');
} finally {await pool.end();}
