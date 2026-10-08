import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, REST } from 'discord.js';
import { createServer } from 'node:http';
import { withTicketWrite, executeTicketWrite } from '../src/platform/ticket-write.js';
import { ticketOverwrites } from '../src/platform/tickets.js';
import { TARGET_GUILD_ID } from '../src/config.js';

const guildId = '80000000000000001', actorId = '90000000000000001';
const client = {};
function fixture() {
  const events = [];
  const body = { name: 'ticket-aaaaaaaa', type: 0, parent_id: '80000000000000008',
    topic: 'smith-ticket:aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    permission_overwrites: [{ id: guildId, type: 0, allow: '0', deny: P.ViewChannel.toString() }] };
  const plan = { client, guildId, actorId, operation: 'ticket.create', method: 'POST',
    route: `/guilds/${guildId}/channels`, body, validate: async () => {},
    record: async event => events.push(event) };
  const request = { method: plan.method, fullRoute: plan.route, body };
  return { plan, request, events };
}
test('ticket SDK scope requires durable intent and allows just one exact bounded write', async () => {
  const { plan, request, events } = fixture();
  let calls = 0;
  await withTicketWrite(plan, async () => {
    assert.equal(await executeTicketWrite(client, request, async () => { calls++; return 'created'; }), 'created');
    assert.throws(() => executeTicketWrite(client, request, () => {}), /not_authorized/);
  });
  assert.equal(calls, 1);
  assert.deepEqual(events, ['security.intent', 'security.result']);
  assert.equal(executeTicketWrite(client, request, () => {}), null);
});
test('ticket scope cannot authorize Hallowed Core, roles, deletion, another client or altered bodies', async () => {
  const { plan, request } = fixture();
  assert.throws(() => withTicketWrite({ ...plan, guildId: TARGET_GUILD_ID }, () => {}), /policy_not_available/);
  assert.throws(() => withTicketWrite({ ...plan, operation: 'roles.add' }, () => {}), /policy_not_available/);
  for (const modified of [{ method: 'DELETE' }, { fullRoute: `/guilds/${guildId}/members/${actorId}/roles/123` },
    { body: { ...request.body, permission_overwrites: [] } }]) {
    await withTicketWrite(plan, async () => assert.throws(() =>
      executeTicketWrite(client, { ...request, ...modified }, () => {}), /not_authorized/));
  }
  await withTicketWrite(plan, async () => assert.throws(() =>
    executeTicketWrite({}, request, () => {}), /not_authorized/));
});
test('public or privileged ticket channel permissions are rejected even with a matching plan', async () => {
  for (const overwrite of [{ id: guildId, type: 0, allow: P.ViewChannel.toString(), deny: '0' },
    { id: guildId, type: 0, allow: P.Administrator.toString(), deny: P.ViewChannel.toString() }]) {
    const { plan, request } = fixture();
    plan.body.permission_overwrites = [overwrite];
    await withTicketWrite(plan, async () => assert.throws(() =>
      executeTicketWrite(client, request, () => {}), /must_be_private/));
  }
});
test('intent audit failure blocks Discord and uncertain results never automatically resend', async () => {
  const { plan, request } = fixture();
  let calls = 0;
  await assert.rejects(withTicketWrite({ ...plan, record: async () => { throw new Error('audit unavailable'); } },
    () => executeTicketWrite(client, request, async () => calls++)), /audit unavailable/);
  assert.equal(calls, 0);
  await assert.rejects(withTicketWrite(plan, () => executeTicketWrite(client, request, async () => {
    calls++; throw new Error('acknowledgement lost');
  })), /acknowledgement lost/);
  assert.equal(calls, 1);
});
test('closed ticket ACL keeps private evidence without extending privileges', () => {
  const rows = ticketOverwrites({ id: guildId, members: { me: { id: '90000000000000002' } } }, actorId, ['80000000000000009'], true);
  assert.equal(rows[0].deny, P.ViewChannel.toString());
  assert.ok(BigInt(rows.find(row => row.id === actorId).deny) & P.SendMessages);
  assert.ok(rows.every(row => !(BigInt(row.allow) & (P.Administrator | P.ManageChannels | P.ManageRoles))));
});
test('real SDK REST request shape passes the exact ticket gate before reaching a local test server', async t => {
  const received = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received.push({ method: request.method, path: request.url, body: JSON.parse(body) });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: '81000000000000001' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const rest = new REST({ version: '10', api: `http://127.0.0.1:${server.address().port}`, retries: 0 });
  rest.setToken('synthetic-sdk-test-token');
  t.after(async () => {
    rest.clearHashSweeper(); rest.clearHandlerSweeper();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const original = rest.request.bind(rest);
  rest.request = request => executeTicketWrite(rest, request, () => original(request)) ??
    Promise.reject(new Error('Unscoped SDK test write refused'));
  const { plan } = fixture();
  const result = await withTicketWrite({ ...plan, client: rest }, () => rest.post(plan.route, { body: plan.body }));
  assert.equal(result.id, '81000000000000001');
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.deepEqual(received[0].body, plan.body);
});
