import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeDecision, reconcileNative, nativeQuestionErrors, nativeDefaultChannelErrors, legacyAllowed } from '../src/native-policy.js';
import { selectionRoleNames, categories, ARRIVAL_CHANNEL_ID } from '../src/blueprint.js';

// Transactional fake preserves the important failure boundary: primary intent
// commits separately, while a successful Discord role write cannot roll back.
function harness({ pending = false, selections = ['Gaming'], record, roles = [], grants = [], bot = false } = {}) {
  const state = { pending, selections, record, roles: new Set(roles), grants, bot, audit: [], alerts: new Set(), writes: [], failRole: null, failCommit: false };
  let tail = Promise.resolve();
  const transact = fn => {
    const operation = tail.then(async () => {
      const localRecord = state.record && structuredClone(state.record);
      let reserved = localRecord;
      const localAudit = [], alerts = [];
      const snapshot = { pending: state.pending, selections: [...state.selections], bot: state.bot,
        record: localRecord, held: ['Faith', 'Gaming', 'Tech'].filter(f => state.roles.has(f)), grants: [...state.grants] };
      const result = await fn({
        snapshot,
        reserve: async primary => { reserved = { ...localRecord, accepted_at: localRecord?.accepted_at ?? 'screening-cleared', primary_framework: primary }; localAudit.push('reserve'); },
        alert: async reason => { alerts.push(reason); },
        add: async name => {
          const current = nativeDecision({ ...snapshot, pending: state.pending, selections: state.selections });
          if (current.status !== 'ready') throw new Error('state changed');
          if (state.roles.has(name)) return false;
          state.roles.add(name); state.writes.push(name);
          if (state.failRole === name) { state.failRole = null; throw new Error('Discord interrupted after role write'); }
          return true;
        },
        recordGrant: async added => { localAudit.push(added); }
      });
      if (state.failCommit) { state.failCommit = false; throw new Error('database commit failed'); }
      state.record = reserved; state.audit.push(...localAudit); alerts.forEach(a => state.alerts.add(a));
      return result;
    });
    tail = operation.catch(() => {});
    return operation;
  };
  return { state, transact, run: () => reconcileNative(transact) };
}

test('native blueprint signals have no default access gate; arrival identity is fixed', () => {
  assert.deepEqual(selectionRoleNames, ['Selection: Faith', 'Selection: Gaming', 'Selection: Tech']);
  assert.equal(ARRIVAL_CHANNEL_ID, '1556451709272719451');
  assert.ok(categories.find(c => c.name === 'START HERE').channels.some(([n]) => n === 'arrival-lounge'));
  assert.ok(categories.every(c => !selectionRoleNames.includes(c.gate)));
});
test('screening must be explicitly false, even if a selection is present', async () => {
  for (const pending of [true, null, undefined]) {
    const h = harness(); h.state.pending = pending;
    assert.equal((await h.run()).status, 'waiting-screening');
    assert.equal(h.state.record, undefined); assert.deepEqual(h.state.writes, []);
  }
});
test('no selection does not initialize or grant access', async () => {
  const h = harness({ selections: [] });
  assert.equal((await h.run()).status, 'waiting-selection');
  assert.equal(h.state.record, undefined);
});
test('exactly one choice after screening creates compatible member record and access', async () => {
  const h = harness(); await h.run();
  assert.equal(h.state.record.primary_framework, 'Gaming'); assert.ok(h.state.record.accepted_at);
  assert.deepEqual(h.state.writes, ['Member', 'Gaming']);
});
test('screening completion is reconciled using fresh state rather than join event', async () => {
  const h = harness({ pending: true }); await h.run(); h.state.pending = false; await h.run();
  assert.equal(h.state.record.primary_framework, 'Gaming');
  assert.deepEqual(h.state.writes, ['Member', 'Gaming']);
});
test('later changed choice never replaces primary or adds a framework', async () => {
  const h = harness(); await h.run(); h.state.selections = ['Faith']; await h.run();
  assert.equal(h.state.record.primary_framework, 'Gaming');
  assert.deepEqual([...h.state.roles].sort(), ['Gaming', 'Member']);
  assert.deepEqual(h.state.writes, ['Member', 'Gaming']);
});
test('multiple selections fail closed and repeated events deduplicate staff alerts', async () => {
  const h = harness({ selections: ['Faith', 'Tech'] });
  for (let i = 0; i < 3; i++) assert.equal((await h.run()).status, 'blocked');
  assert.equal(h.state.record, undefined); assert.deepEqual(h.state.writes, []);
  assert.deepEqual([...h.state.alerts], ['multiple-selections']);
});
test('multiple selections on an existing member add nothing and preserve approved extras', async () => {
  const h = harness({ selections: ['Faith', 'Gaming'], record: { accepted_at: 'old', primary_framework: 'Gaming', xp: 120 },
    roles: ['Member', 'Gaming', 'Tech'], grants: ['Tech'] });
  await h.run();
  assert.deepEqual(h.state.writes, []); assert.ok(h.state.roles.has('Tech'));
  assert.equal(h.state.record.primary_framework, 'Gaming'); assert.equal(h.state.record.xp, 120);
});
test('existing member primary, acceptance, XP, trivia and human-approved extras survive reconciliation', async () => {
  const record = { primary_framework: 'Gaming', accepted_at: 'old-date', xp: 150, last_trivia: 'old-trivia' };
  const h = harness({ record, selections: ['Tech'], roles: ['Member', 'Gaming', 'Faith'], grants: ['Faith'] });
  await h.run(); assert.deepEqual(h.state.record, record);
  assert.deepEqual(h.state.writes, []); assert.ok(h.state.roles.has('Faith')); assert.ok(!h.state.roles.has('Tech'));
});
test('legacy accepted member without a primary can initialize without losing data', async () => {
  const h = harness({ record: { accepted_at: 'old', xp: 30, last_trivia: 'yesterday' }, roles: ['Member'], selections: ['Tech'] });
  await h.run(); assert.equal(h.state.record.accepted_at, 'old'); assert.equal(h.state.record.xp, 30);
  assert.equal(h.state.record.last_trivia, 'yesterday'); assert.equal(h.state.record.primary_framework, 'Tech');
});
test('unrecorded existing access is not silently legitimized or expanded', async () => {
  const h = harness({ roles: ['Faith'], selections: ['Tech'] }); await h.run();
  assert.deepEqual(h.state.writes, []); assert.equal(h.state.record, undefined);
  assert.ok(h.state.alerts.has('unrecorded-access')); assert.ok(h.state.roles.has('Faith'));
});
test('existing matching framework can initialize its first explicit native choice without extra access', async () => {
  const h = harness({ roles: ['Gaming'], selections: ['Gaming'] }); await h.run();
  assert.equal(h.state.record.primary_framework, 'Gaming');
  assert.deepEqual(h.state.writes, ['Member']); assert.deepEqual([...h.state.roles].sort(), ['Gaming', 'Member']);
});
test('restart/retry after external role success and database rollback uses durable original primary', async () => {
  const h = harness(); h.state.failRole = 'Member';
  await assert.rejects(h.run());
  assert.equal(h.state.record.primary_framework, 'Gaming'); assert.ok(h.state.roles.has('Member'));
  h.state.selections = ['Tech']; // user changes native answer before restart
  await reconcileNative(h.transact); await reconcileNative(h.transact);
  assert.deepEqual(h.state.writes, ['Member', 'Gaming']); assert.ok(!h.state.roles.has('Tech'));
});
test('failed intent commit produces no external grant; later retry initializes once', async () => {
  const h = harness(); h.state.failCommit = true; await assert.rejects(h.run());
  assert.equal(h.state.record, undefined); assert.deepEqual(h.state.writes, []);
  await h.run(); assert.deepEqual(h.state.writes, ['Member', 'Gaming']);
});
test('concurrent join/update/startup events serialize and initialize exactly once', async () => {
  const h = harness(); await Promise.all(Array.from({ length: 50 }, () => h.run()));
  assert.equal(h.state.audit.filter(a => a === 'reserve').length, 1);
  assert.deepEqual(h.state.writes, ['Member', 'Gaming']);
});
test('ambiguous selection arriving between intent and writes stops access until repaired', async () => {
  const h = harness(); let phases = 0;
  const transact = async fn => {
    const result = await h.transact(fn);
    if (++phases === 1) h.state.selections = ['Gaming', 'Faith'];
    return result;
  };
  assert.equal((await reconcileNative(transact)).status, 'blocked');
  assert.deepEqual(h.state.writes, []); assert.equal(h.state.record.primary_framework, 'Gaming');
  h.state.selections = ['Faith']; await h.run();
  assert.deepEqual(h.state.writes, ['Member', 'Gaming']);
});
test('recorded primary recovery never restores an absent approved extra automatically', async () => {
  const h = harness({ record: { accepted_at: 'old', primary_framework: 'Gaming' }, selections: ['Faith'], grants: ['Faith'] });
  await h.run(); assert.deepEqual(h.state.writes, ['Member', 'Gaming']);
  assert.deepEqual(h.state.grants, ['Faith']); assert.ok(!h.state.roles.has('Faith'));
});
test('bot accounts, invalid selections and incomplete records cannot initialize', async () => {
  const bot = harness({ bot: true }); await bot.run(); assert.deepEqual(bot.state.writes, []);
  assert.equal(nativeDecision({ pending: false, selections: ['Unknown'] }).status, 'blocked');
  assert.equal(nativeDecision({ pending: false, selections: ['Gaming'], record: { primary_framework: 'Gaming' } }).status, 'blocked');
});
const ids = { Faith: 'faith-selection', Gaming: 'gaming-selection', Tech: 'tech-selection' };
test('saved published onboarding takes precedence over documented default-channel minimums', () => {
  assert.deepEqual(nativeDefaultChannelErrors({ enabled: true, mode: 0 }, 4, 1), []);
  assert.equal(nativeDefaultChannelErrors({ enabled: false, mode: 0 }, 4, 1).length, 1);
  assert.deepEqual(nativeDefaultChannelErrors({ enabled: false, mode: 0 }, 7, 5), []);
  assert.equal(nativeDefaultChannelErrors({ enabled: false, mode: 0 }, 7, 4).length, 1);
  assert.deepEqual(nativeDefaultChannelErrors({ enabled: false, mode: 1 }, 4, 1), []);
});
const published = () => ({ enabled: true, prompts: [{ required: true, single_select: true, in_onboarding: true,
  options: Object.entries(ids).map(([title, id]) => ({ title, role_ids: [id], channel_ids: [] })) }] });
test('optional audited cosmetics are allowed but never substitute for Selection or grant membership', () => {
  const data = published();
  const optional = { required: false, single_select: false, in_onboarding: false,
    options: [{ title: 'Programming', role_ids: ['cosmetic'], channel_ids: [] }] };
  data.prompts.push(optional);
  assert.deepEqual(nativeQuestionErrors(data, ids, ['cosmetic']), []);
  assert(nativeQuestionErrors(data, ids).length);
  optional.required = true;
  assert(nativeQuestionErrors(data, ids, ['cosmetic']).length);
  optional.required = false; optional.options[0].channel_ids = ['private-tech'];
  assert(nativeQuestionErrors(data, ids, ['cosmetic']).length);
  optional.options[0].channel_ids = []; optional.options[0].role_ids = ['framework-role'];
  assert(nativeQuestionErrors(data, ids, ['cosmetic']).length);
  optional.options[0].role_ids = ['rank-role'];
  assert(nativeQuestionErrors(data, ids, ['cosmetic']).length);
});
test('cutover requires enabled native UI and exact required single-choice mappings', () => {
  assert.deepEqual(nativeQuestionErrors(published(), ids), []);
  for (const key of ['required', 'single_select', 'in_onboarding']) {
    const data = published(); data.prompts[0][key] = false;
    assert.ok(nativeQuestionErrors(data, ids).length);
  }
  const data = published(); data.enabled = false; assert.ok(nativeQuestionErrors(data, ids).length);
});
test('cutover rejects actual access role mapping, channel mappings, duplicate choices and extra selection questions', () => {
  for (const change of [
    d => d.prompts[0].options[0].role_ids.push('actual-Faith-access'),
    d => d.prompts[0].options[0].channel_ids.push('gated-channel'),
    d => d.prompts[0].options.push(d.prompts[0].options[0]),
    d => d.prompts.push(d.prompts[0]),
    d => d.prompts.push({ options: [{ role_ids: ['Member'] }] })
  ]) {
    const data = published(); change(data); assert.ok(nativeQuestionErrors(data, ids).length);
  }
});
test('old onboarding remains active by default and is blocked only by committed explicit switch', () => {
  assert.equal(legacyAllowed(undefined), true);
  assert.equal(legacyAllowed({ legacy_enabled: true }), true);
  assert.equal(legacyAllowed({ legacy_enabled: false, cutover_status: 'cutting-over' }), false);
  assert.equal(legacyAllowed({ legacy_enabled: false, cutover_status: 'native' }), false);
});