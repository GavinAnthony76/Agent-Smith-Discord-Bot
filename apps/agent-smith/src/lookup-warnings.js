import { assertOwnerConfiguration, withLookupWarningNotification } from './security-policy.js';
import { createLookupWarningStore } from './lookup-warning-store.js';
import { LOOKUP_WARNING_WINDOW_MS, lookupWarningSettings, lookupWarningContent } from './lookup-warning-policy.js';

/** Fixed-size, content-free rolling buckets. Never receives request context. */
export function createLookupWarnings({ client, guild, cfg, pool, snapshot,
  store = createLookupWarningStore({ pool, guildId: guild.id }), now = Date.now }) {
  const buckets = [];
  let previous = totals(), previousPoll = now(), busy = false, stopped = false, fingerprint = null, generation = 0;
  const health = { enabled: false, attempts: 0, sent: 0, failed: 0, checksFailed: 0 };
  function totals() {
    const state = snapshot();
    return { timeouts: state.timeouts, backoffRefusals: state.backoffRefusals };
  }
  async function authorize(expectedFingerprint, expectedGeneration) {
    if (stopped) throw new Error('Lookup warnings stopped.');
    const fresh = await guild.fetch();
    assertOwnerConfiguration(cfg, fresh.ownerId);
    // Read consent last: disabling while the Owner lookup waits must also
    // suppress the eventual write, including settings changed by another process.
    const settings = await store.settings();
    if (!settings.enabled || settings.approvedOwner !== cfg.ownerDiscordId ||
        JSON.stringify(settings) !== expectedFingerprint || generation !== expectedGeneration)
      throw new Error('Lookup warning consent absent or changed.');
    if (stopped) throw new Error('Lookup warnings stopped.');
  }
  async function poll() {
    if (busy || stopped) return;
    busy = true;
    let reserved = false;
    try {
      const current = totals(), time = now();
      const intervalStart = previousPoll, pollGeneration = generation;
      const delta = {
        timeouts: Math.max(0, current.timeouts - previous.timeouts),
        backoffRefusals: Math.max(0, current.backoffRefusals - previous.backoffRefusals),
      };
      previous = current;
      previousPoll = time;
      const rawSettings = await store.settings();
      const settings = { ...lookupWarningSettings(rawSettings), approvedOwner: rawSettings.approvedOwner };
      const nextFingerprint = JSON.stringify(settings);
      const changed = fingerprint !== nextFingerprint;
      if (changed) { buckets.length = 0; fingerprint = nextFingerprint; }
      health.enabled = settings.enabled && settings.approvedOwner === cfg.ownerDiscordId;
      if (!health.enabled || stopped) { buckets.length = 0; return; }
      if (changed || generation !== pollGeneration || time < intervalStart || time - intervalStart > 120000) {
        buckets.length = 0;
        return;
      }
      // Deltas cover the preceding polling minute. Never include an interval
      // that crosses the window boundary (a paused process must not alert on old failures).
      while (buckets.length && buckets[0].start < time - LOOKUP_WARNING_WINDOW_MS) buckets.shift();
      if (delta.timeouts + delta.backoffRefusals === 0) return;
      const minute = Math.floor(intervalStart / 60000);
      let bucket = buckets.find(value => value.minute === minute);
      if (!bucket) { bucket = { minute, start: intervalStart, timeouts: 0, backoffRefusals: 0 }; buckets.push(bucket); }
      // Even when manually polled more often, at most six minute buckets exist.
      while (buckets.length > 6) buckets.shift();
      for (const label of ['timeouts', 'backoffRefusals']) bucket[label] = Math.min(1000000, bucket[label] + delta[label]);
      const counts = buckets.reduce((sum, value) => ({
        timeouts: Math.min(1000000, sum.timeouts + value.timeouts),
        backoffRefusals: Math.min(1000000, sum.backoffRefusals + value.backoffRefusals),
      }), { timeouts: 0, backoffRefusals: 0 });
      if (counts.timeouts + counts.backoffRefusals < settings.threshold) return;
      const checkConsent = () => authorize(nextFingerprint, pollGeneration);
      await checkConsent();
      if (!await store.reserve(settings.cooldownMinutes)) return;
      reserved = true;
      health.attempts++;
      const content = lookupWarningContent(counts);
      await withLookupWarningNotification(cfg.ownerDiscordId, content, checkConsent, async () => {
        await checkConsent();
        const recipient = await client.users.fetch(cfg.ownerDiscordId);
        if (recipient.bot) throw new Error('Lookup warning requires a human Owner.');
        await checkConsent();
        await recipient.send({ content, allowedMentions: { parse: [] } });
      });
      health.sent++;
    } catch {
      // No error objects, payloads, identities or uncertain-send retries.
      if (reserved) health.failed++;
      else health.checksFailed++;
      health.enabled = false;
      buckets.length = 0;
    } finally { busy = false; }
  }
  const timer = setInterval(() => { void poll(); }, 60000);
  timer.unref?.();
  return {
    poll,
    status() { return { ...health }; },
    async configure(value, actor) {
      const settings = lookupWarningSettings(value);
      const fresh = await guild.fetch();
      assertOwnerConfiguration(cfg, fresh.ownerId);
      if (actor !== fresh.ownerId) throw new Error('Only the actual configured human Owner can change lookup warnings.');
      const saved = await store.configure(settings, actor);
      generation++;
      buckets.length = 0;
      previous = totals();
      previousPoll = now();
      fingerprint = JSON.stringify(saved);
      health.enabled = settings.enabled;
      return settings;
    },
    stop() { stopped = true; clearInterval(timer); buckets.length = 0; },
  };
}
