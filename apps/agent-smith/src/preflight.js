import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { categories, frameworks, roleNames } from './blueprint.js';
import { overwrites, botPermissions } from './discord.js';
import { commands } from './commands.js';

// Pure offline checks. This script never logs into Discord or opens PostgreSQL.
const cfg = { owners: ['owner'], approvers: ['reviewer'] };
const roles = Object.fromEntries(['Member', ...frameworks].map(name => [name, `role:${name}`]));
const has = (bits, permission) => new PermissionsBitField(bits).has(permission);
assert.equal(new Set(roleNames).size, roleNames.length, 'Role names must be unique');
assert.equal(has(botPermissions, P.Administrator), false, 'Bot must not request Administrator');
const names = categories.flatMap(category => [category.name, ...category.channels.map(([name]) => name)]);
assert.equal(new Set(names).size, names.length, 'Resource names must be unique');

for (const category of categories) {
  for (const [name, , readonly = false] of [[category.name, 'category', false], ...category.channels]) {
    const entries = overwrites({ id: 'everyone' }, cfg, 'bot', category.gate, roles, readonly);
    const allowed = entries.filter(entry => has(entry.allow, P.ViewChannel)).map(entry => entry.id).sort();
    const expected = ['bot', 'owner', 'reviewer'];
    if (category.gate !== 'staff') expected.push(category.gate ? roles[category.gate] : 'everyone');
    assert.deepEqual(allowed, expected.sort(), `${name}: unexpected visibility grant`);
    if (category.gate) assert.ok(has(entries[0].deny, P.ViewChannel), `${name}: everyone must be denied`);
    if (readonly && category.gate !== 'staff') {
      const audience = entries.find(entry => entry.id === (category.gate ? roles[category.gate] : 'everyone'));
      for (const permission of [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads]) {
        assert.ok(has(audience.deny, permission), `${name}: audience may write`);
      }
    }
    for (const entry of entries) assert.equal(has(entry.allow, P.Administrator), false, `${name}: Administrator grant`);
  }
  console.log(`PASS ${category.name}: ${category.gate ?? 'public'} visibility, ${category.channels.length} channels`);
}
const definitions = commands.map(command => command.toJSON());
assert.equal(new Set(definitions.map(command => command.name)).size, definitions.length);
for (const command of definitions) assert.equal(command.dm_permission, false, `${command.name}: DMs must be disabled`);
console.log(`PASS ${definitions.length} guild-only slash command definitions`);
console.log('Offline permission preflight passed. Live Discord overrides, role hierarchy, and database workflows have NOT been verified.');