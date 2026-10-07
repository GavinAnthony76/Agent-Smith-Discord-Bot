import { pool } from './db.js';
import { readFile } from 'node:fs/promises';
const db=await pool.connect();
try {
 await db.query('BEGIN');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['smith-maintenance-migration']);
 await db.query(await readFile(new URL('./maintenance-schema.sql',import.meta.url),'utf8'));
 await db.query('COMMIT');
 console.log('Additive maintenance migration applied. No Discord writes or existing table drops.');
}catch(error){await db.query('ROLLBACK');throw error;}
finally{db.release();await pool.end();}
