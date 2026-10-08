/**
 * Explicit development-only integration runner, not part of the offline suite.
 * Creates and drops only a unique isolated schema. No Gateway or real OAuth call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';
import { createPlatformHttp } from '../src/platform/http.js';
import { createGuildConfigurationService } from '../src/platform/configuration.js';
import { authorizeTenant } from '../src/platform/catalog.js';

if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1' || !process.env.DATABASE_URL) {
  throw new Error('Development database required; production/default fallback is prohibited.');
}
const schema = `platform_test_${randomBytes(8).toString('hex')}`;
if (!/^platform_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe test schema.');
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool, server;
const guildA = '80000000000000001', guildB = '80000000000000002';
const userA = '90000000000000001', userB = '90000000000000002';
const guilds = new Map([[guildA, userA], [guildB, userB]]);
let viewer = false;
const discord = {
  client: { isReady: () => false },
  async authority({ guildId, userId }) {
    if (guilds.get(guildId) !== userId) return null;
    return { installed: true, member: true, role: viewer ? 'VIEW_ONLY' : 'OWNER',
      actor: { id: userId }, guild: { id: guildId, ownerId: userId, name: 'Isolated test guild', iconURL: () => null,
        roles: { cache: new Map() }, channels: { cache: new Map() }, members: { me: {} } } };
  },
};
const configuration = {
  allowedChannels: [], mentionOnly: true, maxTokens: 2048, ttlMinutes: 20,
  cooldownSeconds: 5, model: 'gpt-5.4-mini', personalityAdditions: '',
};

await test('platform HTTP and PostgreSQL isolation', async t => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
      application_name: schema, options: `-c search_path=${schema}`, max: 4 });
    assert.equal((await pool.query('SHOW search_path')).rows[0].search_path, schema);
    await pool.query(await readFile(new URL('../src/platform/schema.sql', import.meta.url), 'utf8'));
    let handler;
    server = createServer((req, res) => { void handler(req, res); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const web = createPlatformHttp({ pool, discord, origin,
      env: { NODE_ENV: 'development', SESSION_SECRET: 'synthetic-integration-key',
        DISCORD_CLIENT_ID: '70000000000000001', DISCORD_CLIENT_SECRET: 'synthetic-integration-client' },
      oauthTransport: async url => ({ ok: true, json: async () => url.endsWith('/oauth2/token') ?
        { access_token: 'synthetic-integration-access', refresh_token: 'synthetic-integration-refresh', expires_in: 3600 } :
        { id: userA, username: 'Synthetic owner', avatar: null } }),
    });
    handler = web.handler;
    const begin = await web.oauth.begin(origin);
    const sessionToken = await web.oauth.finish({ origin, browser: begin.browser,
      state: new URL(begin.url).searchParams.get('state'), code: 'synthetic-code' });
    const session = await web.oauth.session(sessionToken);
    const headers = { Cookie: `smith_session=${sessionToken}`,
      Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
    const endpoint = `/api/platform/guilds/${guildA}/modules/ai`;
    await t.test('unauthenticated and foreign guild access refuse uniformly', async () => {
      assert.equal((await fetch(`${origin}/api/platform/guilds/${guildA}/modules`)).status, 401);
      const response = await fetch(`${origin}/api/platform/guilds/${guildB}/modules`, { headers });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'guild_access_denied' });
      assert.equal(Number((await pool.query('SELECT count(*) FROM platform_guilds')).rows[0].count), 0);
    });
    await t.test('fresh authorized writes persist with atomic audit and optimistic revision', async () => {
      const result = await fetch(origin + endpoint, { method: 'PUT', headers,
        body: JSON.stringify({ enabled: true, configuration, revision: 0 }) });
      assert.equal(result.status, 200);
      assert.equal((await result.json()).revision, 1);
      const reload = await fetch(`${origin}/api/platform/guilds/${guildA}/modules`, { headers });
      assert.equal((await reload.json()).find(module => module.moduleKey === 'ai').configuration.maxTokens, 2048);
      const stale = await fetch(origin + endpoint, { method: 'PUT', headers,
        body: JSON.stringify({ enabled: false, configuration, revision: 0 }) });
      assert.equal(stale.status, 409);
      assert.equal(Number((await pool.query('SELECT count(*) FROM platform_audit WHERE guild_id=$1', [guildA])).rows[0].count), 1);
      assert.equal(Number((await pool.query('SELECT count(*) FROM platform_modules WHERE guild_id=$1', [guildB])).rows[0].count), 0);
    });
    await t.test('CSRF and fresh role revocation prevent writes', async () => {
      const input = JSON.stringify({ enabled: false, configuration, revision: 1 });
      const evil = await fetch(origin + endpoint, { method: 'PUT', headers: { ...headers, Origin: 'https://evil.invalid' }, body: input });
      assert.equal(evil.status, 403);
      const noToken = await fetch(origin + endpoint, { method: 'PUT', headers: { ...headers, 'X-CSRF-Token': '' }, body: input });
      assert.equal(noToken.status, 403);
      viewer = true;
      const revoked = await fetch(origin + endpoint, { method: 'PUT', headers, body: input });
      assert.equal(revoked.status, 403);
      viewer = false;
      assert.equal((await pool.query('SELECT enabled FROM platform_modules WHERE guild_id=$1', [guildA])).rows[0].enabled, true);
    });
    await t.test('real overlapping transactions produce one winner, not two first writes', async () => {
      const permit = await authorizeTenant({ userId: userA, guildId: guildA, capability: 'welcome', write: true,
        resolve: async () => ({ installed: true, member: true, role: 'OWNER' }) });
      let entered, release;
      const hold = new Promise(resolve => { release = resolve; });
      const inside = new Promise(resolve => { entered = resolve; });
      let first = true;
      const service = createGuildConfigurationService(pool, { onSave: async () => {
        if (first) { first = false; entered(); await hold; }
      } });
      const a = service.updateGuildModuleConfig(permit, 'welcome', { enabled: false, configuration: {}, revision: 0 });
      await inside;
      const b = service.updateGuildModuleConfig(permit, 'welcome', { enabled: true, configuration: {}, revision: 0 });
      // Attach failure observation immediately; rejection is expected after release.
      const second = b.then(value => ({ value }), error => ({ error }));
      try {
        const deadline = Date.now() + 4000;
        let blocked = false;
        while (Date.now() < deadline) {
          const row = (await admin.query(
            `SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'`, [schema])).rows[0];
          if (Number(row.count) > 0) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(blocked, 'The second real transaction must be observed waiting on the first.');
      } finally { release(); }
      await a;
      assert.equal((await second).error?.code, 'configuration_changed_reload');
      assert.equal(Number((await pool.query(
        `SELECT count(*) FROM platform_audit WHERE guild_id=$1 AND module='welcome'`, [guildA])).rows[0].count), 1);
    });
    await t.test('OAuth ciphertext and schema remain isolated, logout invalidates the session', async () => {
      const row = (await pool.query('SELECT token_ciphertext FROM platform_sessions')).rows[0];
      assert.ok(row.token_ciphertext && !row.token_ciphertext.includes('synthetic-integration-access'));
      await pool.query(`UPDATE platform_sessions SET expires_at=now()-interval '1 second'`);
      assert.equal((await (await fetch(`${origin}/api/platform/session`, { headers })).json()).authenticated, false);
      await pool.query(`UPDATE platform_sessions SET expires_at=now()+interval '1 hour'`);
      const logout = await fetch(`${origin}/api/platform/logout`, { method: 'POST', headers });
      assert.equal(logout.status, 200);
      assert.equal((await fetch(`${origin}/api/platform/guilds/${guildA}/modules`, { headers })).status, 401);
    });
  } finally {
    viewer = false;
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await pool?.end();
    // Identifier checked above; only this runner's unique schema is removed.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
