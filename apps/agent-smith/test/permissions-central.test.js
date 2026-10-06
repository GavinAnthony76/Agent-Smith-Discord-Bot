import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { hasPermission, assertBotCapabilities, capabilities } from '../src/permissions.js';

test('channel resolution overrides guild permission and is not inferred from position', () => {
  const member = { permissions: new PermissionsBitField([P.ManageMessages]), roles: { highest: { position: 999 } } };
  const channel = { permissionsFor: actor => {
    assert.equal(actor, member);
    return new PermissionsBitField([P.ViewChannel]);
  } };
  assert.equal(hasPermission(member, P.ManageMessages), true);
  assert.equal(hasPermission(member, P.ManageMessages, channel), false);
});
test('all forbidden and unknown flags fail closed; allowlist remains separate from denylist', () => {
  for (const name of capabilities.denied) {
    assert(!capabilities.allowed.includes(name));
    assert.throws(() => assertBotCapabilities({ permissions: new PermissionsBitField([P[name]]) }), /UNSAFE/);
  }
  assert.throws(() => assertBotCapabilities({ permissions: { bitfield: 1n << 62n } }), /outside/);
  // Unknown future bits also fail, even when discord.js cannot name them.
  assertBotCapabilities({ permissions: new PermissionsBitField([P.ManageRoles, P.ViewChannel]) });
});
