import { randomUUID } from 'node:crypto';

export const budgetUnavailable = 'Paid AI answers are temporarily paused because I cannot safely check the daily allowance. Local greetings, server help and all server functions still work.';
export const budgetExhausted = 'Smith’s remaining daily paid-AI allowance cannot cover this question. Try a shorter question or wait for the next local-midnight reset. Local greetings, server help and all server functions still work.';

export function validateBudget({ requests, tokens, timezone }) {
  if (!Number.isInteger(requests) || requests < 0 || requests > 1000000 ||
      !Number.isInteger(tokens) || tokens < 0 || tokens > 1000000000)
    throw new Error('Requests must be 0–1,000,000 and tokens 0–1,000,000,000, using whole numbers.');
  // Abbreviations such as CST are ambiguous; require an explicit IANA zone.
  if (typeof timezone !== 'string' || timezone !== 'UTC' && !timezone.includes('/'))
    throw new Error('Use an IANA reset timezone such as America/Chicago, or UTC.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
  catch { throw new Error('Invalid reset timezone.'); }
  return { requests, tokens, timezone };
}

// Text-only OpenAI byte-level tokenizers cannot emit more text tokens than
// UTF-8 bytes. Reserve additional framing margin per message, plus the full
// completion ceiling (including reasoning), not a characters/4 average.
export function tokenReservation(messages, maxTokens) {
  if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new Error('Invalid completion ceiling.');
  return messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8') + 64, 64) + maxTokens;
}

export function measuredUsage(usage) {
  const { prompt_tokens: input, completion_tokens: output, total_tokens: total } = usage ?? {};
  return [input, output, total].every(n => Number.isSafeInteger(n) && n >= 0) && input + output === total
    ? total : null;
}

// The store serializes the entire read/check/reserve transaction per guild,
// including settings edits. No prompt, response or member profile is stored.
export function createConversationBudget({ store, defaults }) {
  validateBudget(defaults);
  async function view(tx) {
    const settings = await tx.settings(defaults);
    const period = await tx.period(settings.timezone);
    const usage = await tx.usage(period.id);
    return { settings, period, ...usage };
  }
  return {
    async reserve(messages, maxTokens) {
      const tokens = tokenReservation(messages, maxTokens);
      return store.transaction(async tx => {
        const state = await view(tx);
        if (state.period.blocked || state.requests + 1 > state.settings.requests || state.chargedTokens + tokens > state.settings.tokens)
          return { allowed: false };
        const id = randomUUID();
        await tx.reserve({ id, periodId: state.period.id, tokens });
        return { allowed: true, id, tokens };
      });
    },
    async settle(reservation, usage) {
      const measured = measuredUsage(usage);
      // Missing usage, timeout, crashes and ambiguous provider delivery retain
      // the full reservation. Never refund an uncertain request as "free".
      if (measured === null) return;
      await store.transaction(tx => tx.settle(reservation.id, measured));
    },
    status() { return store.transaction(view); },
    async configure(values, actor) {
      const settings = validateBudget(values);
      return store.transaction(async tx => {
        // Create/read the old window first: timezone edits cannot reset usage.
        const previous = await view(tx);
        await tx.configure(settings, actor, previous.settings);
        return { ...previous, settings };
      });
    },
  };
}

export function budgetStatusText(state) {
  const { settings, period } = state;
  return `Daily paid AI: ${state.requests}/${settings.requests} requests; ${state.chargedTokens}/${settings.tokens} charged tokens.\n` +
    `Measured provider tokens: ${state.measuredTokens}; conservative estimates/reservations: ${state.estimatedTokens} (${state.unmeasuredRequests} requests).\n` +
    `Next reset: ${new Date(period.endsAt).toISOString()} (${period.timezone}). Configured reset timezone: ${settings.timezone}; timezone changes apply after the current window.\n` +
    (period.blocked ? 'Paid AI is paused for this window because measured usage exceeded its reservation.\n' : '') +
    'Tokens include input and output/reasoning. This is a request/token allowance, not a dollar budget.';
}
