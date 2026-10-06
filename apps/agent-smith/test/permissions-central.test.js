import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { hasPermission, assertBotCapabilities, capabilities, inheritedLegacyPermissionBits } from '../src/permissions.js';

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
function inheritedBot(extra=0n, ownLegacy=false) {
  const legacy=1n<<47n;
  const everyone={id:'everyone',permissions:{bitfield:legacy|P.ViewChannel}};
  const own={id:'smith',permissions:{bitfield:P.ManageRoles|(ownLegacy?legacy:0n)}};
  return {guild:{roles:{everyone}},roles:{cache:new Map([[everyone.id,everyone],[own.id,own]])},
    permissions:{bitfield:legacy|P.ViewChannel|P.ManageRoles|extra}};
}
test('Owner-approved bit 47 is non-blocking only when inherited exclusively from everyone',()=>{
  const bot=inheritedBot();
  assert.equal(inheritedLegacyPermissionBits(bot),1n<<47n);
  assert.doesNotThrow(()=>assertBotCapabilities(bot));
  assert.throws(()=>assertBotCapabilities(inheritedBot(0n,true)),/unknown bits/);
  assert.throws(()=>assertBotCapabilities({permissions:{bitfield:1n<<47n}}),/unknown bits/);
  bot.guild.roles.everyone.permissions.bitfield=P.ViewChannel;
  assert.throws(()=>assertBotCapabilities(bot),/unknown bits/);
});
test('legacy exception never permits Administrator, forbidden powers, or other unknown bits',()=>{
  for(const name of capabilities.denied)assert.throws(()=>assertBotCapabilities(inheritedBot(P[name])),/UNSAFE/);
  assert.throws(()=>assertBotCapabilities(inheritedBot(1n<<62n)),/unknown bits/);
  assert.deepEqual(capabilities.inheritedLegacyBits,['0x800000000000']);
});
