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
import { runLocked } from '../../src/transaction.js';

// Evaluate the actual bot entry point in a closed module graph. Never import
// discord.js's connection wrapper, db.js, config.js, or any live worker.
// Unknown imports and SQL fail closed rather than falling through to a service.
export async function botFixture() {
  const state = {
    members: new Map(), requests: [], grants: [], audits: [], queries: [],
    locks: [], roleAdds: [], roleAddAttempts: [], roleRemoves: [], messages: [], errors: [],
    onboarding: { legacy_enabled: true, cutover_status: 'legacy' }
  };
  const cfg = { guildId: 'test-guild', owners: ['owner'], approvers: ['reviewer'] };
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
  const query = async (sql, args = []) => {
    state.queries.push({ sql, args });
    trip('query', { sql, args });
    let rows = [];
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
      // Transaction lock is recorded, not sent to PostgreSQL.
    } else if (sql.startsWith('SELECT * FROM onboarding_state')) {
      rows = [{ ...state.onboarding }];
    } else if (sql.startsWith('INSERT INTO members')) {
      assert.equal(args[0], guild.id);
      assert.ok(state.members.has(args[1]));
    } else if (sql.startsWith('SELECT * FROM members')) {
      assert.equal(args[0], guild.id);
      rows = [{ ...state.members.get(args[1]).record }];
    } else if (sql.startsWith('INSERT INTO requests')) {
      assert.match(sql, /ON CONFLICT \(guild_id,user_id,framework\) WHERE status='pending' DO UPDATE/);
      assert.match(sql, /RETURNING id/);
      const [guild_id, user_id, framework] = args;
      let request = state.requests.find(r => r.guild_id === guild_id && r.user_id === user_id
        && r.framework === framework && r.status === 'pending');
      if (!request) {
        request = { id: String(state.requests.length + 1), guild_id, user_id, framework, status: 'pending', reviewer: null };
        state.requests.push(request);
      }
      rows = [{ id: request.id }];
    } else if (sql.startsWith('SELECT id,user_id,framework FROM requests')) {
      assert.equal(sql, "SELECT id,user_id,framework FROM requests WHERE guild_id=$1 AND status='pending' AND id>$2 ORDER BY id LIMIT $3");
      assert.equal(args.length, 3);
      rows = state.requests.filter(r => r.guild_id === args[0] && r.status === 'pending' && BigInt(r.id) > BigInt(args[1]))
        .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)
        .slice(0, args[2]);
    } else if (sql === 'SELECT * FROM requests WHERE guild_id=$1 AND id=$2') {
      rows = state.requests.filter(r => r.guild_id === args[0] && r.id === args[1]);
    } else if (sql === 'SELECT * FROM requests WHERE id=$1 FOR UPDATE') {
      rows = state.requests.filter(r => r.id === args[0]);
    } else if (sql.startsWith('INSERT INTO grants')) {
      const [guild_id, user_id, framework, reviewer] = args;
      if (!state.grants.some(g => g.guild_id === guild_id && g.user_id === user_id && g.framework === framework)) {
        state.grants.push({ guild_id, user_id, framework, reviewer });
      }
    } else if (sql.startsWith('SELECT * FROM grants')) {
      rows = state.grants.filter(g => g.guild_id === args[0] && g.user_id === args[1] && g.framework === args[2]);
    } else if (sql === 'UPDATE requests SET status=$2,reviewer=$3 WHERE id=$1') {
      Object.assign(state.requests.find(r => r.id === args[0]), { status: args[1], reviewer: args[2] });
    } else {
      throw new Error(`Unexpected fake database SQL: ${sql}`);
    }
    return { rows: structuredClone(rows) };
  };
  const locked = async (key, fn) => {
    state.locks.push(key);
    const records = structuredClone(new Map([...state.members].map(([id, member]) => [id, member.record])));
    const snapshot = structuredClone({ requests: state.requests, grants: state.grants, audits: state.audits });
    let committed = false;
    return runLocked({ connect: async () => ({
      query: async (sql, args) => {
        if (sql === 'BEGIN') return {};
        if (sql === 'COMMIT') {
          trip('commit', { key });
          committed = true;
          trip('commitAfter', { key });
          return { command: 'COMMIT' };
        }
        if (sql === 'ROLLBACK') {
          if (!committed) {
            Object.assign(state, structuredClone(snapshot));
            for (const [id, record] of records) state.members.get(id).record = structuredClone(record);
          }
          trip('rollback', { key });
          state.afterRollback?.();
          return {};
        }
        return query(sql, args);
      },
      release: () => {}
    }) }, key, fn);
  };
  const inert = async () => {};
  const dependencies = {
    './discord.js': { connect: async () => ({ client, guild, cfg }) },
    './db.js': { pool: { query, end: inert }, locked, resource,
      audit: async (_db, actor, action, detail) => {
        trip('audit', { actor, action, detail });
        state.audits.push({ actor, action, detail });
      } },
    './blueprint.js': blueprint, './policy.js': policy, './onboarding.js': onboarding,
    './access-request.js': accessRequest, './review.js': review, './native-policy.js': nativePolicy,
    './access-recovery.js': recovery,
    './moderation.js': { isModerationInteraction: () => false, createModeration: () => ({
      handle: () => { throw new Error('Unexpected moderation dispatch'); }
    }) },
    './antispam.js': { createAntiSpam: async () => ({ handleMessage: inert }) },
    './native-reconcile.js': { createNativeReconciler: async () => ({
      enqueue: inert, drain: inert, scan: inert, stop: () => {}
    }) }
  };
  const context = createContext({
    console: { log: () => {}, error: (...args) => state.errors.push(args) },
    process: { on: () => {} }
  });
  const source = await readFile(new URL('../../src/bot.js', import.meta.url), 'utf8');
  const module = new SourceTextModule(source, { context, identifier: 'isolated-bot.js' });
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
  return { state, cfg, seed, dispatch, failNext };
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
