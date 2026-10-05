import test from 'node:test';
import assert from 'node:assert/strict';
import { botFixture, replyText, assertPrivate } from './helpers/bot-fixture.js';
import { PENDING_PAGE_SIZE } from '../src/review.js';

function seedQueue(fixture, count, start = 1n) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: String(start + BigInt(index)), guild_id: fixture.cfg.guildId,
    user_id: 'member', framework: 'Tech', status: 'pending', reviewer: null
  }));
  // Deliberately out of order: the query must sort by bigint, not text or insertion.
  fixture.state.requests.push(...rows.toReversed());
  return rows;
}

function buttons(i) {
  return i.replies.at(-1).components.flatMap(row => row.toJSON().components);
}

function requestIds(i) {
  return [...replyText(i).matchAll(/\*\*Request #(\d+)\*\*/g)].map(match => match[1]);
}

function assertSafePage(i) {
  assertPrivate(i);
  const payload = i.replies.at(-1);
  assert.deepEqual(payload.allowedMentions.parse, []);
  assert.ok(payload.content.length <= 2000);
  assert.ok(payload.components.length <= 5);
  assert.ok(requestIds(i).length <= PENDING_PAGE_SIZE);
  for (const row of payload.components) assert.ok(row.toJSON().components.length <= 5);
}

test('staff can discover every request in large queues, with no guild/status leakage or writes', async t => {
  for (const count of [0, 15, 16, 30, 31, 47]) {
    await t.test(`${count} pending requests`, async () => {
      const fixture = await botFixture();
      const expected = seedQueue(fixture, count);
      fixture.state.requests.push(
        { id: '1000', guild_id: 'other-guild', user_id: 'outsider', framework: 'Faith', status: 'pending' },
        { id: '1001', guild_id: fixture.cfg.guildId, user_id: 'member', framework: 'Faith', status: 'approved' },
        { id: '1002', guild_id: fixture.cfg.guildId, user_id: 'member', framework: 'Faith', status: 'denied' }
      );
      const before = structuredClone(fixture.state.requests);
      let page = await fixture.dispatch({ kind: 'command', command: 'pending', user: 'reviewer' });
      const seen = [];
      while (true) {
        assertSafePage(page);
        seen.push(...requestIds(page));
        const next = buttons(page).find(b => b.label === 'Next page');
        if (!next) break;
        assert.ok(seen.length < count);
        page = await fixture.dispatch({ kind: 'button', customId: next.custom_id, user: 'reviewer' });
      }
      assert.deepEqual(seen, expected.map(r => r.id));
      assert.deepEqual(fixture.state.requests, before);
      assert.deepEqual(fixture.state.roleAdds, []);
      assert.deepEqual(fixture.state.roleRemoves, []);
      assert.deepEqual(fixture.state.grants, []);
      assert.deepEqual(fixture.state.audits, []);
      assert.deepEqual(fixture.state.messages, []);
      assert.deepEqual(fixture.state.locks, []);
      assert.ok(fixture.state.queries.every(q => q.sql.startsWith('SELECT id,user_id,framework FROM requests')));
      if (count > PENDING_PAGE_SIZE) {
        const first = buttons(page).find(b => b.label === 'First page');
        assert.ok(first);
        const refreshed = await fixture.dispatch({ kind: 'button', customId: first.custom_id, user: 'owner',
          channelId: 'channel:smith-controls' });
        assertSafePage(refreshed);
        assert.deepEqual(requestIds(refreshed), expected.slice(0, PENDING_PAGE_SIZE).map(r => r.id));
      }
    });
  }
});

test('cursor pages do not skip remaining requests when earlier requests leave the queue', async () => {
  const fixture = await botFixture();
  seedQueue(fixture, 32);
  const first = await fixture.dispatch({ kind: 'command', command: 'pending', user: 'reviewer' });
  const next = buttons(first).find(b => b.label === 'Next page').custom_id;
  for (const request of fixture.state.requests) {
    if (BigInt(request.id) <= 17n) request.status = 'approved';
  }
  fixture.state.requests.push({ id: '33', guild_id: fixture.cfg.guildId, user_id: 'member',
    framework: 'Tech', status: 'pending' });
  const page = await fixture.dispatch({ kind: 'button', customId: next, user: 'reviewer' });
  assertSafePage(page);
  assert.deepEqual(requestIds(page), Array.from({ length: 15 }, (_, index) => String(index + 18)));
  const last = await fixture.dispatch({ kind: 'button',
    customId: buttons(page).find(b => b.label === 'Next page').custom_id, user: 'reviewer' });
  assert.deepEqual(requestIds(last), ['33']);
  fixture.state.requests.forEach(request => { request.status = 'denied'; });
  const empty = await fixture.dispatch({ kind: 'button', customId: next, user: 'reviewer' });
  assertSafePage(empty);
  assert.match(replyText(empty), /No pending requests after Request #15/);
  assert.equal(buttons(empty)[0].label, 'First page');
});

test('paging keeps large request numbers exact beyond JavaScript safe integers', async () => {
  const fixture = await botFixture();
  const expected = seedQueue(fixture, 16, 9223372036854775700n);
  const first = await fixture.dispatch({ kind: 'command', command: 'pending', user: 'owner' });
  assertSafePage(first);
  const next = buttons(first).find(b => b.label === 'Next page');
  assert.equal(next.custom_id, `smith:pending:after:${expected[14].id}`);
  const second = await fixture.dispatch({ kind: 'button', customId: next.custom_id, user: 'owner' });
  assertSafePage(second);
  assert.deepEqual(requestIds(second), [expected[15].id]);
});

test('paging enforces staff allowlists, private channels, guild, humans, bot authorship and valid cursors', async () => {
  const fixture = await botFixture();
  seedQueue(fixture, 47);
  const rejected = [
    { kind: 'command', command: 'pending', user: 'member' },
    { kind: 'button', customId: 'smith:pending:after:15', user: 'member' },
    { kind: 'button', customId: 'smith:pending:first', user: 'member' },
    { kind: 'command', command: 'pending', user: 'reviewer', channelId: 'channel:arcade' },
    { kind: 'button', customId: 'smith:pending:after:15', user: 'reviewer', channelId: 'channel:access-requests' },
    { kind: 'button', customId: 'smith:pending:first', user: 'owner', channelId: 'channel:onboarding' },
    { kind: 'button', customId: 'smith:pending:after:15', user: 'reviewer',
      message: { author: { id: 'impostor' } } },
    ...['0', '-1', '1;DROP', '9223372036854775808', '01'].map(cursor => ({
      kind: 'button', customId: `smith:pending:after:${cursor}`, user: 'reviewer'
    })),
    { kind: 'button', customId: 'smith:pending:admin', user: 'owner' }
  ];
  for (const options of rejected) {
    const i = await fixture.dispatch(options);
    assertPrivate(i);
    assert.match(replyText(i), /^Unable to complete:/);
    assert.equal(i.replies[0].allowedMentions.parse.length, 0);
    assert.doesNotMatch(replyText(i), /\*\*Request #/);
  }
  for (const options of [
    { user: { id: 'reviewer', bot: true } }, { guildId: 'other-guild', user: 'owner' }
  ]) {
    for (const base of [
      { kind: 'command', command: 'pending' },
      { kind: 'button', customId: 'smith:pending:after:15' }
    ]) {
      const i = await fixture.dispatch({ ...base, ...options });
      assert.equal(i.deferred.length, 0);
      assert.equal(i.replies.length, 0);
    }
  }
  assert.deepEqual(fixture.state.queries, []);
  assert.deepEqual(fixture.state.roleAdds, []);
  assert.deepEqual(fixture.state.messages, []);
});

test('requests discovered beyond the old 20-request limit still support explicit review and self-review refusal', async () => {
  const fixture = await botFixture();
  seedQueue(fixture, 32);
  const page = await fixture.dispatch({ kind: 'button', customId: 'smith:pending:after:30', user: 'reviewer' });
  assertSafePage(page);
  assert.deepEqual(requestIds(page), ['31', '32']);
  const approve = buttons(page).find(b => b.label === 'Approve #31');
  const self = await fixture.dispatch({ kind: 'button', customId: approve.custom_id, user: 'member' });
  assert.match(replyText(self), /Only allowlisted/);
  fixture.cfg.approvers.push('member');
  const allowlistedSelf = await fixture.dispatch({ kind: 'button', customId: approve.custom_id, user: 'member' });
  assert.match(replyText(allowlistedSelf), /Another allowlisted human/);
  const approved = await fixture.dispatch({ kind: 'button', customId: approve.custom_id, user: 'reviewer' });
  assert.match(replyText(approved), /Request 31 approved/);
  assert.equal(fixture.state.requests.find(r => r.id === '31').status, 'approved');
  assert.deepEqual(fixture.state.roleAdds, [{ user: 'member', role: 'role:Tech' }]);
  const denied = await fixture.dispatch({ kind: 'command', command: 'review', id: '32', approve: false, user: 'owner' });
  assert.match(replyText(denied), /Request 32 denied/);
  assert.equal(fixture.state.requests.find(r => r.id === '32').status, 'denied');
  const stale = await fixture.dispatch({ kind: 'button', customId: approve.custom_id, user: 'reviewer' });
  assert.match(replyText(stale), /Request already reviewed/);
  assert.equal(fixture.state.roleAdds.length, 1);
});
