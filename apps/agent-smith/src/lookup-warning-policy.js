export const LOOKUP_WARNING_KEY = 'conversation-lookup-warnings';
export const LOOKUP_WARNING_WINDOW_MS = 300000;
export const LOOKUP_WARNING_DEFAULTS = Object.freeze({ enabled: false, threshold: 5, cooldownMinutes: 60 });

export function lookupWarningSettings(value = LOOKUP_WARNING_DEFAULTS) {
  if (!value || typeof value.enabled !== 'boolean' ||
      !Number.isInteger(value.threshold) || value.threshold < 5 || value.threshold > 100 ||
      !Number.isInteger(value.cooldownMinutes) || value.cooldownMinutes < 15 || value.cooldownMinutes > 1440) {
    throw new Error('Lookup warnings require enabled true/false, threshold 5–100 and cooldown 15–1440 minutes.');
  }
  return { enabled: value.enabled, threshold: value.threshold, cooldownMinutes: value.cooldownMinutes };
}

export function lookupWarningContent({ timeouts, backoffRefusals }) {
  for (const count of [timeouts, backoffRefusals]) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) throw new Error('Invalid lookup warning count.');
  }
  return `Smith lookup warning (last five minutes): timeouts=${timeouts}; backoff_refusals=${backoffRefusals}.\n` +
    'Repeated slow lookups or REST backoffs stopped conversation replies. Generated answers remain suppressed when authorization cannot be checked. ' +
    'This is not a paid-AI allowance notice. Inspect private /smith status; manage these notices with /smith-control lookup-warnings. No automatic retry or server action was taken.';
}

export function isLookupWarningContent(content) {
  if (typeof content !== 'string') return false;
  const match = /^Smith lookup warning \(last five minutes\): timeouts=(\d{1,7}); backoff_refusals=(\d{1,7})\.\n/.exec(content);
  if (!match) return false;
  try {
    return content === lookupWarningContent({ timeouts: Number(match[1]), backoffRefusals: Number(match[2]) });
  } catch { return false; }
}
