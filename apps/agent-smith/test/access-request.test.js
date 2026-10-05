import test from 'node:test';
import assert from 'node:assert/strict';
import { accessRequestMessage, accessRequestAction, isAccessRequestInteraction, REQUEST_FRAMEWORK_ID } from '../src/access-request.js';

const interaction = (values, id = REQUEST_FRAMEWORK_ID, select = true) => ({
  customId: id, values, isStringSelectMenu: () => select
});

test('read-only access requests have a one-community menu and explain human approval', () => {
  const message = accessRequestMessage();
  const menu = message.components[0].toJSON().components[0];
  assert.equal(menu.custom_id, REQUEST_FRAMEWORK_ID);
  assert.equal(menu.min_values, 1);
  assert.equal(menu.max_values, 1);
  assert.deepEqual(menu.options.map(option => option.value), ['Faith', 'Gaming', 'Tech']);
  assert.match(message.content, /private/);
  assert.match(message.content, /human must review and approve/);
  assert.match(message.content, /read-only/);
  assert.deepEqual(message.allowedMentions.parse, []);
});

test('request menu maps only to the existing request action, never accept or join', () => {
  for (const framework of ['Faith', 'Gaming', 'Tech']) {
    const menu = interaction([framework]);
    assert.equal(isAccessRequestInteraction(menu), true);
    assert.deepEqual(accessRequestAction(menu), { name: 'request', framework });
  }
});

test('unrelated components and forged framework selections cannot submit requests', () => {
  for (const menu of [interaction(['Faith'], 'other'), interaction(['Faith'], REQUEST_FRAMEWORK_ID, false)]) {
    assert.equal(isAccessRequestInteraction(menu), false);
    assert.equal(accessRequestAction(menu), null);
  }
  for (const values of [undefined, [], ['Administrator'], ['Faith', 'Gaming']]) {
    assert.throws(() => accessRequestAction(interaction(values)), /Choose Faith, Gaming, or Tech/);
  }
});
