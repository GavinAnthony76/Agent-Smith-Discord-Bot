import test from 'node:test';
import assert from 'node:assert/strict';
import { thresholds, titles, rankDefinitions, progressionConfig } from '../src/progression-config.js';
import { xpLevel, currentLevel, localDay, earnedAmount, assertAwardActor, validateUnlocks, legacyDecision } from '../src/progression-policy.js';
import { ranksGuide } from '../src/progression-interactions.js';
import { auditProgressionRoles } from '../src/progression-worker.js';
import { validateHelpfulMetadata } from '../src/progression-evidence.js';
import { botFixture } from './helpers/bot-fixture.js';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { Collection } from 'discord.js';

for (const framework of Object.keys(titles)) for (let index = 0; index < thresholds.length; index++) {
  test(`${framework} threshold ${index + 1}: exact, just below and just above`, () => {
    assert.equal(currentLevel(framework, thresholds[index], 7), index + 1);
    assert.equal(currentLevel(framework, thresholds[index] + 1, 7), index + 1);
    if (index) assert.equal(currentLevel(framework, thresholds[index] - 1, 7), index);
  });
}
test('all exact titles, independent ladders, and 21 unique rank names are configured', () => {
  assert.equal(rankDefinitions.length, 21);
  assert.equal(new Set(rankDefinitions.map(r => r.name)).size, 21);
  assert.deepEqual(thresholds, [0, 1000, 3500, 9000, 22000, 50000, 100000]);
  assert.equal(titles.Faith[6], 'Master of the Word');
  assert.equal(titles.Tech[5], 'Lord Digital'); assert.equal(titles.Tech[6], 'The One');
  assert.equal(titles.Gaming[6], 'Legend');
});
test('Faith cannot advance beyond level 2 without an explicit approval', () => {
  assert.equal(currentLevel('Faith', 100000, 2), 2);
  assert.equal(currentLevel('Faith', 100000, 3), 3);
  assert.equal(currentLevel('Faith', 3499, 7), 2);
  assert.equal(currentLevel('Faith', 0, 7), 1);
});
test('daily rewards share the framework cap and enforce cross-day cooldowns', () => {
  const now = new Date('2026-10-06T05:01:00Z');
  assert.deepEqual(earnedAmount({ source: 'helpful_answer', daily: 140, sourceDaily: 40, now }), { amount: 10, outcome: 'earned' });
  assert.deepEqual(earnedAmount({ source: 'verified_event', daily: 150, now }), { amount: 0, outcome: 'daily_limit' });
  assert.equal(earnedAmount({ source: 'trivia', sourceDaily: 30, now }).amount, 0);
  assert.equal(earnedAmount({ source: 'trivia', last: new Date(now - 599999), now }).outcome, 'cooldown');
  assert.equal(earnedAmount({ source: 'trivia', last: new Date(now - 600000), now }).amount, 10);
  assert.throws(() => earnedAmount({ source: 'message_volume', now }));
});
test('Chicago daily boundaries and repeated daylight-saving hours are deterministic', () => {
  assert.equal(localDay(new Date('2026-10-06T04:59:59Z')), '2026-10-05');
  assert.equal(localDay(new Date('2026-10-06T05:00:00Z')), '2026-10-06');
  assert.equal(localDay(new Date('2026-11-01T06:30:00Z')), localDay(new Date('2026-11-01T07:30:00Z')));
});
test('unauthorized and self-awards are denied; corrections are owner-only', () => {
  const cfg = { owners: ['owner'], approvers: ['reviewer'] };
  assert.throws(() => assertAwardActor(cfg, 'other', 'member'));
  assert.throws(() => assertAwardActor(cfg, 'reviewer', 'reviewer'));
  assert.throws(() => assertAwardActor(cfg, 'reviewer', 'member', true));
  assert.doesNotThrow(() => assertAwardActor(cfg, 'owner', 'member', true));
});
test('unlocks start disabled and reject global, cross-framework and duplicate-role configs', () => {
  assert.deepEqual(progressionConfig.unlocks, []);
  assert.doesNotThrow(() => validateUnlocks([{ framework: 'Gaming', level: 3, roleName: 'Gaming • Unlock: Events', channels: ['gaming-lounge'] }]));
  for (const unlock of [
    { framework: 'Gaming', level: 3, roleName: 'Global • Legend', channels: ['gaming-lounge'] },
    { framework: 'Gaming', level: 8, roleName: 'Gaming • Unlock: Events', channels: ['gaming-lounge'] },
    { framework: 'Gaming', level: 3, roleName: 'Faith • Unlock: Events', channels: ['gaming-lounge'] }
  ]) assert.throws(() => validateUnlocks([unlock]));
});
test('legacy balances need verified provenance and are never copied into all frameworks', () => {
  assert.equal(legacyDecision(0), 'empty');
  assert.equal(legacyDecision(20), 'ambiguous');
  assert.equal(legacyDecision(20, true), 'Gaming');
  assert.equal(legacyDecision(-10, true), 'ambiguous');
});
test('rank guide fits Discord and states limits and Faith participation disclaimer', () => {
  const guide = ranksGuide();
  assert(guide.length <= 1950);
  assert.match(guide, /not spiritual worth/); assert.match(guide, /150/);
  assert.match(guide, /No message-volume/);
});
test('permission audit detects a rank with permissions or native self-assignment', async () => {
  const roles = new Map(rankDefinitions.map(d => [d.name, { id: d.name, name: d.name, editable: true, managed: false, permissions: { bitfield: 0n } }]));
  const cache = Object.assign(roles, { some: fn => [...roles.values()].some(fn) });
  const guild = { roles: { fetch: async () => {}, cache }, channels: { fetch: async () => {}, cache: { some: () => false, values: () => [] } },
    fetchOnboarding: async () => ({ prompts: new Map([['prompt', { options: new Map([['answer', { roles: new Map([['Gaming • Legend', {}]]) }]]) }]]) }) };
  roles.get('Tech • The One').permissions.bitfield = 8n;
  const errors = await auditProgressionRoles({ guild, resource: async (_, name) => name, config: progressionConfig });
  assert(errors.some(e => e.includes('Tech • The One')));
  assert(errors.some(e => e.includes('Native onboarding')));
});
test('helpful metadata rejects bot/command/system messages and outside-framework evidence without reading content', () => {
  const base = { message: { guildId: 'guild', author: { id: 'member', bot: false }, type: 0 }, uid: 'member', guildId: 'guild', inFramework: true, memberCanView: true };
  assert.doesNotThrow(() => validateHelpfulMetadata(base));
  for (const message of [
    { ...base.message, author: { id: 'member', bot: true } }, { ...base.message, type: 20 },
    { ...base.message, interactionMetadata: {} }, { ...base.message, author: { id: 'other' } },
    { ...base.message, guildId: 'other-server' }, { ...base.message, webhookId: 'webhook' }
  ]) assert.throws(() => validateHelpfulMetadata({ ...base, message }));
  assert.throws(() => validateHelpfulMetadata({ ...base, inFramework: false }));
  assert.throws(() => validateHelpfulMetadata({ ...base, memberCanView: false }));
});
test('expired acknowledgement does not terminate the bot or create a request', async () => {
  const fixture = await botFixture();
  await fixture.dispatch({ deferReply: async () => { const error = new Error('Unknown interaction'); error.code = 10062; throw error; } });
  assert.equal(fixture.state.requests.length, 0);
  await fixture.dispatch();
  assert.equal(fixture.state.requests.length, 1);
});
test('actual role provisioning script creates 21 roles once and preserves every identity on a second apply', async () => {
  const source = await readFile(new URL('../src/progression-roles.js', import.meta.url), 'utf8');
  const tracked = new Map(), cache = new Collection(), reports = [];
  let creates = 0, sends = 0;
  const db = { async query(sql, args) {
    if (sql.startsWith('SELECT discord_id')) {
      const key = sql.includes("kind='message'") ? 'message:progression-guide' : `role:${args[1]}`;
      return { rows: tracked.has(key) ? [{ discord_id: tracked.get(key) }] : [] };
    }
    if (sql.includes("VALUES($1,'role'")) tracked.set(`role:${args[1]}`, args[2]);
    else if (sql.includes("VALUES($1,'message'")) tracked.set('message:progression-guide', args[1]);
    else assert.fail('Unexpected provisioning SQL');
    return { rows: [] };
  } };
  const guild = { id: 'fake-target', roles: { cache,
    async fetch(id) { return id ? cache.get(id) : cache; },
    async create(options) {
      assert.equal(options.permissions.length, 0); assert.equal(options.mentionable, false);
      const role = { id: `fake-role-${++creates}`, name: options.name, editable: true, managed: false, permissions: { bitfield: 0n } };
      cache.set(role.id, role); return role;
    }
  }, channels: { cache: new Collection(),
    async fetch() { return { async send(payload) { assert.equal(payload.allowedMentions.parse.length, 0); sends++; return { id: 'fake-guide' }; } }; }
  } };
  const dependencies = {
    './discord.js': { connect: async () => ({ guild, client: { destroy() {} }, cfg: { clientId: 'fake-bot' } }) },
    './db.js': { pool: { end: async () => {} }, resource: async () => 'fake-announcements', locked: (_, fn) => fn(db), audit: async () => {} },
    './progression-config.js': { rankDefinitions, progressionConfig, faithDisclaimer: 'Faith titles are not spiritual worth or authority.' },
    './progression-worker.js': { auditProgressionRoles: async () => [] }
  };
  for (let pass = 0; pass < 2; pass++) {
    const context = createContext({ process: { argv: ['node', 'fixture', '--apply'] }, console: { log: output => reports.push(JSON.parse(output)) } });
    const module = new SourceTextModule(source, { context });
    await module.link(specifier => {
      assert(Object.hasOwn(dependencies, specifier));
      const exports = dependencies[specifier];
      return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
    });
    await module.evaluate();
  }
  assert.equal(creates, 21); assert.equal(sends, 1); assert.equal(tracked.size, 22);
  assert.equal(reports[0].created, 21); assert.equal(reports[1].created, 0); assert.equal(reports[1].existing, 21);
});
