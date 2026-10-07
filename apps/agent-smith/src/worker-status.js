import { createServer } from 'node:http';

const PHASES = new Set(['starting', 'waiting_for_discord', 'connecting', 'ready', 'stopping']);
const LIVE_PATHS = new Set(['/', '/api', '/healthz', '/api/healthz']);
const READY_PATHS = new Set(['/readyz', '/api/readyz']);

/** Public process status only. Never include identifiers, settings or errors. */
export function createWorkerStatus({ isDiscordReady = () => false } = {}) {
  let phase = 'starting';
  let closing;
  const snapshot = () => {
    const ready = phase === 'ready' && isDiscordReady() === true;
    const status = phase === 'ready' ? (ready ? 'connected' : 'disconnected') : phase;
    return { status, ready };
  };
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (code, body) => {
      response.statusCode = code;
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(405, { error: 'method_not_allowed' });
      return;
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { send(400, { error: 'invalid_request' }); return; }
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
    if (!LIVE_PATHS.has(pathname) && !READY_PATHS.has(pathname)) {
      send(404, { error: 'not_found' });
      return;
    }
    const state = snapshot();
    // Process liveness must not kill a worker waiting for Discord's reset.
    // Discord readiness is a separate, truthful 200/503 endpoint.
    const code = READY_PATHS.has(pathname) ? (state.ready ? 200 : 503) :
      (phase === 'stopping' ? 503 : 200);
    send(code, state);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 32;
  return {
    snapshot,
    setPhase(value) {
      if (!PHASES.has(value)) throw new Error('Invalid worker status phase.');
      phase = value;
    },
    async listen({ port, host = '0.0.0.0' }) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid worker status port.');
      await new Promise((resolve, reject) => {
        const fail = error => { server.off('listening', listening); reject(error); };
        const listening = () => { server.off('error', fail); resolve(); };
        server.once('error', fail);
        server.once('listening', listening);
        server.listen(port, host);
      });
      return server.address();
    },
    close() {
      phase = 'stopping';
      if (!closing) {
        closing = new Promise((resolve, reject) => {
          if (!server.listening) { resolve(); return; }
          server.close(error => error ? reject(error) : resolve());
          server.closeIdleConnections();
        });
      }
      return closing;
    },
  };
}
