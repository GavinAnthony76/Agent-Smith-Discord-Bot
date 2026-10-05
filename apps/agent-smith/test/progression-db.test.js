import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Collection, PermissionsBitField } from 'discord.js';
import { createProgression } from '../src/progression.js';
import { createProgressionInteractions } from '../src/progression-interactions.js';
import { rankDefinitions, progressionConfig, rankName } from '../src/progression-config.js';
import { runLocked } from '../src/transaction.js';
import { config, TARGET_GUILD_ID } from '../src/config.js';
import { importLegacyBalances } from '../src/progression-legacy.js';

test('isolated PostgreSQL progression pipeline (no real Discord or live member changes)', {
  skip: !process.argv.includes('--isolated-db')
}, async t => {
  const schema = `xp_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^xp_test_[a-z0-9_]+$/);
  const application = schema;
  const raw = new pg.Pool({ connectionString: config().databaseUrl, application_name: application, max: 8 });
  let progression;
  let loseCommit = false;
  const pool = {
    async connect() {
      const client = await raw.connect();
      await client.query(`SET search_path TO "${schema}"`);
      const query = client.query.bind(client), release = client.release;
      return { async query(sql, values) {
        const result = await query(sql, values);
        if (sql === 'COMMIT' && loseCommit) { loseCommit = false; const error = new Error('Lost committed transaction acknowledgement'); error.code = '08006'; throw error; }
        return result;
      }, release: discard => release(discard) };
    },
    async query(sql, values) { const client = await pool.connect(); try { return await client.query(sql, values); } finally { client.release(); } }
  };
  const cfg = { guildId: TARGET_GUILD_ID, clientId: 'fake-bot', owners: ['fake-owner'], approvers: ['fake-reviewer', 'fake-member'] };
  const members = new Map(), adds = [], removes = [], posts = [];
  let rejectNextRole = false, loseAnnouncement = false;
  let onboardingReads = 0;
  const resources = async (kind, name) => `${kind}:${name}`;
  const roles = new Collection([...rankDefinitions.map(d => [d.name, d.name]), ...['Member', 'Gaming', 'Faith', 'Tech'].map(name => [name, name])]
    .map(([name]) => [`role:${name}`, { id: `role:${name}`, name, managed: false, editable: true, permissions: new PermissionsBitField(0n) }]));
  const channels = new Collection();
  for (const f of ['Gaming', 'Faith', 'Tech']) {
    channels.set(`channel:${f.toUpperCase()}`, { id: `channel:${f.toUpperCase()}`, permissionOverwrites: { cache: new Collection() } });
    channels.set(`channel:${f.toLowerCase()}-lounge`, {
      id: `channel:${f.toLowerCase()}-lounge`, parentId: `channel:${f.toUpperCase()}`,
      permissionOverwrites: { cache: new Collection() }, permissionsFor: () => new PermissionsBitField(0n),
      async send(payload) { posts.push(payload); if (loseAnnouncement) { loseAnnouncement = false; throw new Error('Lost acknowledgement after delivery'); } return { id: `fake-message-${posts.length}` }; }
    });
  }
  const guild = {
    id: TARGET_GUILD_ID,
    roles: { cache: roles, fetch: async id => id ? roles.get(id) : roles },
    channels: { cache: channels, fetch: async id => id ? channels.get(id) : channels },
    fetchOnboarding: async () => { onboardingReads++; return { prompts: new Collection() }; },
    members: { fetch: async ({ user }) => { assert(members.has(user), 'Only explicitly seeded fake members may be fetched.'); return members.get(user); } }
  };
  const locked = (key, fn) => runLocked(pool, key, fn);
  const audit = (db, actor, action, detail) => db.query('INSERT INTO audit(actor,action,detail) VALUES($1,$2,$3)', [actor, action, JSON.stringify(detail)]);
  const getBalance = async (uid, f) => Number((await pool.query('SELECT xp FROM progression_balances WHERE user_id=$1 AND framework=$2', [uid, f])).rows[0]?.xp ?? 0);
  async function seed(uid, primary = 'Gaming', extras = []) {
    const held = new Collection(['Member', primary, ...extras].map(name => [`role:${name}`, roles.get(`role:${name}`)]));
    const member = { user: { id: uid, bot: false }, pending: false, roles: { cache: held,
      async add(id) { if (rejectNextRole) { rejectNextRole = false; throw new Error('Injected Discord outage'); } adds.push(id); held.set(id, roles.get(id)); },
      async remove(id) { removes.push(id); held.delete(id); }
    } };
    members.set(uid, member);
    await pool.query("INSERT INTO members(guild_id,user_id,accepted_at,primary_framework,xp) VALUES($1,$2,now(),$3,0)", [guild.id, uid, primary]);
    for (const extra of extras) await pool.query('INSERT INTO grants(guild_id,user_id,framework) VALUES($1,$2,$3)', [guild.id, uid, extra]);
    return member;
  }
  const baseEvent = { uid: 'fake-member', framework: 'Gaming', source: 'helpful_answer', actor: 'fake-reviewer', reason: 'Verified helpful contribution', now: new Date('2026-10-05T16:00:00Z') };
  try {
    await raw.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE members(guild_id text,user_id text,accepted_at timestamptz,primary_framework text,xp integer,PRIMARY KEY(guild_id,user_id));
      CREATE TABLE grants(guild_id text,user_id text,framework text);
      CREATE TABLE audit(id bigserial PRIMARY KEY,actor text,action text,detail jsonb)`);
    await pool.query(await readFile(new URL('../src/progression-schema.sql', import.meta.url), 'utf8'));
    const member = await seed('fake-member', 'Gaming', ['Faith', 'Tech']);
    progression = await createProgression({ guild, client: { user: { id: cfg.clientId } }, cfg },
      { pool, locked, audit, resource: resources, config: structuredClone(progressionConfig) });
    await t.test('duplicate evidence, cooldowns, cross-source daily cap and framework isolation', async () => {
      const first = await progression.earn({ ...baseEvent, key: 'helpful:first' });
      assert.equal(first.amount, 40);
      const duplicate = await progression.earn({ ...baseEvent, key: 'helpful:first' });
      assert.equal(duplicate.outcome, 'duplicate');
      assert.equal((await progression.earn({ ...baseEvent, key: 'helpful:cooldown' })).outcome, 'cooldown');
      assert.equal((await progression.earn({ ...baseEvent, source: 'verified_event', key: 'event:first' })).amount, 50);
      assert.equal((await progression.earn({ ...baseEvent, source: 'completed_activity', key: 'activity:first' })).amount, 30);
      assert.equal((await progression.earn({ ...baseEvent, source: 'trivia', actor: cfg.clientId, key: 'trivia:first' })).amount, 10);
      assert.equal((await progression.earn({ ...baseEvent, key: 'helpful:second', now: new Date('2026-10-05T17:00:00Z') })).amount, 20);
      assert.equal((await progression.earn({ ...baseEvent, source: 'trivia', actor: cfg.clientId, key: 'trivia:cap', now: new Date('2026-10-05T17:10:00Z') })).amount, 0);
      assert.equal(await getBalance('fake-member', 'Gaming'), 150);
      assert.equal(await getBalance('fake-member', 'Faith'), 0);
      assert.equal((await progression.earn({ ...baseEvent, framework: 'Tech', key: 'helpful:first' })).amount, 40);
      assert.equal(await getBalance('fake-member', 'Tech'), 40);
    });
    await t.test('unauthorized, self, idle/bot and unapproved earnings do not change XP', async () => {
      await assert.rejects(progression.earn({ ...baseEvent, actor: 'intruder', key: 'invalid:1' }));
      await assert.rejects(progression.earn({ ...baseEvent, actor: 'fake-member', key: 'invalid:2' }));
      await assert.rejects(progression.earn({ ...baseEvent, source: 'idle_voice', key: 'invalid:3' }));
      member.user.bot = true;
      await assert.rejects(progression.earn({ ...baseEvent, key: 'invalid:4' }));
      member.user.bot = false; member.pending = true;
      await assert.rejects(progression.earn({ ...baseEvent, key: 'invalid:5' }));
      member.pending = false; member.roles.cache.delete('role:Tech');
      await assert.rejects(progression.earn({ ...baseEvent, framework: 'Tech', key: 'invalid:6' }));
      member.roles.cache.set('role:Tech', roles.get('role:Tech'));
      assert.equal(await getBalance('fake-member', 'Gaming'), 150);
    });
    await t.test('exceptional corrections are audited separately and Faith needs explicit human review', async () => {
      const beforeReads = onboardingReads;
      await progression.earn({ ...baseEvent, framework: 'Faith', source: 'correction', actor: 'fake-owner', correction: 3500, key: 'correction:faith' });
      await progression.reconcile('fake-member', 'Faith');
      assert(member.roles.cache.has(`role:${rankName('Faith', 2)}`));
      assert(!member.roles.cache.has(`role:${rankName('Faith', 3)}`));
      const review = (await pool.query("SELECT * FROM progression_faith_reviews WHERE status='pending'")).rows[0];
      await assert.rejects(progression.faithReview({ actor: 'fake-member', id: review.id, approve: true, reason: 'Cannot approve self' }));
      await assert.rejects(progression.faithReview({ actor: 'intruder', id: review.id, approve: true, reason: 'Not allowlisted' }));
      await progression.faithReview({ actor: 'fake-reviewer', id: review.id, approve: true, reason: 'Verified participation and service' });
      await progression.reconcile('fake-member', 'Faith');
      assert(member.roles.cache.has(`role:${rankName('Faith', 3)}`));
      assert(!member.roles.cache.has(`role:${rankName('Faith', 2)}`));
      await assert.rejects(progression.faithReview({ actor: 'fake-reviewer', id: review.id, approve: true, reason: 'Replay' }));
      const correction = (await pool.query("SELECT * FROM progression_events WHERE source='correction'")).rows[0];
      assert.equal(correction.outcome, 'owner_correction');
      assert.equal(Number(correction.amount), 3500);
      assert.match(await progression.profile('fake-member'), /Faith/);
      assert.equal(onboardingReads - beforeReads, 1, 'Repeated rank reconciliation shares only rate-limited native metadata.');
    });
    await t.test('role API failure recovers without duplicating XP, access grants, or announcements', async () => {
      await progression.earn({ ...baseEvent, source: 'correction', actor: 'fake-owner', correction: 1000, key: 'correction:gaming' });
      rejectNextRole = true;
      await assert.rejects(progression.reconcile('fake-member', 'Gaming'));
      await progression.reconcile('fake-member', 'Gaming');
      assert(member.roles.cache.has(`role:${rankName('Gaming', 2)}`));
      assert.equal(await getBalance('fake-member', 'Gaming'), 1150);
      const rows = (await pool.query("SELECT * FROM progression_announcements WHERE framework='Gaming'")).rows;
      assert.equal(rows.length, 1);
      // A send can succeed while its acknowledgement is lost. Never resend it.
      loseAnnouncement = true;
      await progression.drain();
      const postsAfter = posts.length;
      progression.stop();
      progression = await createProgression({ guild, client: { user: { id: cfg.clientId } }, cfg },
        { pool, locked, audit, resource: resources, config: structuredClone(progressionConfig) });
      await progression.drain();
      assert.equal(posts.length, postsAfter);
      assert((await pool.query("SELECT count(*)::int n FROM progression_announcements WHERE status IN ('sending','uncertain')")).rows[0].n > 0);
      for (const post of posts) { assert.deepEqual(post.allowedMentions.parse, []); assert.deepEqual(post.allowedMentions.users, ['fake-member']); }
    });
    await t.test('revocation removes only that framework rank and retains independent XP', async () => {
      await progression.reconcile('fake-member', 'Tech');
      const techRank = `role:${rankName('Tech', 1)}`;
      assert(member.roles.cache.has(techRank));
      member.roles.cache.delete('role:Tech');
      await pool.query("DELETE FROM grants WHERE user_id='fake-member' AND framework='Tech'");
      await progression.reconcile('fake-member', 'Tech');
      assert(!member.roles.cache.has(techRank));
      assert(member.roles.cache.has('role:Gaming'));
      assert(member.roles.cache.has(`role:${rankName('Faith', 3)}`));
      assert.equal(await getBalance('fake-member', 'Tech'), 40);
      assert(!/Tech/.test(await progression.profile('fake-member')));
    });
    await t.test('concurrent identical events wait on real PostgreSQL locks and commit once', async () => {
      await seed('fake-concurrent');
      let release, entered;
      const gate = new Promise(resolve => { release = resolve; });
      const ready = new Promise(resolve => { entered = resolve; });
      const event = { ...baseEvent, uid: 'fake-concurrent', key: 'concurrent:same' };
      const first = locked(`${guild.id}:${event.uid}`, async db => { entered(); await gate; return progression.earnTx(db, event); });
      await ready;
      const second = progression.earn(event);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = (await raw.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'", [application])).rows;
        if (rows[0].n) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      release();
      const results = await Promise.all([first, second]);
      assert(waiting, 'Second transaction must observably wait on the held advisory lock.');
      assert.deepEqual(results.map(r => r.outcome), ['earned', 'duplicate']);
      assert.equal(await getBalance('fake-concurrent', 'Gaming'), 40);
      assert.equal((await pool.query("SELECT count(*)::int n FROM progression_events WHERE user_id='fake-concurrent'")).rows[0].n, 1);
    });
    await t.test('pending Faith promotions become ineligible after corrections and can regain eligibility', async () => {
      await seed('fake-faith', 'Faith');
      const event = { ...baseEvent, uid: 'fake-faith', framework: 'Faith', source: 'correction', actor: 'fake-owner' };
      await progression.earn({ ...event, correction: 3500, key: 'faith:up' });
      await progression.earn({ ...event, correction: -3000, key: 'faith:down' });
      assert.equal((await pool.query("SELECT status FROM progression_faith_reviews WHERE user_id='fake-faith'")).rows[0].status, 'ineligible');
      await progression.earn({ ...event, correction: 3000, key: 'faith:restore' });
      assert.equal((await pool.query("SELECT status FROM progression_faith_reviews WHERE user_id='fake-faith'")).rows[0].status, 'pending');
    });
    await t.test('concurrent distinct sources cannot exceed their shared daily budget', async () => {
      await seed('fake-cap');
      const event = { ...baseEvent, uid: 'fake-cap' };
      await progression.earn({ ...event, key: 'helpful:cap-start' });
      await progression.earn({ ...event, source: 'verified_event', key: 'event:cap-start' });
      await progression.earn({ ...event, source: 'completed_activity', key: 'activity:cap-start' });
      const results = await Promise.all([
        progression.earn({ ...event, key: 'helpful:cap-overlap', now: new Date('2026-10-05T17:00:00Z') }),
        progression.earn({ ...event, source: 'trivia', actor: cfg.clientId, key: 'trivia:cap-overlap', now: new Date('2026-10-05T17:00:00Z') })
      ]);
      assert.equal(results.reduce((sum, r) => sum + r.amount, 0), 30);
      assert.equal(await getBalance('fake-cap', 'Gaming'), 150);
    });
    await t.test('legacy import preserves original balances, quarantines ambiguity and imports Gaming once', async () => {
      await seed('fake-legacy', 'Tech');
      await pool.query("UPDATE members SET xp=20 WHERE user_id='fake-legacy'");
      const unknown = await locked('legacy-test', db => importLegacyBalances(db, { guildId: guild.id, actor: cfg.clientId, verifiedGamingSource: false, audit }));
      assert.equal(unknown.ambiguous, 1);
      assert.equal(await getBalance('fake-legacy', 'Gaming'), 0);
      const known = await locked('legacy-test', db => importLegacyBalances(db, { guildId: guild.id, actor: cfg.clientId, verifiedGamingSource: true, audit }));
      assert.equal(known.imported, 1);
      const repeated = await locked('legacy-test', db => importLegacyBalances(db, { guildId: guild.id, actor: cfg.clientId, verifiedGamingSource: true, audit }));
      assert.equal(repeated.imported, 0);
      assert.equal(await getBalance('fake-legacy', 'Gaming'), 20);
      assert.equal(await getBalance('fake-legacy', 'Faith'), 0);
      assert.equal(await getBalance('fake-legacy', 'Tech'), 0);
      assert.equal((await pool.query("SELECT xp FROM members WHERE user_id='fake-legacy'")).rows[0].xp, 20);
      assert(!members.get('fake-legacy').roles.cache.has('role:Gaming'));
    });
    await t.test('control dispatcher sends private replies and rejects self/unauthorized awards with audit', async () => {
      const handle = createProgressionInteractions({ progression, guild, cfg, client: { user: { id: cfg.clientId } }, pool, resource: resources, audit });
      const replies = [];
      const interaction = { id: 'fake-interaction', user: { id: 'intruder', bot: false }, guildId: guild.id, channelId: 'channel:smith-controls',
        commandName: 'xp', isChatInputCommand: () => true, deferred: false,
        async deferReply(data) { assert.equal(data.flags, 64); this.deferred = true; },
        async editReply(data) { replies.push(data); },
        options: { getSubcommand: () => 'award', getUser: () => ({ id: 'fake-member' }),
          getString: name => ({ framework: 'Gaming', source: 'helpful_answer', reason: 'Verified helpful answer', event: 'event:fake' })[name] }
      };
      await handle(interaction);
      assert.match(replies[0].content, /Allowlisted/);
      assert.deepEqual(replies[0].allowedMentions.parse, []);
      assert.equal((await pool.query("SELECT count(*)::int n FROM audit WHERE actor='intruder' AND action='xp-control-rejected'")).rows[0].n, 1);
    });
    await t.test('lost COMMIT acknowledgement remains unconfirmed and retrying the same correction cannot duplicate XP', async () => {
      await seed('fake-commit');
      const event = { ...baseEvent, uid: 'fake-commit', source: 'correction', actor: 'fake-owner', correction: 100, key: 'correction:stable-ticket' };
      loseCommit = true;
      await assert.rejects(progression.earn(event), error => error.transactionOutcome === 'unknown');
      assert.equal(await getBalance('fake-commit', 'Gaming'), 100);
      const repeated = await progression.earn(event);
      assert.equal(repeated.outcome, 'duplicate');
      assert.equal(await getBalance('fake-commit', 'Gaming'), 100);
    });
  } finally {
    progression?.stop();
    await raw.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await raw.end();
  }
});
