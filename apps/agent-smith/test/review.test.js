import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestId, pendingMessage, reviewAction, isReviewInteraction } from '../src/review.js';
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
  assert.equal(pendingMessage(requests).components.length, 5);
  assert.ok(pendingMessage(requests).content.length < 2000);
  assert.equal(isReviewInteraction(button('other')), false);
  assert.throws(() => reviewAction(button('smith:review:admin:1')));
  for (const id of ['', '0', '-1', '1;DROP', '9223372036854775808']) assert.throws(() => parseRequestId(id));
});