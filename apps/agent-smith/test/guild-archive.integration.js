/**
 * Explicit development-only PostgreSQL verification. No Discord/Gateway client.
 * Every application query uses a disposable schema with NO public fallback.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { archiveHistoricalRuntime, LMOC_TEST_ID } from '../src/platform/guild-lifecycle.js';
import { TARGET_GUILD_ID } from '../src/config.js';

if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1' || !process.env.DATABASE_URL)
  throw new Error('Development database required; production/default fallback prohibited.');
const schema=`guild_archive_test_${randomBytes(8).toString('hex')}`;
if (!/^guild_archive_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe schema.');
const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
let pool;

test('archive is atomic, idempotent and preserves all historical evidence and Hallowed Core',async()=>{
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
      options:`-c search_path=${schema}`,application_name:schema});
    assert.equal((await pool.query('SHOW search_path')).rows[0].search_path,schema);
    await pool.query(await readFile(new URL('../src/platform/schema.sql',import.meta.url),'utf8'));
    const actor='90000000000000001';
    for(const id of [LMOC_TEST_ID,TARGET_GUILD_ID]) {
      await pool.query(`INSERT INTO platform_guilds(guild_id,policy_key,settings,setup_complete)
        VALUES($1,'standard','{"name":"Synthetic archive fixture"}',true)`,[id]);
      await pool.query(`INSERT INTO platform_modules(guild_id,module_key,enabled,configuration_json,revision,updated_by)
        VALUES($1,'onboarding',true,'{"steps":[{"type":"FINALIZATION"}]}',3,$2)`,[id,actor]);
      await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,revision,created_by)
        VALUES($1,'onboarding-progress','synthetic-progress','Synthetic progress',
          '{"configRevision":3,"step":6,"consentSteps":[{"step":1,"configRevision":3}],"completedAt":"2026-10-09T21:50:55Z"}',7,$2)`,
      [id,actor]);
      await pool.query(`INSERT INTO platform_runtime_state(guild_id,activated_at,last_seen_at,bot_connected,runtime_active,module_states)
        VALUES($1,now(),now(),true,true,'{"onboarding":true,"analytics":true}')`,[id]);
      await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,'onboarding.step','onboarding','{"step":5,"completed":true}')`,[id,actor]);
    }
    async function evidence() {
      const result={};
      for(const table of ['platform_guilds','platform_modules','platform_records']) {
        // Hardcoded table names only, never external identifiers.
        result[table]=(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t
          ORDER BY to_jsonb(t)::text`)).rows;
      }
      result.hallowedRuntime=(await pool.query('SELECT * FROM platform_runtime_state WHERE guild_id=$1',
        [TARGET_GUILD_ID])).rows;
      result.oldAudits=(await pool.query(`SELECT * FROM platform_audit WHERE action='onboarding.step' ORDER BY id`)).rows;
      return result;
    }
    const before=await evidence();
    const runtimeBefore=(await pool.query('SELECT * FROM platform_runtime_state WHERE guild_id=$1',[LMOC_TEST_ID])).rows[0];

    // Audit failure must roll back the operational deactivation in the same SQL.
    await assert.rejects(archiveHistoricalRuntime(pool,null));
    assert.deepEqual((await pool.query('SELECT * FROM platform_runtime_state WHERE guild_id=$1',[LMOC_TEST_ID])).rows[0],
      runtimeBefore);

    assert.equal((await archiveHistoricalRuntime(pool,actor)).rowCount,1);
    assert.deepEqual(await evidence(),before);
    const archived=(await pool.query('SELECT * FROM platform_runtime_state WHERE guild_id=$1',[LMOC_TEST_ID])).rows[0];
    assert.equal(archived.runtime_active,false);
    assert.equal(archived.bot_connected,false);
    assert.deepEqual(archived.module_states,{});
    assert.deepEqual(archived.activated_at,runtimeBefore.activated_at);
    assert.deepEqual(archived.last_seen_at,runtimeBefore.last_seen_at);
    const audit=(await pool.query(`SELECT before_state,after_state FROM platform_audit
      WHERE action='guild_archived_reference_only'`)).rows[0];
    assert.equal(audit.before_state.runtime_active,true);
    assert.deepEqual(audit.before_state.module_states,runtimeBefore.module_states);
    assert.equal(audit.after_state.lifecycle,'historical-reference-only');
    assert.equal((await archiveHistoricalRuntime(pool,actor)).rowCount,0);
    assert.deepEqual(await evidence(),before);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM platform_audit
      WHERE action='guild_archived_reference_only'`)).rows[0].n,1);
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
