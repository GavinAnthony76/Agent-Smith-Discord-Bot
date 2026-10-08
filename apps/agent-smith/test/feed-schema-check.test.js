import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertFeedSchema, feedSchemaColumns } from '../src/feed-schema-check.js';

test('feed readiness checks every runtime column with read-only zero-row queries', async () => {
  const queries = [];
  await assertFeedSchema({ async query(sql) { queries.push(sql); } });
  assert.equal(queries.length, 4);
  for (const [index, [table, columns]] of Object.entries(feedSchemaColumns).entries()) {
    assert.equal(queries[index], `SELECT ${columns.split(' ').join(', ')} FROM ${table} LIMIT 0`);
  }
});

for (const code of ['42P01', '42703']) {
  test(`missing table/column (${code}) refuses startup with supported recovery guidance`, async () => {
    const cause = Object.assign(new Error('database failure'), { code });
    await assert.rejects(assertFeedSchema({ async query() { throw cause; } }), error => {
      assert.equal(error.code, 'SMITH_FEED_SCHEMA_MISSING');
      assert.equal(error.cause, cause);
      assert.match(error.message, /review and republish/);
      assert.match(error.message, /Do not overwrite production data/);
      return true;
    });
  });
}

test('connection and permission errors are not treated as missing schema', async () => {
  for (const code of ['42501', 'ECONNREFUSED']) {
    const error = Object.assign(new Error('unavailable'), { code });
    await assert.rejects(assertFeedSchema({ async query() { throw error; } }), e => e === error);
  }
});

test('schema readiness precedes Gateway login and merge setup uses only approved development migrations', async () => {
  const bot = await readFile(new URL('../src/bot.js', import.meta.url), 'utf8');
  assert.ok(bot.indexOf('await assertFeedSchema(pool)') < bot.indexOf('await connect('));
  assert.match(bot, /await pool\.end\(\);\s+throw error/);
  const merge = await readFile(new URL('../../../scripts/post-merge.sh', import.meta.url), 'utf8');
  const commands = merge.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).join('\n');
  assert.match(commands, /run feeds:schema-check/);
  assert.match(commands, /NODE_ENV.*production/);
  assert.deepEqual(commands.split('\n').filter(line => /^pnpm /.test(line)), [
    'pnpm install --frozen-lockfile',
    'pnpm --filter @workspace/agent-smith run feeds:migrate',
    'pnpm --filter @workspace/agent-smith run feeds:schema-check',
    'pnpm --filter @workspace/agent-smith run conversation:budget:migrate',
  ]);
  const artifact = await readFile(new URL('../../../artifacts/api-server/.replit-artifact/artifact.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(artifact, /feeds:migrate|conversation:budget:migrate|db:migrate|push-force|drizzle-kit/);
});
