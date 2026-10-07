import { setTimeout as delay } from 'node:timers/promises';

const MAX_TIMER_MS = 2_147_000_000;
const SESSION_LIMIT_ERROR = /^Not enough sessions remaining to spawn \d+ shards; only \d+ remaining; resets at /;

/**
 * Wait before identifying, rather than crash-looping against Discord's daily
 * session budget. Only this specific quota condition is retryable here.
 * Discord.js still owns Gateway reconnect/resume once the client is online.
 */
export async function loginWhenAllowed({
  getGateway,
  login,
  waitForSession = false,
  sleep = ms => delay(ms),
  now = Date.now,
  log = message => console.log(message),
  resetAfterSessionLimit,
  onStartupState = () => {},
}) {
  for (;;) {
    const gateway = await getGateway();
    const limit = gateway?.session_start_limit;
    const required = gateway?.shards;
    if (!Number.isSafeInteger(required) || required < 1 ||
        !Number.isSafeInteger(limit?.remaining) || limit.remaining < 0 ||
        !Number.isFinite(limit?.reset_after) || limit.reset_after < 0) {
      throw new Error('Discord returned invalid Gateway session-limit metadata; refusing to identify.');
    }

    if (limit.remaining < required) {
      const resetAt = now() + limit.reset_after;
      const message = `Discord Gateway login allowance exhausted. Waiting until ${new Date(resetAt + 5000).toISOString()} before checking again. No Gateway login attempted.`;
      if (!waitForSession) {
        throw new Error(`Discord Gateway login allowance exhausted; retry after ${new Date(resetAt + 5000).toISOString()}.`);
      }
      log(message);
      onStartupState('waiting_for_discord');
      let remainingMs = Math.max(5000, limit.reset_after + 5000);
      while (remainingMs > 0) {
        const chunk = Math.min(remainingMs, MAX_TIMER_MS);
        await sleep(chunk);
        remainingMs -= chunk;
      }
      // Re-read authoritative metadata. Never assume a reset occurred.
      continue;
    }

    try {
      onStartupState('connecting');
      return await login();
    } catch (error) {
      // Another process may consume the allowance between REST and login.
      // Do not retry bad credentials, permissions, networking or other errors.
      if (!waitForSession || !SESSION_LIMIT_ERROR.test(error?.message ?? '') ||
          typeof resetAfterSessionLimit !== 'function') throw error;
      // Client.login destroys its client after failure. The connector must
      // replace it before any retry; do not reuse a destroyed SDK client.
      await resetAfterSessionLimit();
      onStartupState('waiting_for_discord');
      log('Discord Gateway allowance changed before login. Rechecking in five seconds without repeated identification attempts.');
      await sleep(5000);
    }
  }
}
