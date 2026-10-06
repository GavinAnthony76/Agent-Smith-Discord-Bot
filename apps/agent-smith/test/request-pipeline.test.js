import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { botFixture, replyText, assertPrivate } from './helpers/bot-fixture.js';
import { ACCEPT_RULES_ID, CHOOSE_FRAMEWORK_ID } from '../src/onboarding.js';

function noAccessChanges(state) {
  assert.deepEqual(state.roleAdds, []);
  assert.deepEqual(state.roleRemoves, []);
  assert.deepEqual(state.grants, []);
  assert.equal(state.members.get('member').record.primary_framework, 'Gaming');
}

const insertRequest = "INSERT INTO requests(guild_id,user_id,framework) VALUES($1,$2,$3) ON CONFLICT (guild_id,user_id,framework) WHERE status='pending' DO UPDATE SET framework=EXCLUDED.framework RETURNING id";
const lockRequest = 'SELECT * FROM requests WHERE id=$1 FOR UPDATE';

// Bypass the bot's advisory/member locks to exercise the unique-index and
// request-row behavior independently. All clients belong to the closed fake.
async function transaction(database, fn) {
  const db = await database.pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}

test('the fake models the production pending-only and grant uniqueness constraints', async () => {
  const schema = await readFile(new URL('../src/migrate.js', import.meta.url), 'utf8');
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS pending_request ON requests\(guild_id,user_id,framework\) WHERE status='pending'/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS grants\([^;]*PRIMARY KEY\(guild_id,user_id,framework\)/);
});

test('overlapping menu and command submissions reuse one pending ID per member/framework',
  { timeout: 5000 }, async t => {
    for (const firstKind of ['menu', 'command']) {
      await t.test(`${firstKind} starts first`, async () => {
        const { state, seed, dispatch, database } = await botFixture();
        seed('other-member');
        const gate = database.holdNextQuery(q => q.sql === insertRequest);
        const blocked = database.waitForBlockedLock('advisory:test-guild:member');
        const first = dispatch({ kind: firstKind, command: 'request' });
        let second;
        try {
          await gate.entered;
          assert.deepEqual(state.requests, [], 'Uncommitted request must not be visible');
          second = dispatch({ kind: firstKind === 'menu' ? 'command' : 'menu', command: 'request' });
          const waiting = await blocked;
          assert.ok(state.lockEvents.some(e => e.type === 'acquire'
            && e.key === waiting.key && e.transaction !== waiting.transaction));
          assert.equal(state.queries.filter(q => q.sql === insertRequest).length, 1);
          // An unrelated member must not be serialized or overwritten by this
          // member's transaction, even while its INSERT is paused.
          const other = await dispatch({ user: 'other-member' });
          assert.match(replyText(other), /Request 2 is pending/);
        } finally { gate.release(); }
        const replies = await Promise.all([first, second]);
        for (const i of replies) {
          assertPrivate(i);
          assert.match(replyText(i), /^Request 1 is pending human review\. No access was granted\.$/);
        }
        const faith = await dispatch({ framework: 'Faith' });
        assert.match(replyText(faith), /Request 4 is pending/);
        assert.deepEqual(state.requests.map(r => [r.id, r.user_id, r.framework, r.status]).sort(), [
          ['1', 'member', 'Tech', 'pending'],
          ['2', 'other-member', 'Tech', 'pending'],
          ['4', 'member', 'Faith', 'pending']
        ]);
        assert.equal(state.audits.length, 4);
        noAccessChanges(state);
        database.assertIdle();
      });
    }
  });

test('the pending unique key waits for an overlapping INSERT without advisory/member locks',
  { timeout: 5000 }, async t => {
    for (const rollback of [false, true]) {
      await t.test(rollback ? 'rollback releases the key without publishing a row' : 'commit reuses the existing ID', async () => {
        const { state, database } = await botFixture();
        const args = ['test-guild', 'member', 'Tech'];
        const gate = database.holdNextQuery(q => q.sql === insertRequest);
        const blocked = database.waitForBlockedLock(`pending:${JSON.stringify(args)}`);
        const first = transaction(database, async db => {
          const result = await db.query(insertRequest, args);
          if (rollback) throw new Error('Intentional test rollback');
          return result.rows[0].id;
        });
        // Attach a rejection handler before intentionally rolling back.
        const firstOutcome = first.then(id => ({ id }), error => ({ error }));
        let second;
        try {
          await gate.entered;
          second = transaction(database, async db => (await db.query(insertRequest, args)).rows[0].id);
          await blocked;
          assert.deepEqual(state.requests, []);
          assert.equal(state.locks.length, 0, 'No advisory lock may mask uniqueness behavior');
        } finally { gate.release(); }
        const [outcome, id] = await Promise.all([firstOutcome, second]);
        if (rollback) {
          assert.match(outcome.error.message, /Intentional test rollback/);
          assert.equal(id, '2', 'Sequence values are not rolled back');
        } else assert.equal(outcome.id, id);
        assert.equal(state.requests.length, 1);
        assert.equal(state.requests[0].id, id);
        assert.equal(state.requests[0].status, 'pending');
        noAccessChanges(state);
        database.assertIdle();
      });
    }
  });

test('a waiting request row lock reads the committed decision, not its stale pending snapshot',
  { timeout: 5000 }, async () => {
    const { state, dispatch, database } = await botFixture();
    await dispatch();
    const gate = database.holdNextQuery(q => q.sql === lockRequest);
    const blocked = database.waitForBlockedLock('request:1');
    const first = transaction(database, async db => {
      assert.equal((await db.query(lockRequest, ['1'])).rows[0].status, 'pending');
      await db.query('UPDATE requests SET status=$2,reviewer=$3 WHERE id=$1', ['1', 'denied', 'owner']);
    });
    let second;
    try {
      await gate.entered;
      second = transaction(database, async db => {
        assert.equal((await db.query('SELECT * FROM requests WHERE guild_id=$1 AND id=$2',
          ['test-guild', '1'])).rows[0].status, 'pending');
        return (await db.query(lockRequest, ['1'])).rows[0];
      });
      await blocked;
      assert.equal(state.requests[0].status, 'pending');
    } finally { gate.release(); }
    const [, row] = await Promise.all([first, second]);
    assert.equal(row.status, 'denied');
    assert.equal(row.reviewer, 'owner');
    assert.equal(state.requests[0].status, 'denied');
    noAccessChanges(state);
    database.assertIdle();
  });

test('two overlapping human reviews produce one decision and no duplicate or conflicting role effects',
  { timeout: 10000 }, async t => {
    for (const firstKind of ['button', 'command']) {
      for (const [approve, secondApprove] of [[true, true], [false, false], [true, false], [false, true]]) {
        await t.test(`${firstKind} ${approve ? 'approve' : 'deny'} beats ${secondApprove ? 'approve' : 'deny'}`, async () => {
          const { state, dispatch, database } = await botFixture();
          await dispatch();
          const gate = database.holdNextQuery(q => q.sql === lockRequest);
          const blocked = database.waitForBlockedLock('advisory:test-guild:member');
          const first = dispatch({ kind: firstKind, command: 'review', user: 'owner', approve });
          let second;
          try {
            await gate.entered;
            second = dispatch({ kind: firstKind === 'button' ? 'command' : 'button',
              command: 'review', user: 'reviewer', approve: secondApprove });
            await blocked;
            const lookups = state.queries.filter(q => q.sql === 'SELECT * FROM requests WHERE guild_id=$1 AND id=$2');
            assert.equal(lookups.length, 2, 'Both reviewers must load the request before the winning commit');
            assert.ok(lookups.every(q => q.rows[0].status === 'pending'));
            assert.deepEqual(state.roleAdds, [], 'Winner is still paused before its role effect');
          } finally { gate.release(); }
          const [winner, loser] = await Promise.all([first, second]);
          assertPrivate(winner);
          assertPrivate(loser);
          const status = approve ? 'approved' : 'denied';
          assert.equal(replyText(winner), `Request 1 ${status} by human owner.`);
          assert.match(replyText(loser), /Unable to complete: Request already reviewed/);
          assert.deepEqual(state.requests, [{
            id: '1', guild_id: 'test-guild', user_id: 'member', framework: 'Tech',
            status, reviewer: 'owner', expires_at:state.requests[0].expires_at
          }]);
          const rereads = state.queries.filter(q => q.sql === lockRequest);
          assert.deepEqual(rereads.map(q => q.rows[0].status), ['pending', status]);
          assert.deepEqual(state.roleAdds, approve ? [{ user: 'member', role: 'role:Tech' }] : []);
          assert.deepEqual(state.roleRemoves, []);
          assert.deepEqual(state.grants, approve ? [{
            guild_id: 'test-guild', user_id: 'member', framework: 'Tech', reviewer: 'owner'
          }] : []);
          assert.equal(state.members.get('member').held.has('role:Tech'), approve);
          assert.equal(state.members.get('member').record.primary_framework, 'Gaming');
          assert.deepEqual(state.audits.filter(a => a.action === 'review').map(a => a.actor), ['owner']);
          assert.equal(state.messages.filter(m => m.channel === 'channel:audit-log'
            && m.payload.content.startsWith('review |')).length, 1);
          assert.deepEqual(state.transactions.map(tx => tx.outcome), ['commit', 'commit', 'rollback']);
          database.assertIdle();
        });
      }
    }
  });

test('tracked menu privately creates a pending request, never grants access, and reuses its ID', async () => {
  const { state, dispatch } = await botFixture();
  const original = structuredClone(state.members.get('member'));
  for (const kind of ['menu', 'menu', 'command']) {
    const i = await dispatch({ kind, command: 'request' });
    assertPrivate(i);
    assert.match(replyText(i), /^Request 1 is pending human review\. No access was granted\.$/);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].status, 'pending');
    noAccessChanges(state);
    assert.deepEqual(state.members.get('member'), original);
  }
  assert.deepEqual(state.requests[0], {
    id: '1', guild_id: 'test-guild', user_id: 'member', framework: 'Tech', status: 'pending', reviewer: null,
    expires_at:state.requests[0].expires_at
  });
  assert.deepEqual(state.locks, Array(3).fill('test-guild:member'));
  assert.equal(state.audits.length, 3);
  const notifications = state.messages.filter(m => m.channel === 'channel:access-review');
  assert.equal(notifications.length, 3);
  for (const { payload } of notifications) {
    assert.match(payload.content, /New access request from member for Tech/);
    assert.deepEqual(Array.from(payload.allowedMentions.parse), []);
  }
});

test('requests require rules screening, acceptance, and a recorded first community', async t => {
  for (const [label, overrides, error] of [
    ['screening', { pending: true }, /server rules screening/],
    ['acceptance', { record: { accepted_at: null, primary_framework: 'Gaming' } }, /Accept rules and choose your first framework/],
    ['first community', { record: { accepted_at: '2026-01-01', primary_framework: null } }, /Accept rules and choose your first framework/],
    ['human member', { bot: true }, /Human members only/]
  ]) {
    await t.test(label, async () => {
      const { state, seed, dispatch } = await botFixture();
      seed('member', overrides);
      const before = structuredClone(state.members);
      for (const kind of ['menu', 'command']) {
        const i = await dispatch({ kind, command: 'request' });
        assertPrivate(i);
        assert.match(replyText(i), error);
      }
      assert.deepEqual(state.requests, []);
      assert.deepEqual(state.members, before);
      assert.deepEqual(state.audits, []);
      assert.deepEqual(state.messages, []);
      assert.deepEqual(state.roleAdds, []);
    });
  }
});

test('already-held communities and invalid menu values cannot create a request', async () => {
  const { state, dispatch } = await botFixture();
  for (const values of [['Gaming'], ['Administrator'], [], ['Tech', 'Faith'], undefined]) {
    const i = await dispatch({ values });
    assertPrivate(i);
    assert.match(replyText(i), /already have this framework|Choose Faith, Gaming, or Tech/);
  }
  assert.deepEqual(state.requests, []);
  noAccessChanges(state);
});

test('copied, untracked, wrong-channel, and non-bot request menus are refused', async t => {
  for (const [label, overrides] of [
    ['copied bot message', { message: { id: 'copied-message', author: { id: 'test-bot' } } }],
    ['untracked message', { message: { id: 'untracked', author: { id: 'member' } } }],
    ['wrong channel', { channelId: 'channel:general' }],
    ['non-bot author', { message: { id: 'message:access-requests', author: { id: 'member' } } }]
  ]) {
    await t.test(label, async () => {
      const { state, dispatch } = await botFixture();
      const i = await dispatch(overrides);
      assertPrivate(i);
      assert.match(replyText(i), /official request menu/);
      assert.deepEqual(state.queries, []);
      assert.deepEqual(state.messages, []);
      noAccessChanges(state);
    });
  }
});

test('other guilds, bot actors, and unrelated controls never dispatch', async () => {
  const { state, dispatch } = await botFixture();
  for (const overrides of [
    { guildId: 'other-guild' }, { user: { id: 'bot-actor', bot: true } }, { customId: 'unrelated-menu' }
  ]) {
    const i = await dispatch(overrides);
    assert.equal(i.deferred.length, 0);
    assert.equal(i.replies.length, 0);
  }
  assert.deepEqual(state.queries, []);
  noAccessChanges(state);
});

test('pending UI dispatches approval to the requesting member, for both allowlists and both review paths', async t => {
  for (const user of ['owner', 'reviewer']) {
    for (const kind of ['button', 'command']) {
      await t.test(`${user} ${kind}`, async () => {
        const { state, dispatch } = await botFixture();
        await dispatch();
        const pending = await dispatch({ kind: 'command', command: 'pending', user });
        assertPrivate(pending);
        const payload = pending.replies[0];
        assert.match(payload.content, /Request #1/);
        const customId = payload.components[0].toJSON().components[0].custom_id;
        const i = await dispatch({ kind, command: 'review', user, customId,
          channelId: user === 'owner' ? 'channel:smith-controls' : 'channel:access-review' });
        assertPrivate(i);
        assert.match(replyText(i), new RegExp(`Request 1 approved by human ${user}`));
        assert.deepEqual(state.roleAdds, [{ user: 'member', role: 'role:Tech' }]);
        assert.deepEqual(state.grants, [{ guild_id: 'test-guild', user_id: 'member', framework: 'Tech', reviewer: user }]);
        assert.equal(state.requests[0].status, 'approved');
        assert.equal(state.requests[0].reviewer, user);
        assert.equal(state.members.get('member').record.primary_framework, 'Gaming');
        assert.equal(state.audits.at(-1).actor, user);
        assert.equal(state.audits.at(-1).detail.subject, 'member');
        assert.equal(state.locks.at(-1), 'test-guild:member');
        const repeated = await dispatch({ kind, command: 'review', user, customId });
        assert.match(replyText(repeated), /already reviewed/);
        assert.equal(state.roleAdds.length, 1);
        assert.equal(state.grants.length, 1);
      });
    }
  }
});

test('review is human-only, allowlisted, in staff channels, and refuses self-approval', async t => {
  for (const [label, overrides, error] of [
    ['ordinary member', { user: 'outsider' }, /Only allowlisted human reviewers/],
    ['self approval', { user: 'owner' }, /Another allowlisted human/],
    ['public channel', { user: 'reviewer', channelId: 'channel:general' }, /Use the control room/],
    ['forged author', { user: 'reviewer', message: { author: { id: 'outsider' } } }, /bot’s review buttons/],
    ['forged action', { user: 'reviewer', customId: 'smith:review:admin:1' }, /Invalid review button/],
    ['unknown request', { user: 'reviewer', id: '999' }, /Request not found/]
  ]) {
    await t.test(label, async () => {
      const { state, seed, dispatch } = await botFixture();
      const requester = label === 'self approval' ? 'owner' : 'member';
      seed(requester);
      await dispatch({ user: requester });
      for (const kind of label.startsWith('forged') ? ['button'] : ['button', 'command']) {
        const i = await dispatch({ kind, command: 'review', ...overrides });
        assertPrivate(i);
        assert.match(replyText(i), error);
      }
      assert.equal(state.requests[0].status, 'pending');
      assert.equal(state.requests[0].reviewer, null);
      noAccessChanges(state);
    });
  }
  const { state, dispatch } = await botFixture();
  await dispatch();
  const i = await dispatch({ kind: 'button', user: { id: 'reviewer', bot: true } });
  assert.equal(i.replies.length, 0);
  assert.equal(state.requests[0].status, 'pending');
  noAccessChanges(state);
});

test('approval rechecks requester onboarding and denial does not grant access', async t => {
  for (const [label, overrides, error] of [
    ['screening', { pending: true }, /server rules screening/],
    ['missing acceptance', { record: { accepted_at: null, primary_framework: 'Gaming' } }, /complete onboarding/],
    ['missing primary', { record: { accepted_at: '2026-01-01', primary_framework: null } }, /complete onboarding/]
  ]) {
    await t.test(label, async () => {
      const { state, seed, dispatch } = await botFixture();
      await dispatch();
      seed('member', overrides);
      const i = await dispatch({ kind: 'button', user: 'reviewer' });
      assertPrivate(i);
      assert.match(replyText(i), error);
      assert.equal(state.requests[0].status, 'pending');
      assert.deepEqual(state.grants, []);
      assert.deepEqual(state.roleAdds, []);
    });
  }
  for (const kind of ['button', 'command']) {
    await t.test(`denial via ${kind}`, async () => {
      const { state, dispatch } = await botFixture();
      await dispatch();
      const i = await dispatch({ kind, command: 'review', user: 'reviewer', approve: false });
      assertPrivate(i);
      assert.match(replyText(i), /Request 1 denied by human reviewer/);
      assert.equal(state.requests[0].status, 'denied');
      assert.equal(state.requests[0].reviewer, 'reviewer');
      noAccessChanges(state);
      const next = await dispatch();
      assert.match(replyText(next), /Request 2 is pending/);
      assert.equal(state.requests.length, 2);
    });
  }
});

test('native cutover keeps additional requests and review working without reactivating accept/join', async () => {
  const { state, dispatch } = await botFixture();
  state.onboarding = { legacy_enabled: false, cutover_status: 'complete' };
  for (const kind of ['menu', 'command']) {
    const i = await dispatch({ kind, command: 'request' });
    assertPrivate(i);
    assert.match(replyText(i), /Request 1 is pending/);
  }
  noAccessChanges(state);
  for (const options of [
    { kind: 'button', customId: ACCEPT_RULES_ID },
    { kind: 'menu', customId: CHOOSE_FRAMEWORK_ID },
    { kind: 'command', command: 'accept' },
    { kind: 'command', command: 'join' }
  ]) {
    const i = await dispatch({ ...options, channelId: 'channel:onboarding',
      message: { id: 'message:onboarding', author: { id: 'test-bot' } } });
    assertPrivate(i);
    assert.match(replyText(i), /Legacy onboarding is disabled/);
    noAccessChanges(state);
  }
  const approval = await dispatch({ kind: 'button', user: 'reviewer' });
  assert.match(replyText(approval), /Request 1 approved/);
  assert.deepEqual(state.roleAdds, [{ user: 'member', role: 'role:Tech' }]);
  assert.equal(state.members.get('member').record.primary_framework, 'Gaming');
  assert.equal(state.onboarding.legacy_enabled, false);
  assert.equal(state.onboarding.cutover_status, 'complete');
});
