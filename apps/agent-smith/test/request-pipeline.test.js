import test from 'node:test';
import assert from 'node:assert/strict';
import { botFixture, replyText, assertPrivate } from './helpers/bot-fixture.js';
import { ACCEPT_RULES_ID, CHOOSE_FRAMEWORK_ID } from '../src/onboarding.js';

function noAccessChanges(state) {
  assert.deepEqual(state.roleAdds, []);
  assert.deepEqual(state.roleRemoves, []);
  assert.deepEqual(state.grants, []);
  assert.equal(state.members.get('member').record.primary_framework, 'Gaming');
}

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
    id: '1', guild_id: 'test-guild', user_id: 'member', framework: 'Tech', status: 'pending', reviewer: null
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
