import test from 'node:test';
import assert from 'node:assert/strict';
import { botFixture, replyText, assertPrivate } from './helpers/bot-fixture.js';

const reviewOptions = kind => ({ kind, command: 'review', user: 'reviewer' });
const roleChange = { user: 'member', role: 'role:Tech' };
const text = payload => typeof payload === 'string' ? payload : payload.content;

function assertPending(state, original) {
  assert.deepEqual(state.requests, original.requests);
  assert.deepEqual(state.grants, original.grants);
  assert.deepEqual(state.audits, original.audits);
  assert.deepEqual(state.members.get('member').record, original.record);
}

function persisted(state) {
  return structuredClone({
    requests: state.requests, grants: state.grants, audits: state.audits,
    record: state.members.get('member').record
  });
}

function assertFailure(i, message) {
  assertPrivate(i);
  assert.equal(replyText(i), `Unable to complete: ${message}`);
  assert.deepEqual(Array.from(i.replies[0].allowedMentions.parse), []);
}

test('role-add rejection leaves review pending with no grant; a later retry can approve', async t => {
  for (const kind of ['button', 'command']) {
    await t.test(kind, async () => {
      const { state, dispatch, failNext } = await botFixture();
      await dispatch();
      const before = persisted(state);
      const messages = structuredClone(state.messages);
      const fault = failNext('roleAdd', { match: change => change.role === 'role:Tech',
        message: 'Discord role add unavailable' });
      const i = await dispatch(reviewOptions(kind));
      assert.equal(fault.used, true);
      assertFailure(i, fault.message);
      assertPending(state, before);
      assert.deepEqual(state.roleAddAttempts, [roleChange]);
      assert.deepEqual(state.roleAdds, []);
      assert.deepEqual(state.roleRemoves, []);
      assert.equal(state.members.get('member').held.has('role:Tech'), false);
      assert.deepEqual(structuredClone(state.messages), messages);
      assert.deepEqual(state.errors.at(-1), ['Command failed:', fault.message]);
      assert.equal(state.queries.some(q => q.sql.startsWith('INSERT INTO grants')), false);
      assert.equal(state.queries.some(q => q.sql.startsWith('UPDATE requests SET status')), false);

      const retry = await dispatch(reviewOptions(kind));
      assertPrivate(retry);
      assert.equal(replyText(retry), 'Request 1 approved by human reviewer.');
      assert.equal(state.requests[0].status, 'approved');
      assert.equal(state.grants.length, 1);
      assert.deepEqual(state.roleAdds, [roleChange]);
      assert.equal(state.members.get('member').held.has('role:Tech'), true);
    });
  }
});

test('known database rollback after Discord grants access leaves an unrecorded role and unsafe retry messaging', async t => {
  const stages = [
    ['grant insert', 'query', { match: ({ sql }) => sql.startsWith('INSERT INTO grants') }],
    ['decision update', 'query', { match: ({ sql }) => sql.startsWith('UPDATE requests SET status') }],
    ['durable audit', 'audit', { match: ({ action }) => action === 'review' }],
    ['commit rejection', 'commit', {}]
  ];
  for (const kind of ['button', 'command']) {
    for (const [label, point, options] of stages) {
      await t.test(`${kind}: ${label}`, async () => {
        const { state, dispatch, failNext } = await botFixture();
        await dispatch();
        const before = persisted(state);
        const messages = structuredClone(state.messages);
        const fault = failNext(point, { ...options, message: `Database unavailable at ${label}` });
        const i = await dispatch(reviewOptions(kind));
        assert.equal(fault.used, true);
        assertFailure(i, fault.message);
        assertPending(state, before);
        assert.deepEqual(state.roleAdds, [roleChange]);
        assert.equal(state.members.get('member').held.has('role:Tech'), true);
        assert.deepEqual(state.roleRemoves, []);
        assert.deepEqual(structuredClone(state.messages), messages);
        assert.deepEqual(state.errors.at(-1), ['Command failed:', fault.message]);
        // Characterization, not a safety endorsement: the private error omits
        // the already-granted access and gives no reconciliation/retry warning.
        assert.doesNotMatch(replyText(i), /role|granted|reconcil|retry/i);

        const pending = await dispatch({ kind: 'command', command: 'pending', user: 'reviewer' });
        assertPrivate(pending);
        assert.match(replyText(pending), /Request #1/);
        const memberRetry = await dispatch();
        assertFailure(memberRetry, 'You already have this framework.');
        assertPending(state, before);

        // Retrying review calls Discord again rather than recognizing partial
        // success. The fake Set models role-add idempotence, not compensation.
        const retry = await dispatch(reviewOptions(kind));
        assertPrivate(retry);
        assert.equal(replyText(retry), 'Request 1 approved by human reviewer.');
        assert.deepEqual(state.roleAddAttempts, [roleChange, roleChange]);
        assert.deepEqual(state.roleAdds, [roleChange, roleChange]);
        assert.equal(state.requests[0].status, 'approved');
        assert.equal(state.requests[0].reviewer, 'reviewer');
        assert.equal(state.grants.length, 1);
        assert.equal(state.audits.filter(a => a.action === 'review').length, 1);
        assert.equal(state.members.get('member').held.has('role:Tech'), true);
      });
    }
  }
});

test('review notification failure cannot undo a committed request but replaces its private success reply', async t => {
  for (const kind of ['menu', 'command']) {
    for (const point of ['channelFetch', 'channelSend']) {
      await t.test(`${kind}: ${point}`, async () => {
        const { state, dispatch, failNext } = await botFixture();
        const original = structuredClone(state.members.get('member'));
        const fault = failNext(point, { match: ({ channel }) => channel === 'channel:access-review',
          message: 'Review notification unavailable' });
        const i = await dispatch({ kind, command: 'request' });
        assert.equal(fault.used, true);
        assertPrivate(i, 2);
        assert.equal(text(i.replies[0]), 'Request 1 is pending human review. No access was granted.');
        assert.equal(replyText(i), `Unable to complete: ${fault.message}`);
        assert.deepEqual(Array.from(i.replies[1].allowedMentions.parse), []);
        assert.deepEqual(state.requests, [{
          id: '1', guild_id: 'test-guild', user_id: 'member', framework: 'Tech', status: 'pending', reviewer: null
        }]);
        assert.equal(state.audits.length, 1);
        assert.equal(state.audits[0].action, 'request');
        assert.deepEqual(state.grants, []);
        assert.deepEqual(state.roleAdds, []);
        assert.deepEqual(state.roleRemoves, []);
        assert.deepEqual(state.members.get('member'), original);
        assert.equal(state.messages.filter(m => m.channel === 'channel:access-review').length, 0);
        assert.equal(state.messages.filter(m => m.channel === 'channel:audit-log').length, 1);
        assert.deepEqual(state.errors.at(-1), ['Command failed:', fault.message]);
        // Current final reply inaccurately implies the whole operation failed.
        assert.doesNotMatch(replyText(i), /pending|saved|committed|retry/i);
        const pending = await dispatch({ kind: 'command', command: 'pending', user: 'reviewer' });
        assertPrivate(pending);
        assert.match(replyText(pending), /Request #1/);

        const retry = await dispatch({ kind, command: 'request' });
        assertPrivate(retry);
        assert.equal(replyText(retry), 'Request 1 is pending human review. No access was granted.');
        assert.equal(state.requests.length, 1);
        assert.equal(state.audits.filter(a => a.action === 'request').length, 2);
        assert.equal(state.messages.filter(m => m.channel === 'channel:access-review').length, 1);
        assert.deepEqual(state.members.get('member'), original);
        assert.deepEqual(state.grants, []);
      });
    }
  }
});
