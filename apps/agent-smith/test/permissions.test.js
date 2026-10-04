import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P,OverwriteType} from 'discord.js';
import {overwrites,botPermissions} from '../src/discord.js';
import {commands} from '../src/commands.js';
const cfg={owners:['owner'],approvers:['reviewer']};
const roles={Member:'member',Faith:'faith',Gaming:'gaming',Tech:'tech'};
test('bot permissions never include Administrator',()=>{
  assert.equal(new PermissionsBitField(botPermissions).has(P.Administrator),false);
});
test('private categories deny everyone and allow only the framework and designated staff',()=>{
  for(const f of ['Faith','Gaming','Tech']) {
    const o=overwrites({id:'guild'},cfg,'bot',f,roles);
    assert.ok(new PermissionsBitField(o[0].deny).has(P.ViewChannel));
    assert.deepEqual(o.filter(x=>new PermissionsBitField(x.allow).has(P.ViewChannel)).map(x=>x.id).sort(),['bot','owner','reviewer',roles[f]].sort());
    assert.ok(!o.some(x=>x.id==='member'));
  }
});
test('control room has no member or framework grants',()=>{
  assert.deepEqual(overwrites({id:'guild'},cfg,'bot','staff',roles).map(x=>x.id),['guild','bot','owner','reviewer']);
});
test('rules accessible before membership but cannot be edited by everyone',()=>{
  const o=overwrites({id:'guild'},cfg,'bot',null,roles,true)[0];
  assert.ok(new PermissionsBitField(o.allow).has(P.ViewChannel));
  assert.ok(new PermissionsBitField(o.deny).has(P.SendMessages));
});
test('all slash command definitions serialize',()=>{
  const json=commands.map(x=>x.toJSON());
  assert.deepEqual(json.map(x=>x.name).sort(),['accept','join','request','interest','pending','review','revoke','trivia','answer','profile'].sort());
  assert.equal(new Set(json.map(x=>x.name)).size,json.length);
});
test('overwrite principal types are explicit even when human users are not cached',()=>{
  for (const gate of [null, 'staff', 'Member', 'Faith']) {
    const entries = overwrites({id:'guild'},cfg,'bot',gate,roles);
    for (const entry of entries) {
      assert.equal(entry.type, ['bot','owner','reviewer'].includes(entry.id) ? OverwriteType.Member : OverwriteType.Role);
    }
  }
});
test('actual guild owner needs no overwrite while other designated staff retain access',()=>{
  const entries = overwrites({id:'guild',ownerId:'owner'},cfg,'bot','staff',roles);
  assert.equal(entries.some(x=>x.id==='owner'),false);
  assert.equal(entries.some(x=>x.id==='reviewer'&&x.type===OverwriteType.Member),true);
});
