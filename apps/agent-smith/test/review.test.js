import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestId, pendingMessage, reviewAction, isReviewInteraction, pendingAction, isPendingInteraction, PENDING_PAGE_SIZE } from '../src/review.js';
const button = customId => ({ customId, isButton: () => true });

test('review UI distinguishes request numbers, offers explicit approval/denial, and never pings members', () => {
  const message = pendingMessage([{ id: '1', framework: 'Faith', user_id: '123456789012345678' }]);
  assert.match(message.content, /\*\*Request #1\*\* — Faith/);
  assert.match(message.content, /NOT the member/);
  const [approve, deny] = message.components[0].toJSON().components;
  assert.deepEqual(reviewAction(button(approve.custom_id)), { name: 'review', framework: null, requestId: '1', approve: true });
  assert.equal(reviewAction(button(deny.custom_id)).approve, false);
  assert.deepEqual(message.allowedMentions.parse, []);
  assert.deepEqual(pendingMessage([]).components, []);
});

test('review UI respects component/message limits and refuses forged actions or invalid request IDs', () => {
  const requests = Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1), framework: 'Tech', user_id: '123456789012345678' }));
  const message = pendingMessage(requests);
  assert.equal(message.components.length, 5);
  assert.equal(message.components[4].toJSON().components[0].custom_id, 'smith:pending:after:15');
  assert.doesNotMatch(message.content, /Request #16/);
  assert.ok(pendingMessage(requests).content.length < 2000);
  assert.equal(isReviewInteraction(button('other')), false);
  assert.throws(() => reviewAction(button('smith:review:admin:1')));
  for (const id of ['', '0', '-1', '1;DROP', '9223372036854775808']) assert.throws(() => parseRequestId(id));
});

test('pending pages validate cursors, bound long IDs, and offer refresh for empty stale pages', () => {
  assert.equal(isPendingInteraction(button('smith:pending:first')), true);
  assert.equal(pendingAction(button('other')), null);
  assert.deepEqual(pendingAction(button('smith:pending:first')), { name: 'pending', framework: null, after: null });
  assert.deepEqual(pendingAction(button('smith:pending:after:15')), { name: 'pending', framework: null, after: '15' });
  for (const suffix of ['after:0', 'after:-1', 'after:1;DROP', 'after:9223372036854775808', 'next', 'first:1']) {
    assert.throws(() => pendingAction(button(`smith:pending:${suffix}`)));
  }
  const rows = Array.from({ length: PENDING_PAGE_SIZE + 1 }, (_, index) => ({
    id: String(9223372036854775700n + BigInt(index)), user_id: '1234567890123456789', framework: 'Gaming'
  }));
  const message = pendingMessage(rows, '9223372036854775699');
  assert.ok(message.content.length <= 2000);
  assert.equal(message.components.length, 5);
  for (const row of message.components) {
    for (const component of row.toJSON().components) {
      assert.ok(component.custom_id.length <= 100);
      assert.ok(component.label.length <= 80);
    }
    assert.ok(row.toJSON().components.length <= 5);
  }
  assert.deepEqual(message.allowedMentions, { parse: [] });
  const empty = pendingMessage([], '15');
  assert.match(empty.content, /No pending requests after Request #15/);
  assert.equal(empty.components[0].toJSON().components[0].custom_id, 'smith:pending:first');
  assert.deepEqual(empty.allowedMentions.parse, []);
});