import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingMessage, onboardingAction, isOnboardingInteraction, ACCEPT_RULES_ID, CHOOSE_FRAMEWORK_ID } from '../src/onboarding.js';
import { maySelfJoin } from '../src/policy.js';

const interaction = (type, customId, values = []) => ({
  customId, values,
  isButton: () => type === 'button',
  isStringSelectMenu: () => type === 'select'
});

test('read-only onboarding offers explicit rules acceptance and exactly one community', () => {
  const message = onboardingMessage();
  assert.match(message.content, /Read #rules/);
  assert.match(message.content, /no typing required/);
  assert.deepEqual(message.allowedMentions.parse, []);
  const [buttonRow, menuRow] = message.components.map(row => row.toJSON());
  assert.equal(buttonRow.components[0].custom_id, ACCEPT_RULES_ID);
  assert.equal(menuRow.components[0].custom_id, CHOOSE_FRAMEWORK_ID);
  assert.equal(menuRow.components[0].min_values, 1);
  assert.equal(menuRow.components[0].max_values, 1);
  assert.deepEqual(menuRow.components[0].options.map(option => option.value), ['Faith', 'Gaming', 'Tech']);
});

test('rules button maps only to existing accept action', () => {
  const button = interaction('button', ACCEPT_RULES_ID);
  assert.equal(isOnboardingInteraction(button), true);
  assert.deepEqual(onboardingAction(button), { name: 'accept', framework: null });
});

test('community menu maps to existing join policy; acceptance and one initial choice remain required', () => {
  for (const framework of ['Faith', 'Gaming', 'Tech']) {
    const menu = interaction('select', CHOOSE_FRAMEWORK_ID, [framework]);
    assert.deepEqual(onboardingAction(menu), { name: 'join', framework });
    assert.throws(() => maySelfJoin({ accepted: false, existing: [], requested: framework }));
    assert.doesNotThrow(() => maySelfJoin({ accepted: true, existing: [], requested: framework }));
    assert.throws(() => maySelfJoin({ accepted: true, existing: ['Faith'], requested: framework }));
  }
});

test('unknown or forged component values cannot choose other access', () => {
  assert.equal(isOnboardingInteraction(interaction('button', 'other')), false);
  assert.equal(onboardingAction(interaction('button', 'other')), null);
  assert.equal(onboardingAction(interaction('button', CHOOSE_FRAMEWORK_ID)), null);
  for (const values of [[], ['Administrator'], ['Faith', 'Gaming']]) {
    assert.throws(() => onboardingAction(interaction('select', CHOOSE_FRAMEWORK_ID, values)));
  }
});