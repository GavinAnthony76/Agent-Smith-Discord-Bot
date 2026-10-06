import { createHash } from 'node:crypto';
import { frameworks } from './blueprint.js';
import { TARGET_GUILD_ID } from './config.js';
import { assertAssignableRole } from './policy.js';
import { assertNotOwner, isProtectedOwner, refreshOwnerProtection, withRoleWorkflow } from './security-policy.js';
import { nativeDecision, reconcileNative } from './native-policy.js';

export async function createNativeReconciler({ guild, client }, dependencies) {
  if (guild.id !== TARGET_GUILD_ID) throw new Error('Native reconciliation is restricted to Hallowed Core.');
  const { pool, locked, resource, audit } = dependencies ?? await import('./db.js');
  const ids = Object.fromEntries(await Promise.all(
    ['Member', ...frameworks, ...frameworks.map(f => `Selection: ${f}`)]
      .map(async name => [name, await resource('role', name)])));
  async function snapshot(db, uid) {
    const member = await guild.members.fetch({ user: uid, force: true });
    const record = (await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2 FOR UPDATE', [guild.id, uid])).rows[0];
    const grants = (await db.query('SELECT framework FROM grants WHERE guild_id=$1 AND user_id=$2', [guild.id, uid])).rows.map(r => r.framework);
    return { member, record, grants, pending: member.pending, bot: member.user.bot,
      held: frameworks.filter(f => member.roles.cache.has(ids[f])),
      selections: frameworks.filter(f => member.roles.cache.has(ids[`Selection: ${f}`])) };
  }
  async function alert(db, uid, reason, state) {
    const detail = { selections: state.selections, primary: state.record?.primary_framework ?? null, held: state.held };
    const fingerprint = createHash('sha256').update(JSON.stringify({ reason, ...detail })).digest('hex');
    const result = await db.query('INSERT INTO native_alerts(guild_id,user_id,fingerprint,reason,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',
      [guild.id, uid, fingerprint, reason, JSON.stringify(detail)]);
    if (result.rowCount) await audit(db, client.user.id, 'native-onboarding-blocked', { subject: uid, reason, ...detail });
  }
  async function selectionSafety() {
    await guild.roles.fetch();
    await guild.channels.fetch();
    for (const f of frameworks) {
      const role = assertAssignableRole(guild.roles.cache.get(ids[`Selection: ${f}`]));
      if (role.managed || role.name !== `Selection: ${f}` || role.permissions.bitfield !== 0n
        || guild.channels.cache.some(c => c.permissionOverwrites.cache.get(role.id)?.allow.bitfield > 0n)) {
        throw new Error('Selection role safety drift; no automatic access granted.');
      }
    }
  }
  async function reconcile(uid) {
    await refreshOwnerProtection(guild);
    if (isProtectedOwner(guild, uid)) return { status: 'owner-immune' };
    assertNotOwner(guild, uid);
    await selectionSafety();
    return withRoleWorkflow('native-reconciliation', uid, () => reconcileNative(fn => locked(`${guild.id}:${uid}`, async db => {
      const state = await snapshot(db, uid);
      return fn({
        snapshot: state,
        alert: reason => alert(db, uid, reason, state),
        reserve: async primary => {
          await db.query('INSERT INTO members(guild_id,user_id,accepted_at,primary_framework) VALUES($1,$2,now(),$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET accepted_at=COALESCE(members.accepted_at,now()),primary_framework=$3 WHERE members.primary_framework IS NULL',
            [guild.id, uid, primary]);
          await audit(db, client.user.id, 'native-primary-recorded', { subject: uid, framework: primary, source: 'native-selection-after-screening' });
        },
        add: async name => {
          // Re-fetch before EACH write: never use an event's stale role snapshot.
          const fresh = await snapshot(db, uid);
          const decision = nativeDecision(fresh);
          if (decision.status !== 'ready' || decision.primary !== state.record?.primary_framework) {
            throw new Error('Member changed during reconciliation; retry from fresh state.');
          }
          if (fresh.member.roles.cache.has(ids[name])) return false;
          const role = assertAssignableRole(await guild.roles.fetch(ids[name]));
          await fresh.member.roles.add(role, 'Native onboarding: durable recorded primary only');
          return true;
        },
        recordGrant: added => audit(db, client.user.id, 'native-primary-reconciled', { subject: uid, framework: state.record.primary_framework, added })
      });
    })));
  }
  const enqueue = uid => pool.query(`INSERT INTO native_jobs(guild_id,user_id) VALUES($1,$2)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET revision=native_jobs.revision+1,next_try=now()`, [guild.id, uid]);
  let running = false, stopped = false;
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      const jobs = (await pool.query('SELECT * FROM native_jobs WHERE guild_id=$1 AND next_try<=now() ORDER BY next_try LIMIT 25', [guild.id])).rows;
      for (const job of jobs) {
        try {
          await reconcile(job.user_id);
          // A gateway event arriving during processing increments the revision.
          // Never erase that new work with this older worker's completion.
          await pool.query('DELETE FROM native_jobs WHERE guild_id=$1 AND user_id=$2 AND revision=$3', [guild.id, job.user_id, job.revision]);
        } catch (error) {
          if (error.code === 10007) {
            await pool.query('DELETE FROM native_jobs WHERE guild_id=$1 AND user_id=$2 AND revision=$3', [guild.id, job.user_id, job.revision]);
          } else {
            await pool.query("UPDATE native_jobs SET attempts=attempts+1,next_try=now()+($4 * interval '1 second') WHERE guild_id=$1 AND user_id=$2 AND revision=$3",
              [guild.id, job.user_id, job.revision, Math.min(300, 15 * 2 ** Math.min(job.attempts, 5))]);
            console.error('Native reconciliation deferred; durable retry queued.');
          }
        }
      }
      const alerts = (await pool.query('SELECT * FROM native_alerts WHERE guild_id=$1 AND delivered_at IS NULL ORDER BY id LIMIT 25', [guild.id])).rows;
      for (const entry of alerts) {
        try {
          const channel = await guild.channels.fetch(await resource('channel', 'access-review'));
          await channel.send({ content: `Native onboarding BLOCKED for member ${entry.user_id}: ${entry.reason}. ${JSON.stringify(entry.detail)}. No new access granted. Human review required.`,
            nonce: `n${entry.fingerprint.slice(0, 24)}`, enforceNonce: true, allowedMentions: { parse: [] } });
          await pool.query('UPDATE native_alerts SET delivered_at=now() WHERE guild_id=$1 AND id=$2', [guild.id, entry.id]);
        } catch { console.error('Native staff alert delivery deferred; durable alert retained.'); }
      }
    } catch { console.error('Native queue unavailable; next recovery pass will retry.'); }
    finally { running = false; }
  }
  async function scan() {
    const members = await guild.members.fetch();
    for (const member of members.values()) if (!member.user.bot) await enqueue(member.id);
    await drain();
  }
  const retryTimer = setInterval(() => { void drain(); }, 15000);
  // Periodic rescan also recovers missed/disconnected gateway events and a
  // transient startup scan failure. No roles are removed by this service.
  const scanTimer = setInterval(() => { scan().catch(() => console.error('Native rescan deferred.')); }, 300000);
  return { enqueue, scan, drain, reconcile, stop() { stopped = true; clearInterval(retryTimer); clearInterval(scanTimer); } };
}