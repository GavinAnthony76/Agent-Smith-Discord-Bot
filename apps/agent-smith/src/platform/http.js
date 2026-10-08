import { createOAuth, cookies, same } from './oauth.js';
import { createPlatformService } from './service.js';
import { COLLECTIONS } from './fields.js';
import { PlatformError } from './catalog.js';

async function jsonBody(request) {
  if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new PlatformError('json_required', 415);
  }
  if (request.body !== undefined) return request.body;
  let length = 0;
  const chunks = [];
  for await (const part of request) {
    length += part.length;
    if (length > 24000) throw new PlatformError('request_too_large', 413);
    chunks.push(Buffer.from(part));
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Object required.');
    return data;
  }
  catch { throw new PlatformError('invalid_json'); }
}
export function createPlatformHttp({ pool, discord, env = process.env, origin, legacyActions, oauthTransport, ticketActions }) {
  const oauth = createOAuth({ pool, env, ...(oauthTransport ? { transport: oauthTransport } : {}) });
  const service = createPlatformService({ pool, discord, env, legacyActions, ticketActions });
  const secure = origin.startsWith('https://');
  if (env.NODE_ENV === 'production' && !secure) throw new Error('Platform HTTPS public origin is required.');
  const cookie = (name, value, age) => {
    if (!['smith_session', 'smith_oauth'].includes(name) || value !== '' && !/^[\w-]{43}$/.test(value)) {
      throw new PlatformError('invalid_server_cookie', 503);
    }
    return `${name}=${value}; Path=/api/platform; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  };
  const limits = new Map();
  function rateLimit(key) {
    const now = Date.now(), old = limits.get(key);
    const value = old && now - old.since < 60000 ? old : { since: now, count: 0 };
    value.count++;
    limits.set(key, value);
    if (limits.size > 5000) {
      for (const [key, entry] of limits) if (now - entry.since >= 60000) limits.delete(key);
      while (limits.size > 5000) limits.delete(limits.keys().next().value);
    }
    if (value.count > 120) throw new PlatformError('dashboard_rate_limited', 429);
  }
  const installQuery = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID ?? '', scope: 'bot applications.commands',
    // No Administrator, role/channel bulk management or message deletion grant.
    permissions: '274878221376',
  });
  const installUrl = `https://discord.com/oauth2/authorize?${installQuery}`;
  let callbackCheck, callbackSnapshot = { checkedAt: 0, registered: null };
  async function callbackRegistered() {
    if (Date.now() - callbackSnapshot.checkedAt < 10000) return callbackSnapshot.registered;
    callbackCheck ??= (async () => {
      let registered = null;
      try {
        const application = await discord.client.rest.get('/applications/@me');
        if (Array.isArray(application.redirect_uris)) {
          registered = application.redirect_uris.includes(`${origin}/api/platform/oauth/callback`);
        }
      } catch { /* Unknown does not become a claim of working OAuth. */ }
      callbackSnapshot = { checkedAt: Date.now(), registered };
      return registered;
    })().finally(() => { callbackCheck = null; });
    return callbackCheck;
  }
  function send(response, status, data) {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(data));
  }
  async function handler(request, response) {
    const url = new URL(request.originalUrl ?? request.url, origin);
    if (!url.pathname.startsWith('/api/platform/')) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const cookieValues = cookies(request.headers.cookie);
    try {
      // Cookies are attacker-controlled until session lookup succeeds. A forged
      // cookie must not provide an unlimited supply of independent rate buckets.
      rateLimit(`ip:${request.socket.remoteAddress ?? 'anonymous'}`);
      if (url.pathname === '/api/platform/oauth/login' && request.method === 'GET') {
        if (await callbackRegistered() === false) throw new PlatformError('register_discord_oauth_callback', 503);
        const result = await oauth.begin(origin);
        response.setHeader('Set-Cookie', cookie('smith_oauth', result.browser, 600));
        response.statusCode = 302; response.setHeader('Location', result.url); response.end();
        return true;
      }
      if (url.pathname === '/api/platform/oauth/callback' && request.method === 'GET') {
        const value = await oauth.finish({ origin, state: url.searchParams.get('state'),
          browser: cookieValues.smith_oauth, code: url.searchParams.get('code') });
        response.setHeader('Set-Cookie', [cookie('smith_session', value, 28800), cookie('smith_oauth', '', 0)]);
        response.statusCode = 302; response.setHeader('Location', '/dashboard'); response.end();
        return true;
      }
      const session = await oauth.session(cookieValues.smith_session);
      if (session) rateLimit(`user:${session.userId}`);
      if (url.pathname === '/api/platform/session' && request.method === 'GET') {
        send(response, 200, {
          authenticated: !!session, loginUrl: '/api/platform/oauth/login', installUrl,
          oauthConfigured: oauth.configured, botOnline: discord.client.isReady(),
          oauthCallbackRegistered: await callbackRegistered(),
          runtimeMode: env.NODE_ENV === 'production' ? 'production' : 'preview',
          ...(session ? { user: session.identity, csrfToken: session.csrfToken } : {}),
        }); return true;
      }
      if (!session) throw new PlatformError('discord_login_required', 401);
      const write = !['GET', 'HEAD'].includes(request.method);
      if (write && (!same(request.headers['x-csrf-token'], session.csrfToken) ||
          request.headers.origin !== origin)) throw new PlatformError('csrf_validation_failed', 403);
      if (url.pathname === '/api/platform/logout' && request.method === 'POST') {
        await oauth.logout(cookieValues.smith_session);
        response.setHeader('Set-Cookie', cookie('smith_session', '', 0));
        send(response, 200, { ok: true, message: 'Logged out.' }); return true;
      }
      if (url.pathname === '/api/platform/guilds' && request.method === 'GET') {
        send(response, 200, await service.listGuilds(session)); return true;
      }
      const match = /^\/api\/platform\/guilds\/(\d{17,20})\/([\w-]+)(?:\/([\w-]+))?(?:\/([\w-]+))?$/.exec(url.pathname);
      if (!match) throw new PlatformError('route_not_found', 404);
      const [, guildId, area, key, recordId] = match;
      let capability = area;
      if (['overview', 'resources', 'modules'].includes(area)) capability = key ?? 'overview';
      else if (area === 'setup') capability = 'settings';
      else if (area === 'collections') capability = COLLECTIONS[key]?.module;
      else if (area === 'actions') {
        const input = await jsonBody(request);
        if (typeof input.action !== 'string') throw new PlatformError('invalid_action');
        capability = input.action?.startsWith('ticket-') ? 'tickets' : 'moderation';
        request.platformInput = input;
      }
      if (!capability) throw new PlatformError('route_not_found', 404);
      const authority = await service.authorize(session.userId, guildId, capability, write);
      let data;
      if (area === 'overview' && request.method === 'GET') data = await service.overview(authority);
      else if (area === 'resources' && request.method === 'GET') data = await service.resources(authority);
      else if (area === 'modules' && !key && request.method === 'GET') data = await service.modules(authority);
      else if (area === 'modules' && key && request.method === 'PUT') data = await service.updateModule(authority, key, await jsonBody(request));
      else if (area === 'collections' && request.method === 'GET' && !recordId) data = await service.collection(authority, key);
      else if (area === 'collections' && request.method === 'POST' && !recordId) data = await service.saveRecord(authority, key, await jsonBody(request));
      else if (area === 'collections' && request.method === 'PUT' && recordId) data = await service.saveRecord(authority, key, await jsonBody(request), recordId);
      else if (area === 'collections' && request.method === 'DELETE' && recordId) data = await service.deleteRecord(authority, key, recordId);
      else if (area === 'setup' && request.method === 'PUT') data = await service.setup(authority, await jsonBody(request));
      else if (area === 'actions' && request.method === 'POST') data = await service.action(authority, request.platformInput);
      else throw new PlatformError('method_not_allowed', 405);
      send(response, 200, data);
    } catch (error) {
      const status = error instanceof PlatformError ? error.status : 503;
      if (!(error instanceof PlatformError)) console.error('Platform request unavailable; sensitive request details omitted.');
      send(response, status, { error: error instanceof PlatformError ? error.code : 'platform_temporarily_unavailable' });
    }
    return true;
  }
  return { handler, service, oauth };
}
