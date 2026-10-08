import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuth, hash, same, cookies } from '../src/platform/oauth.js';
import { validatePublicFeedSource } from '../src/platform/source-policy.js';
import { validateConfiguration } from '../src/platform/configuration.js';
import { eligibleText, calculateLevel } from '../src/platform/activity.js';
import { meterProvider } from '../src/platform/ai-usage.js';
import { installSecurityGateForRestOnly } from '../src/platform/transport.js';
import { inspectSecuritySource } from '../src/security-source-audit.js';

const env = { SESSION_SECRET: 'synthetic-test-key-not-a-credential',
  DISCORD_CLIENT_ID: '88888888888888888', DISCORD_CLIENT_SECRET: 'synthetic-client' };
function fixture() {
  const states = new Map(), sessions = new Map();
  const pool = { async query(sql, values = []) {
    if (sql.startsWith('INSERT INTO platform_oauth_states')) {
      states.set(values[0], { browser: values[1], expires: values[2] }); return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM platform_oauth_states WHERE state_hash')) {
      const state = states.get(values[0]);
      if (!state || state.browser !== values[1] || state.expires < new Date()) return { rows: [] };
      states.delete(values[0]); return { rows: [{ state_hash: values[0] }] };
    }
    if (sql.startsWith('INSERT INTO platform_sessions')) {
      sessions.set(values[0], { user_id: values[1], identity: values[2], token_ciphertext: values[3],
        csrf_token: values[4], expires: values[5] }); return { rows: [] };
    }
    if (sql.startsWith('SELECT user_id')) return { rows: sessions.has(values[0]) ? [sessions.get(values[0])] : [] };
    if (sql.startsWith('DELETE FROM platform_sessions WHERE session_hash')) { sessions.delete(values[0]); return { rows: [] }; }
    if (sql.startsWith('DELETE FROM ')) return { rows: [] };
    throw new Error('Unexpected fixture query.');
  } };
  let exchanges = 0;
  const transport = async (url, options) => {
    if (url.endsWith('/oauth2/token')) {
      exchanges++;
      assert.equal(new URLSearchParams(options.body).get('redirect_uri'), 'https://example.test/api/platform/oauth/callback');
      return { ok: true, json: async () => ({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 }) };
    }
    return { ok: true, json: async () => ({ id: '88888888888888888', username: 'Synthetic member', avatar: null }) };
  };
  return { oauth: createOAuth({ pool, env, transport }), states, sessions, exchanges: () => exchanges };
}
test('OAuth uses only identify/guilds, hashes state and binds browser', async () => {
  const { oauth, states } = fixture();
  const start = await oauth.begin('https://example.test');
  const url = new URL(start.url);
  assert.equal(url.searchParams.get('scope'), 'identify guilds');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/api/platform/oauth/callback');
  assert.equal(states.has(url.searchParams.get('state')), false);
  assert.equal(states.get(hash(url.searchParams.get('state'))).browser, hash(start.browser));
  await assert.rejects(oauth.finish({ origin: 'https://example.test', state: url.searchParams.get('state'),
    browser: 'z'.repeat(43), code: 'synthetic-code' }), /invalid_oauth_state/);
});
test('OAuth callback is single-use and stored tokens are authenticated-encrypted', async () => {
  const { oauth, sessions, exchanges } = fixture();
  const start = await oauth.begin('https://example.test');
  const args = { origin: 'https://example.test', state: new URL(start.url).searchParams.get('state'),
    browser: start.browser, code: 'synthetic-code' };
  const results = await Promise.allSettled([oauth.finish(args), oauth.finish(args)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(exchanges(), 1);
  const token = results.find(result => result.status === 'fulfilled').value;
  const row = sessions.get(hash(token));
  assert.ok(row.token_ciphertext);
  assert.ok(!row.token_ciphertext.includes('synthetic-access'));
  assert.ok(!row.token_ciphertext.includes('synthetic-refresh'));
  const session = await oauth.session(token);
  assert.equal(session.userId, '88888888888888888');
  assert.ok(session.csrfToken);
  await oauth.logout(token);
  assert.equal(await oauth.session(token), null);
});
test('session ciphertext tampering fails closed without exposing the token', async () => {
  const { oauth, sessions } = fixture();
  const start = await oauth.begin('https://example.test');
  const token = await oauth.finish({ origin: 'https://example.test',
    state: new URL(start.url).searchParams.get('state'), browser: start.browser, code: 'synthetic-code' });
  const row = sessions.get(hash(token));
  row.token_ciphertext = 'a'.repeat(80);
  assert.equal(await oauth.session(token), null);
});
test('missing configuration stays explicit and cookie equality is length-safe', async () => {
  const oauth = createOAuth({ pool: {}, env: {} });
  assert.equal(oauth.configured, false);
  await assert.rejects(oauth.begin('https://example.test'), /oauth_not_configured/);
  assert.equal(await oauth.session('a'.repeat(43)), null);
  assert.equal(same('a', 'aa'), false);
  assert.equal(same('abc', 'abc'), true);
  assert.deepEqual(cookies('smith_session=abc; other=def'), { smith_session: 'abc', other: 'def' });
});
test('safe maxTokens configuration is allowed but credential/system keys are not', () => {
  assert.deepEqual(validateConfiguration({ maxTokens: 2048 }), { maxTokens: 2048 });
  for (const key of ['token', 'access_token', 'refreshToken', 'bot_token', 'apiKey', 'systemPrompt']) {
    assert.throws(() => validateConfiguration({ nested: { [key]: 'synthetic' } }), /protected_configuration/);
  }
});
test('feed drafts reject non-HTTPS, credentials and internal/IP destinations', () => {
  for (const url of ['http://example.com/rss', 'https://localhost/rss', 'https://127.0.0.1/rss',
    'https://[::1]/rss', 'https://internal.local/rss', 'https://user:pass@example.com/rss']) {
    assert.throws(() => validatePublicFeedSource(url));
  }
  assert.equal(validatePublicFeedSource('https://example.com/rss'), 'https://example.com/rss');
});
test('text XP requires recent qualifying human activity and excludes commands/links', () => {
  const config = { textEnabled: true, excludedChannels: ['88888888888888880'], eligibleChannels: [] };
  const message = { guildId: '88888888888888888', channelId: '88888888888888881',
    author: { bot: false }, createdTimestamp: Date.now(), content: 'A real conversational message' };
  assert.equal(eligibleText(message, config), true);
  for (const override of [{ author: { bot: true } }, { content: 'https://example.com' },
    { content: '/smith a very long command' }, { createdTimestamp: Date.now() - 600000 },
    { channelId: '88888888888888880' }]) assert.equal(eligibleText({ ...message, ...override }, config), false);
  assert.equal(calculateLevel(1500, [0, 1000, 3500]), 2);
});
test('monthly model allowance blocks before the provider and preserves callback signature', async () => {
  let calls = 0, actualUsage;
  const provider = { configured: true, async complete(_messages, _signal, { onUsage }) {
    calls++; onUsage({ prompt_tokens: 10, completion_tokens: 5 }); return 'Synthetic answer';
  } };
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT plan')) return { rows: [{ plan: 'FREE', limit_overrides: {} }] };
    if (sql.startsWith('INSERT INTO platform_ai_periods')) return { rows: calls ? [] : [{ period: '2026-10-01' }] };
    return { rows: [] };
  } };
  const metered = meterProvider({ provider, pool, guildId: '88888888888888888' });
  assert.equal(await metered.complete([], undefined, { onUsage: value => { actualUsage = value; } }), 'Synthetic answer');
  assert.equal(actualUsage.prompt_tokens, 10);
  await assert.rejects(metered.complete([], undefined), error => error.code === 'monthly_ai_budget_exhausted');
  assert.equal(calls, 1);
});
test('REST-only preview allows reads but refuses every Discord write', async () => {
  const forwarded = [];
  const client = { rest: { async request(request) { forwarded.push(request.method); return 'read'; } } };
  installSecurityGateForRestOnly(client);
  assert.equal(await client.rest.request({ method: 'GET' }), 'read');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await assert.rejects(client.rest.request({ method }), /refuses Discord mutations/);
  }
  assert.deepEqual(forwarded, ['GET']);
});
test('source audit distinguishes Node deadlines from unsafe Discord member timeouts', () => {
  assert.deepEqual(inspectSecuritySource('platform/oauth.js', 'AbortSignal.timeout(10000)'), []);
  assert.ok(inspectSecuritySource('platform/unsafe.js', 'member.timeout(60000)').length);
});
