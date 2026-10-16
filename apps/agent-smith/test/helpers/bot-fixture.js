import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import * as blueprint from '../../src/blueprint.js';
import * as policy from '../../src/policy.js';
import * as onboarding from '../../src/onboarding.js';
import * as accessRequest from '../../src/access-request.js';
import * as review from '../../src/review.js';
import * as nativePolicy from '../../src/native-policy.js';
import * as recovery from '../../src/access-recovery.js';
import * as securityPolicy from '../../src/security-policy.js';
import * as requestLifecycle from '../../src/request-lifecycle.js';
import { runLocked } from '../../src/transaction.js';
import { transactionStore } from './transaction-store.js';
import { safeMemberFailure, operationalFailure } from '../../src/platform/diagnostics.js';

// Evaluate the actual bot entry point in a closed module graph. Never import
// discord.js's connection wrapper, config.js, or any live worker. The real
// db.js transaction helper runs with a fake pg Pool, never a network driver.
// Unknown imports and SQL fail closed rather than falling through to a service.
export async function botFixture() {
  const state = {
    members: new Map(), requests: [], grants: [], audits: [], queries: [],
    locks: [], roleAdds: [], roleAddAttempts: [], roleRemoves: [], messages: [], errors: [],
    onboarding: { legacy_enabled: true, cutover_status: 'legacy' }
  };
  const cfg = { guildId: 'test-guild', owners: ['owner'], ownerDiscordId: 'owner', approvers: ['reviewer'] };
  const faults = [];
  function failNext(point, { match = () => true, message = `Injected ${point} failure`, code, effect } = {}) {
    assert.ok(['roleAdd', 'roleAddAfter', 'roleRemove', 'memberFetch', 'query', 'audit', 'commit', 'commitAfter', 'rollback', 'channelFetch', 'channelSend', 'editReply'].includes(point));
    const fault = { point, match, message, code, effect, used: false };
    faults.push(fault);
    return fault;
  }
  function trip(point, detail) {
    const fault = faults.find(f => !f.used && f.point === point && f.match(detail));
    if (fault) {
      fault.used = true;
      fault.effect?.(state);
      const error = new Error(fault.message);
      error.code = fault.code ?? (point === 'commit' ? '40001' : undefined);
      throw error;
    }
  }
  const events = new Map();
  const client = { user: { id: 'test-bot' }, on: (name, fn) => events.set(name, fn) };
  const resource = async (kind, name) => `${kind}:${name}`;
  const guild = {
    id: cfg.guildId,
    ownerId: 'owner', fetch: async () => guild,
    members: { fetch: async ({ user, force }) => {
      assert.equal(force, true);
      trip('memberFetch', { user });
      const member = state.members.get(user);
      assert.ok(member, `Unseeded fake member ${user}`);
      return {
        user: { id: user, bot: member.bot }, pending: member.pending,
        roles: {
          cache: { has: id => member.held.has(id) },
          add: async role => {
            state.roleAddAttempts.push({ user, role: role.id });
            trip('roleAdd', { user, role: role.id });
            state.roleAdds.push({ user, role: role.id });
            member.held.add(role.id);
            trip('roleAddAfter', { user, role: role.id });
          },
          remove: async id => {
            trip('roleRemove', { user, role: id });
            state.roleRemoves.push({ user, role: id });
            member.held.delete(id);
          }
        }
      };
    } },
    roles: { fetch: async id => ({ id, editable: true, permissions: { bitfield: 0n } }) },
    channels: { fetch: async id => {
      trip('channelFetch', { channel: id });
      return { send: async payload => {
        trip('channelSend', { channel: id, payload });
        state.messages.push({ channel: id, payload });
      } };
    } }
  };
  const database = transactionStore(state, cfg.guildId, trip);
  const context = createContext({
    console: { log: () => {}, error: (...args) => state.errors.push(args) },
    process: { env: {}, on: () => {} }
  });
  const dbSource = await readFile(new URL('../../src/db.js', import.meta.url), 'utf8');
  const dbModule = new SourceTextModule(dbSource, { context, identifier: 'isolated-db.js' });
  await dbModule.link(specifier => {
    assert.ok(['pg', './config.js', './transaction.js'].includes(specifier), `Unmocked database import: ${specifier}`);
    const exports = specifier === 'pg'
      ? { default: { Pool: class { constructor() { return database.pool; } } } }
      : specifier === './transaction.js' ? { runLocked }
      : { config: () => ({ ...cfg, databaseUrl: 'isolated-fake-only' }) };
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await dbModule.evaluate();
  const inert = async () => {};
  const dependencies = {
    './platform/diagnostics.js': {safeMemberFailure,operationalFailure},
    './discord.js': { connect: async () => ({ client, guild, cfg }) },
    './db.js': { pool: database.pool, locked: dbModule.namespace.locked,
      audit: dbModule.namespace.audit, resource },
    './blueprint.js': blueprint, './policy.js': policy, './onboarding.js': onboarding,
    './access-request.js': accessRequest, './review.js': review, './native-policy.js': nativePolicy,
    './access-recovery.js': recovery,
    './security-policy.js': securityPolicy,
    './request-lifecycle.js': {...requestLifecycle,createRequestLifecycle:()=>({start(){},stop(){}})},
    './smith-control.js': {createSmithControl:()=>({handle:async()=>{throw new Error('Control settings must use their isolated tests.');}})},
    './feeds.js': {createFeeds:()=>({start:inert,stop:inert})},
    // Readiness has independent unit/PostgreSQL coverage; this closed fixture
    // exercises access workflows without a real schema or network connection.
    './feed-schema-check.js': {assertFeedSchema:inert},
    // Real listener and conversation handling have separate isolated tests.
    // Access workflow fixtures must never open a port or invoke an AI provider.
    './worker-status.js': {createWorkerStatus:()=>({listen:inert,close:inert,setPhase(){}})},
    './conversation-handler.js': {createConversationHandlers:()=>({register:inert,handleInteraction:async()=>false,handleMessage:async()=>false,stop(){}})},
    './platform/runtime.js': {createPlatformRuntime:()=>({handler:inert,initialize:inert,handleInteraction:async()=>false,handleMessage:async()=>false,stop(){}})},
    './maintenance-cases.js': {createCases:()=>({record:inert,restricted:async()=>false})},
    './maintenance.js': {createMaintenance:()=>({handle:async()=>false,scan:inert,join:inert,leave:inert,event(){},handleMessage:inert,ensureMember:inert,enqueue(){},stop(){}})},
    './authorization.js': {canGrantFramework:()=>false},
    './progression.js': { createProgression: async () => ({
      enqueue: async () => {}, scan: async () => {}, stop() {},
      earnTx: async () => { throw new Error('Progression earning must use its isolated test fixture.'); }
    }) },
    './progression-interactions.js': { createProgressionInteractions: () => async () => false },
    './moderation.js': { isModerationInteraction: () => false, createModeration: () => ({
      handle: () => { throw new Error('Unexpected moderation dispatch'); }
    }) },
    './antispam.js': { createAntiSpam: async () => ({ handleMessage: inert }) },
    './native-reconcile.js': { createNativeReconciler: async () => ({
      enqueue: inert, drain: inert, scan: inert, stop: () => {}
    }) }
  };
  const source = await readFile(new URL('../../src/bot.js', import.meta.url), 'utf8');
  const module = new SourceTextModule(source, { context, identifier: 'isolated-bot.js' });
  securityPolicy.registerSecurityConfiguration(guild, cfg);
  await module.link(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unmocked bot import: ${specifier}`);
    const exports = dependencies[specifier];
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  assert.ok(events.has('interactionCreate'));

  function seed(user = 'member', overrides = {}) {
    state.members.set(user, {
      bot: false, pending: false, held: new Set(['role:Member', 'role:Gaming']),
      record: { accepted_at: '2026-01-01T00:00:00Z', primary_framework: 'Gaming' },
      ...overrides
    });
  }
  function interaction({ kind = 'menu', user = 'member', command, framework = 'Tech',
    id = '1', approve = true, ...overrides } = {}) {
    const deferred = [], replies = [];
    return {
      guildId: cfg.guildId, channelId: kind === 'menu' ? 'channel:access-requests' : 'channel:access-review',
      user: typeof user === 'string' ? { id: user, bot: false } : user,
      message: { id: 'message:access-requests', author: { id: client.user.id } },
      customId: kind === 'menu' ? accessRequest.REQUEST_FRAMEWORK_ID : `smith:review:${approve ? 'approve' : 'deny'}:${id}`,
      commandName: command, values: [framework],
      isChatInputCommand: () => kind === 'command',
      isStringSelectMenu: () => kind === 'menu',
      isButton: () => kind === 'button',
      options: { getString: key => ({ framework, id })[key] ?? null, getBoolean: () => approve },
      deferReply: async payload => { deferred.push(payload); },
      editReply: async payload => { trip('editReply', { payload }); replies.push(payload); },
      deferred, replies, ...overrides
    };
  }
  async function dispatch(options) {
    const i = interaction(options);
    await events.get('interactionCreate')(i);
    return i;
  }
  seed();
  return { state, cfg, seed, dispatch, database, failNext };
}

export function replyText(i) {
  const reply = i.replies.at(-1);
  return typeof reply === 'string' ? reply : reply?.content;
}

export function assertPrivate(i, replyCount = 1) {
  assert.equal(i.deferred.length, 1);
  assert.equal(i.deferred[0].flags, 64);
  assert.equal(i.replies.length, replyCount);
}
