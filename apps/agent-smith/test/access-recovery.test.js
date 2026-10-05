import test from 'node:test';
import assert from 'node:assert/strict';
import { botFixture, replyText, assertPrivate } from './helpers/bot-fixture.js';

const review = kind => ({ kind, command: 'review', user: 'reviewer' });
const grantFault = ({ sql }) => sql.startsWith('INSERT INTO grants');

for (const kind of ['button', 'command']) {
  test(`${kind}: pre-existing legitimate access is never added again or removed on failed storage`, async () => {
    const { state, dispatch, failNext } = await botFixture();
    await dispatch();
    state.members.get('member').held.add('role:Tech');
    failNext('query', { match: grantFault });
    const i = await dispatch(review(kind));
    assertPrivate(i);
    assert.match(replyText(i), /pre-existing access was preserved/);
    assert.equal(state.requests[0].status, 'pending');
    assert.equal(state.grants.length, 0);
    assert.equal(state.roleAddAttempts.length, 0);
    assert.equal(state.roleRemoves.length, 0);
    const retry = await dispatch(review(kind));
    assert.equal(replyText(retry), 'Request 1 approved by human reviewer.');
    assert.equal(state.grants.length, 1);
    assert.equal(state.roleAddAttempts.length, 0);
    assert.equal(state.members.get('member').held.has('role:Tech'), true);
  });

  test(`${kind}: a lost Discord acknowledgement preserves possible access and calls for reconciliation`, async () => {
    const { state, dispatch, failNext } = await botFixture();
    await dispatch();
    failNext('roleAddAfter');
    const i = await dispatch(review(kind));
    assertPrivate(i);
    assert.match(replyText(i), /approval was not saved.*role-add confirmation is uncertain/);
    assert.match(replyText(i), /Access may be active.*Staff reconciliation/);
    assert.equal(state.requests[0].status, 'pending');
    assert.equal(state.grants.length, 0);
    assert.equal(state.members.get('member').held.has('role:Tech'), true);
    assert.equal(state.roleRemoves.length, 0);
    await dispatch(review(kind));
    assert.equal(state.grants.length, 1);
    assert.equal(state.roleAddAttempts.length, 1);
  });

  test(`${kind}: a lost COMMIT acknowledgement preserves a saved approval and avoids destructive recovery`, async () => {
    const { state, dispatch, failNext } = await botFixture();
    await dispatch();
    failNext('commitAfter');
    const i = await dispatch(review(kind));
    assertPrivate(i);
    assert.match(replyText(i), /storage outcome is uncertain.*no role was removed.*reconciliation/);
    assert.equal(state.requests[0].status, 'approved');
    assert.equal(state.grants.length, 1);
    assert.equal(state.audits.filter(a => a.action === 'review').length, 1);
    assert.equal(state.members.get('member').held.has('role:Tech'), true);
    assert.equal(state.roleRemoves.length, 0);
    const retry = await dispatch(review(kind));
    assert.match(replyText(retry), /Request already reviewed/);
    assert.equal(state.roleAddAttempts.length, 1);
  });

  test(`${kind}: an unconfirmed COMMIT failure without persistence also does not authorize removal`, async () => {
    const { state, dispatch, failNext } = await botFixture();
    await dispatch();
    failNext('commit', { code: '08006' });
    const i = await dispatch(review(kind));
    assert.match(replyText(i), /storage outcome is uncertain.*reconciliation/);
    assert.equal(state.requests[0].status, 'pending');
    assert.equal(state.grants.length, 0);
    assert.equal(state.roleRemoves.length, 0);
    assert.equal(state.members.get('member').held.has('role:Tech'), true);
  });

  test(`${kind}: unconfirmed rollback preserves access and reports an uncertain storage outcome`, async () => {
    const { state, dispatch, failNext } = await botFixture();
    await dispatch();
    failNext('query', { match: grantFault });
    failNext('rollback');
    const i = await dispatch(review(kind));
    assertPrivate(i);
    assert.match(replyText(i), /storage outcome is uncertain.*no role was removed.*reconciliation/);
    assert.equal(state.roleRemoves.length, 0);
    assert.equal(state.members.get('member').held.has('role:Tech'), true);
  });

  test(`${kind}: already-absent new access is recovered without another Discord write`, async () => {
    const { state, dispatch, failNext } = await botFixture();
    await dispatch();
    failNext('query', { match: grantFault });
    state.afterRollback = () => {
      state.afterRollback = undefined;
      state.members.get('member').held.delete('role:Tech');
    };
    const i = await dispatch(review(kind));
    assertPrivate(i);
    assert.match(replyText(i), /new role is absent after recovery.*request remains pending/);
    assert.equal(state.roleRemoves.length, 0);
    assert.equal(state.requests[0].status, 'pending');
  });

  for (const point of ['roleRemove', 'memberFetch', 'query']) {
    test(`${kind}: failed recovery ${point} reports possible active access and permits a duplicate-free human retry`, async () => {
      const { state, dispatch, failNext } = await botFixture();
      await dispatch();
      failNext('query', { match: grantFault, effect: () => {
        failNext(point, { match: point === 'query' ? ({ sql }) => sql.startsWith('SELECT * FROM grants') : () => true });
      } });
      const i = await dispatch(review(kind));
      assertPrivate(i);
      assert.match(replyText(i), /approval was not saved.*recovery could not be confirmed.*Access may remain active.*reconciliation/);
      assert.deepEqual(Array.from(i.replies[0].allowedMentions.parse), []);
      assert.equal(state.requests[0].status, 'pending');
      assert.equal(state.grants.length, 0);
      assert.equal(state.members.get('member').held.has('role:Tech'), true);
      assert.equal(state.roleRemoves.length, 0);
      const retry = await dispatch(review(kind));
      assert.equal(replyText(retry), 'Request 1 approved by human reviewer.');
      assert.equal(state.roleAddAttempts.length, 1);
      assert.equal(state.grants.length, 1);
    });
  }

  for (const justification of ['saved grant', 'primary community', 'changed decision']) {
    test(`${kind}: fresh ${justification} prevents compensation from removing justified access`, async () => {
      const { state, dispatch, failNext } = await botFixture();
      await dispatch();
      failNext('query', { match: grantFault });
      // Simulate changes visible after the original transaction releases its
      // lock and before recovery reacquires it. This is not a race simulator.
      state.afterRollback = () => {
        state.afterRollback = undefined;
        if (justification === 'saved grant') state.grants.push({
          guild_id: 'test-guild', user_id: 'member', framework: 'Tech', reviewer: 'owner'
        });
        if (justification === 'primary community') state.members.get('member').record.primary_framework = 'Tech';
        if (justification === 'changed decision') state.requests[0].status = 'approved';
      };
      const i = await dispatch(review(kind));
      assert.match(replyText(i), /current records require preserving access/);
      assert.equal(state.roleRemoves.length, 0);
      assert.equal(state.members.get('member').held.has('role:Tech'), true);
    });
  }
}
