import test from 'node:test';
import assert from 'node:assert/strict';
import { installSecurityGate } from '../src/security-gate.js';
import { smithCommand } from '../src/conversation-commands.js';
import { smithControlCommand, registerSmithControlCommand } from '../src/smith-control.js';

test('command registration accepts only the exact static Smith command and fixed application/guild', async () => {
  const forwarded = [];
  const client = { rest: { request: async request => { forwarded.push(request); return {}; } } };
  const guild = { id: '123' };
  const cfg = { clientId: '456', owners: ['owner'] };
  installSecurityGate({ client, guild, cfg });
  const request = { method: 'POST', fullRoute: '/applications/456/guilds/123/commands', body: smithCommand.toJSON() };
  await client.rest.request(request);
  assert.equal(forwarded.length, 1);
  for (const patch of [
    { body: { ...request.body, name: 'dangerous' } },
    { body: { ...request.body, default_member_permissions: '8' } },
    { fullRoute: '/applications/999/guilds/123/commands' },
    { fullRoute: '/applications/456/guilds/999/commands' },
    { method: 'PATCH' },
  ]) await assert.rejects(client.rest.request({ ...request, ...patch }));
  assert.equal(forwarded.length, 1);
});

test('Owner control registration upserts only its exact static command without broadening unknown writes', async () => {
  const forwarded = [];
  const guild = { id: '123' }, cfg = { clientId: '456', owners: ['owner'] };
  const client = { rest: {
    request: async request => { forwarded.push(request); },
    post: (fullRoute, options) => client.rest.request({ method: 'POST', fullRoute, ...options }),
  } };
  installSecurityGate({ client, guild, cfg });
  await registerSmithControlCommand({ client, guild, cfg });
  assert.equal(forwarded.length, 1);
  assert.deepEqual(forwarded[0].body, smithControlCommand.toJSON());
  await assert.rejects(client.rest.post('/applications/456/guilds/123/commands', {
    body: { ...smithControlCommand.toJSON(), name: 'dangerous' },
  }));
  assert.equal(forwarded.length, 1);
});
