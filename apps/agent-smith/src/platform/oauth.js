import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { PlatformError, snowflake } from './catalog.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
const nonce = () => randomBytes(32).toString('base64url');
export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=')).filter(pair => pair.length === 2));
}
export function createOAuth({ pool, env = process.env, transport = fetch, now = Date.now }) {
  const key = env.SESSION_SECRET ? createHash('sha256').update(env.SESSION_SECRET).digest() : null;
  const configured = Boolean(key && env.DISCORD_CLIENT_SECRET && env.DISCORD_CLIENT_ID);
  const encrypt = data => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  };
  const decrypt = encoded => {
    const data = Buffer.from(encoded, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
  };
  async function api(path, token) {
    const response = await transport(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new PlatformError('discord_identity_unavailable', 503);
    return response.json();
  }
  async function exchange(body) {
    const response = await transport('https://discord.com/api/v10/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new PlatformError('discord_login_failed', 401);
    const data = await response.json();
    if (!data.access_token || !data.refresh_token || !Number.isFinite(data.expires_in)) {
      throw new PlatformError('discord_login_failed', 401);
    }
    return { ...data, expiresAt: now() + data.expires_in * 1000 };
  }
  async function begin(origin) {
    if (!configured) throw new PlatformError('oauth_not_configured', 503);
    const state = nonce(), browser = nonce();
    await pool.query('DELETE FROM platform_oauth_states WHERE expires_at<now()');
    await pool.query(
      'INSERT INTO platform_oauth_states(state_hash,browser_hash,expires_at) VALUES($1,$2,$3)',
      [hash(state), hash(browser), new Date(now() + 600000)]);
    const query = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID, redirect_uri: `${origin}/api/platform/oauth/callback`,
      response_type: 'code', scope: 'identify guilds', state,
    });
    return { url: `https://discord.com/oauth2/authorize?${query}`, browser };
  }
  async function finish({ origin, state, browser, code }) {
    if (!configured || !/^[\w-]{43}$/.test(state ?? '') || !/^[\w-]{43}$/.test(browser ?? '') ||
        typeof code !== 'string' || code.length > 1000) throw new PlatformError('invalid_oauth_state', 401);
    // Consume atomically before exchange; no retries/replay of the same callback.
    const result = await pool.query(
      'DELETE FROM platform_oauth_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING state_hash',
      [hash(state), hash(browser)]);
    if (!result.rows.length) throw new PlatformError('invalid_oauth_state', 401);
    const tokens = await exchange({ grant_type: 'authorization_code', code,
      redirect_uri: `${origin}/api/platform/oauth/callback` });
    const identity = await api('/users/@me', tokens.access_token);
    snowflake(identity.id);
    const session = nonce(), csrfToken = nonce();
    await pool.query('DELETE FROM platform_sessions WHERE expires_at<now()');
    await pool.query(
      `INSERT INTO platform_sessions(session_hash,user_id,identity,token_ciphertext,csrf_token,expires_at)
       VALUES($1,$2,$3,$4,$5,$6)`, [hash(session), identity.id,
        { id: identity.id, username: String(identity.global_name ?? identity.username).slice(0, 100),
          avatar: /^(?:a_)?[a-f0-9]{32}$/.test(identity.avatar ?? '') ? identity.avatar : null },
        encrypt(tokens), csrfToken, new Date(now() + 8 * 3600000)]);
    return session;
  }
  async function session(value) {
    if (!configured || !/^[\w-]{43}$/.test(value ?? '')) return null;
    const result = await pool.query(
      'SELECT user_id,identity,token_ciphertext,csrf_token FROM platform_sessions WHERE session_hash=$1 AND expires_at>now()', [hash(value)]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    let tokens;
    try { tokens = decrypt(row.token_ciphertext); }
    catch { return null; }
    if (tokens.expiresAt < now() + 30000) {
      // Serialize refresh for this session; concurrent old tokens must not race.
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const locked = (await db.query(
          'SELECT token_ciphertext FROM platform_sessions WHERE session_hash=$1 AND expires_at>now() FOR UPDATE', [hash(value)])).rows[0];
        if (!locked) { await db.query('ROLLBACK'); return null; }
        tokens = decrypt(locked.token_ciphertext);
        if (tokens.expiresAt < now() + 30000) {
          tokens = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
          await db.query('UPDATE platform_sessions SET token_ciphertext=$2 WHERE session_hash=$1', [hash(value), encrypt(tokens)]);
        }
        await db.query('COMMIT');
      } catch { await db.query('ROLLBACK'); return null; }
      finally { db.release(); }
    }
    return { userId: row.user_id, identity: row.identity, csrfToken: row.csrf_token,
      api: path => api(path, tokens.access_token) };
  }
  const logout = value => pool.query('DELETE FROM platform_sessions WHERE session_hash=$1', [hash(value ?? '')]);
  return { configured, begin, finish, session, logout };
}
