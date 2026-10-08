import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetFixture } from './helpers/conversation-budget-fixture.js';
import { createConversationService } from '../src/ai-conversation.js';
import { conversationSettings } from '../src/conversation-settings.js';
import { budgetUnavailable, budgetExhausted, tokenReservation, measuredUsage, validateBudget, budgetStatusText } from '../src/conversation-budget.js';
import { createAIProvider } from '../src/ai-provider.js';
import { createConversationHandlers } from '../src/conversation-handler.js';

const messages = [{ role: 'user', content: 'hello' }];
const settings = conversationSettings({ AI_ENABLED: 'true' });
const context = { accessSignature: 'a', server: {}, member: { progression: [] }, channels: [] };
const ask = (userId = 'a', text = 'Explain latency') => ({ userId, channelId: 'c', text, context });
const usage = total => ({ prompt_tokens: total - 10, completion_tokens: 10, total_tokens: total });
const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };

test('selected defaults and validated explicit settings never infer prices or accept ambiguous CST', () => {
  assert.deepEqual(settings.dailyBudget, { requests: 100, tokens: 10000, timezone: 'America/Chicago' });
  for (const patch of [{ requests: -1 }, { tokens: 1.5 }, { timezone: 'CST' }, { timezone: 'No/SuchZone' }])
    assert.throws(() => validateBudget({ ...settings.dailyBudget, ...patch }));
  assert.equal(validateBudget({ requests: 0, tokens: 0, timezone: 'UTC' }).tokens, 0);
  assert.equal(tokenReservation([{ content: 'é🙂' }], 128), 64 + 64 + 6 + 128);
  for (const value of [null, { total_tokens: 10 }, { prompt_tokens: 5, completion_tokens: 4, total_tokens: 10 }])
    assert.equal(measuredUsage(value), null);
});

test('request limit, exact token boundary, measured vs estimates, and idempotent settlement', async () => {
  const fixture = budgetFixture({ requests: 2, tokens: 10000, timezone: 'UTC' });
  const first = await fixture.budget.reserve(messages, 128);
  await fixture.budget.settle(first, usage(20));
  await fixture.budget.settle(first, usage(100));
  const second = await fixture.budget.reserve(messages, 128);
  await fixture.budget.settle(second, null);
  assert.equal((await fixture.budget.reserve(messages, 128)).allowed, false);
  const state = await fixture.budget.status();
  assert.equal(state.requests, 2);
  assert.equal(state.measuredTokens, 20);
  assert.equal(state.estimatedTokens, second.tokens);
  assert.match(budgetStatusText(state), /Measured provider tokens: 20.*estimates\/reservations/);
  const exact = budgetFixture({ requests: 100, tokens: tokenReservation(messages, 128), timezone: 'UTC' });
  assert.equal((await exact.budget.reserve(messages, 128)).allowed, true);
  assert.equal((await exact.budget.reserve(messages, 128)).allowed, false);
});

test('overlapping callers and separate services cannot reserve beyond shared allowance', async () => {
  const fixture = budgetFixture({ requests: 1, tokens: 10000, timezone: 'UTC' });
  let entered = false, release;
  fixture.holdReserve(() => { entered = true; return new Promise(resolve => { release = resolve; }); });
  const first = fixture.budget.reserve(messages, 128);
  await until(() => entered);
  let secondFinished = false;
  const second = fixture.budget.reserve(messages, 128).then(value => { secondFinished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(secondFinished, false, 'second request must overlap the open reservation transaction');
  release();
  assert.equal((await first).allowed, true);
  assert.equal((await second).allowed, false);
  assert.equal((await fixture.budget.status()).requests, 1);
  const tokens = tokenReservation(messages, 128);
  const tokenLimited = budgetFixture({ requests: 100, tokens: tokens * 2, timezone: 'UTC' });
  const burst = await Promise.all(Array.from({ length: 10 }, () => tokenLimited.budget.reserve(messages, 128)));
  assert.equal(burst.filter(r => r.allowed).length, 2);
  assert.equal((await tokenLimited.budget.status()).chargedTokens, tokens * 2);
});

test('Central day reset handles daylight saving, late settlement and restart using the same ledger', async () => {
  const fixture = budgetFixture({ requests: 1, tokens: 10000, timezone: 'America/Chicago' });
  fixture.setTime('2026-11-01T05:00:00Z'); // Midnight CDT before the 25-hour day.
  const old = await fixture.budget.reserve(messages, 128);
  assert.equal(new Date((await fixture.budget.status()).period.endsAt).toISOString(), '2026-11-02T06:00:00.000Z');
  fixture.setTime('2026-11-02T05:59:59Z');
  assert.equal((await fixture.budget.reserve(messages, 128)).allowed, false);
  fixture.setTime('2026-11-02T06:00:00Z');
  assert.equal((await fixture.budget.reserve(messages, 128)).allowed, true);
  await fixture.budget.settle(old, usage(25));
  assert.equal((await fixture.budget.status()).measuredTokens, 0, 'late settlement must not debit/refund the new day');
  fixture.setTime('2027-03-14T06:00:00Z'); // Midnight CST before the 23-hour day.
  assert.equal(new Date((await fixture.budget.status()).period.endsAt).toISOString(), '2027-03-15T05:00:00.000Z');
});

test('settings changes preserve existing usage/window and zero pauses only paid AI', async () => {
  const fixture = budgetFixture();
  await fixture.budget.reserve(messages, 128);
  const before = await fixture.budget.status();
  await fixture.budget.configure({ requests: 0, tokens: 0, timezone: 'UTC' }, 'owner');
  const after = await fixture.budget.status();
  assert.equal(after.requests, 1);
  assert.equal(after.period.endsAt, before.period.endsAt);
  assert.equal(after.period.timezone, 'America/Chicago');
  assert.equal((await fixture.budget.reserve(messages, 128)).allowed, false);
  assert.equal(fixture.state().audit.length, 1);
});

test('outages fail closed before transport; paid failure/missing usage/settlement outage retain charges', async () => {
  const fixture = budgetFixture({ requests: 100, tokens: 1000000, timezone: 'UTC' });
  let calls = 0, throwing = false, measured = false;
  const service = createConversationService({ settings, budget: fixture.budget, log: () => {},
    provider: { configured: true, async complete(_messages, _signal, options) {
      calls++;
      if (measured) options.onUsage(usage(100));
      if (throwing) throw new Error('outage');
      return 'An answer.';
    } } });
  try {
    fixture.faults.read = true;
    assert.equal(await service.answer(ask()), budgetUnavailable);
    assert.equal(calls, 0);
    assert.match(await service.answer(ask('a', 'hello')), /Hello|operational|nominal/);
    assert.match(await service.answer(ask('a', 'what can you do?')), /Hallowed Core/);
    fixture.faults.read = false;
    fixture.faults.commit = true;
    assert.equal(await service.answer(ask()), budgetUnavailable);
    assert.equal(calls, 0);
    fixture.faults.commit = false;
    throwing = true;
    await service.answer(ask());
    const failed = await fixture.budget.status();
    assert.equal(failed.requests, 1);
    assert.ok(failed.estimatedTokens > 0);
    throwing = false;
    await service.answer(ask());
    measured = true;
    fixture.faults.settle = true;
    await service.answer(ask());
    const retained = await fixture.budget.status();
    assert.equal(retained.requests, 3);
    assert.equal(retained.unmeasuredRequests, 3);
    assert.equal(retained.measuredTokens, 0);
    fixture.faults.settle = false;
    await service.answer(ask());
    assert.equal((await fixture.budget.status()).measuredTokens, 100);
  } finally { service.stop(); }
});

test('concurrent service calls reserve capacity before any transport; exhausted and no-ledger services stay local', async () => {
  const fixture = budgetFixture({ requests: 1, tokens: 10000, timezone: 'UTC' });
  let release, calls = 0;
  const provider = { configured: true, complete: () => { calls++; return new Promise(resolve => { release = resolve; }); } };
  const service = createConversationService({ settings, provider, budget: fixture.budget, log: () => {} });
  try {
    const first = service.answer(ask('one'));
    await until(() => release);
    assert.equal(await service.answer(ask('two')), budgetExhausted);
    assert.equal(calls, 1);
    release('Answer.');
    await first;
    assert.match(await service.answer(ask('one', 'hello')), /Hello|nominal|operational/);
    assert.match(await service.answer(ask('one', 'how do I earn xp?')), /\/profile/);
  } finally { service.stop(); }
  const noLedger = createConversationService({ settings, provider, log: () => {} });
  try { assert.equal(await noLedger.answer(ask()), budgetUnavailable); }
  finally { noLedger.stop(); }
});

test('usage exceeding a reservation is truthfully recorded and blocks further paid calls in that window', async () => {
  const fixture = budgetFixture();
  const reservation = await fixture.budget.reserve(messages, 128);
  await fixture.budget.settle(reservation, usage(reservation.tokens + 1));
  assert.equal((await fixture.budget.status()).measuredTokens, reservation.tokens + 1);
  assert.equal((await fixture.budget.reserve(messages, 128)).allowed, false);
});

test('provider reports usage even when the completion is empty, including reasoning in total', async () => {
  let recorded;
  const provider = createAIProvider(settings, {
    env: { AI_INTEGRATIONS_OPENAI_BASE_URL: 'https://example.test', AI_INTEGRATIONS_OPENAI_API_KEY: 'fake' },
    transport: async () => ({ ok: true, json: async () => ({ choices: [], usage: usage(100) }) }),
  });
  await assert.rejects(provider.complete(messages, new AbortController().signal, { onUsage: value => { recorded = value; } }), /empty_response/);
  assert.equal(measuredUsage(recorded), 100);
});

test('budget controls require actual human Owner AND existing configured Owner identities; core status is not intercepted', async () => {
  const fixture = budgetFixture();
  const guild = { id: 'g', ownerId: 'owner', fetch: async () => guild };
  const handlers = createConversationHandlers({ client: {}, guild, cfg: { owners: ['owner', 'protected'], ownerDiscordId: 'owner' }, pool: {} },
    { settings, budget: fixture.budget });
  const replies = [];
  const interaction = { commandName: 'smith', guildId: 'g', user: { id: 'member', bot: false },
    isChatInputCommand: () => true, isButton: () => false,
    options: { getSubcommand: () => 'budget', getInteger: name => name === 'requests' ? 5 : 5000, getString: () => 'America/Chicago' },
    deferReply: async value => { assert.equal(value.flags, 64); }, editReply: async value => replies.push(value) };
  try {
    for (const id of ['member', 'protected']) {
      interaction.user.id = id;
      await handlers.handleInteraction(interaction);
      assert.match(replies.at(-1), /Only the configured human/);
    }
    interaction.user = { id: 'owner', bot: true };
    await handlers.handleInteraction(interaction);
    assert.equal(fixture.state().audit.length, 0);
    interaction.user.bot = false;
    await handlers.handleInteraction(interaction);
    assert.equal(fixture.state().audit.length, 1);
    assert.equal((await fixture.budget.status()).settings.requests, 5);
    interaction.options.getInteger = () => null;
    await handlers.handleInteraction(interaction);
    assert.match(replies.at(-1), /supply requests, tokens and timezone together/);
    interaction.options.getString = () => null;
    await handlers.handleInteraction(interaction);
    assert.match(replies.at(-1), /Daily paid AI/);
    interaction.options.getSubcommand = () => 'status';
    assert.equal(await handlers.handleInteraction(interaction), false);
  } finally { handlers.stop(); }
});
