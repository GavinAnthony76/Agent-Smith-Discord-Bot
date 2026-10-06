import { PermissionFlagsBits as P } from 'discord.js';
import { rankDefinitions, rankName, titles } from './progression-config.js';
import { currentLevel } from './progression-policy.js';
import { assertNotOwner, isProtectedOwner, refreshOwnerProtection, withRoleWorkflow } from './security-policy.js';

export async function auditProgressionRoles({ guild, resource, config, readOnboarding = () => guild.fetchOnboarding() }) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const errors = [], ids = new Set();
  for (const definition of rankDefinitions) {
    try {
      const id = await resource('role', definition.name);
      ids.add(id);
      const role = guild.roles.cache.get(id);
      if (!role || role.name !== definition.name || role.managed || !role.editable || role.permissions.bitfield !== 0n) errors.push(`Unsafe rank: ${definition.name}`);
      if (guild.channels.cache.some(c => {
        const overwrite = c.permissionOverwrites.cache.get(id);
        return overwrite?.allow.bitfield > 0n || overwrite?.deny.bitfield > 0n;
      })) errors.push(`Rank changes channel permissions: ${definition.name}`);
    } catch { errors.push(`Missing tracked rank: ${definition.name}`); }
  }
  // Rank roles may never be offered as self-assignable onboarding answers.
  try {
    const onboarding = await readOnboarding();
    for (const prompt of onboarding.prompts.values()) for (const option of prompt.options.values()) {
      if ([...option.roles.keys()].some(id => ids.has(id))) errors.push('Native onboarding assigns a progression rank.');
    }
  } catch (error) { errors.push(`Cannot audit native onboarding rank assignments (${error.code ?? 'fetch failed'}).`); }
  for (const unlock of config.unlocks) {
    try {
      const role = await guild.roles.fetch(await resource('role', unlock.roleName));
      if (!role || role.managed || !role.editable || role.permissions.bitfield !== 0n) throw new Error('Unsafe unlock role');
      const parent = await resource('channel', unlock.framework.toUpperCase());
      const intended = new Set(await Promise.all(unlock.channels.map(name => resource('channel', name))));
      for (const channel of guild.channels.cache.values()) {
        const grants = channel.permissionOverwrites.cache.get(role.id)?.allow.bitfield > 0n;
        if (grants && (channel.parentId !== parent || !intended.has(channel.id))) throw new Error('Cross-framework unlock');
      }
      for (const id of intended) {
        const channel = guild.channels.cache.get(id);
        if (!channel || channel.parentId !== parent || channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) throw new Error('Unlock channel is outside its private framework');
        if (!channel.permissionOverwrites.cache.get(role.id)?.allow.has(P.ViewChannel)) throw new Error('Unlock role is not the explicit channel gate');
        for (const overwrite of channel.permissionOverwrites.cache.values()) {
          if (overwrite.type === 0 && overwrite.id !== role.id && overwrite.allow.has(P.ViewChannel)) throw new Error('Another role bypasses the rank gate');
        }
        for (const name of ['Member', 'Gaming', 'Faith', 'Tech']) {
          const base = await guild.roles.fetch(await resource('role', name));
          if (channel.permissionsFor(base)?.has(P.ViewChannel)) throw new Error('Base membership alone bypasses the rank gate');
        }
      }
    } catch { errors.push(`Unsafe or missing unlock: ${unlock.roleName}`); }
  }
  return errors;
}

export async function createProgressionWorker(context) {
  const { guild, client, pool, locked, resource, audit, approved, queueTx, pendingFaith, config } = context;
  const roles = Object.fromEntries(await Promise.all(rankDefinitions.map(async d => [d.name, await resource('role', d.name)])));
  let onboardingSnapshot, onboardingExpires = 0, onboardingRead;
  async function readOnboarding() {
    // This endpoint permits only five reads per window. Re-reading for every
    // member/framework stalls recovery. Cache ONLY native UI metadata for one
    // minute; role permissions and channel overwrites remain freshly fetched.
    if (onboardingSnapshot && Date.now() < onboardingExpires) return onboardingSnapshot;
    if (!onboardingRead) onboardingRead = guild.fetchOnboarding().then(value => {
      onboardingSnapshot = value; onboardingExpires = Date.now() + 60000; return value;
    }).finally(() => { onboardingRead = null; });
    return onboardingRead;
  }
  const roleSafety = async () => {
    const errors = await auditProgressionRoles({ guild, resource, config, readOnboarding });
    if (errors.length) throw new Error(errors.join('; '));
  };
  async function reconcile(uid, framework) {
    await refreshOwnerProtection(guild);
    if (isProtectedOwner(guild, uid)) return;
    assertNotOwner(guild, uid);
    await roleSafety();
    return withRoleWorkflow('progression-reconciliation', uid, () => locked(`${guild.id}:${uid}`, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`xp:${guild.id}:${uid}:${framework}`]);
      const { member, allowed } = await approved(db, uid, framework);
      let balance = (await db.query('SELECT * FROM progression_balances WHERE guild_id=$1 AND user_id=$2 AND framework=$3', [guild.id, uid, framework])).rows[0];
      if (allowed && !balance) balance = (await db.query(`INSERT INTO progression_balances(guild_id,user_id,framework) VALUES($1,$2,$3) RETURNING *`, [guild.id, uid, framework])).rows[0];
      const level = allowed ? currentLevel(framework, Number(balance.xp), balance.faith_approved) : 0;
      const wanted = level ? roles[rankName(framework, level)] : null;
      for (const rank of rankDefinitions.filter(d => d.framework === framework)) {
        const id = roles[rank.name];
        if (id !== wanted && member.roles.cache.has(id)) await member.roles.remove(id, 'Framework rank reconciliation; access role unchanged');
      }
      if (wanted && !member.roles.cache.has(wanted)) await member.roles.add(wanted, 'Approved framework cosmetic progression');
      for (const unlock of config.unlocks.filter(u => u.framework === framework)) {
        const id = await resource('role', unlock.roleName, db);
        if (allowed && level >= unlock.level) {
          if (!member.roles.cache.has(id)) await member.roles.add(id, 'Framework membership AND rank verified');
        } else if (member.roles.cache.has(id)) await member.roles.remove(id, 'Unlock no longer eligible');
      }
      if (!balance) return;
      if (framework === 'Faith') await pendingFaith(db, uid, balance);
      await db.query('UPDATE progression_balances SET displayed_level=$4 WHERE guild_id=$1 AND user_id=$2 AND framework=$3', [guild.id, uid, framework, level]);
      if (allowed && level > balance.announced_level && level > 1) {
        await db.query(`INSERT INTO progression_announcements(guild_id,user_id,framework,level) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [guild.id, uid, framework, level]);
        await db.query('UPDATE progression_balances SET announced_level=$4 WHERE guild_id=$1 AND user_id=$2 AND framework=$3', [guild.id, uid, framework, level]);
      }
    }));
  }
  async function announce(entry) {
    // An independently committed claim survives even a later lost COMMIT
    // acknowledgement. Keep the member lock throughout eligibility and send.
    const claimed = await pool.query("UPDATE progression_announcements SET status='sending' WHERE guild_id=$1 AND id=$2 AND status='pending' RETURNING id", [guild.id, entry.id]);
    if (!claimed.rowCount) return;
    return locked(`${guild.id}:${entry.user_id}`, async db => {
      const state = await approved(db, entry.user_id, entry.framework);
      const balance = (await db.query('SELECT * FROM progression_balances WHERE guild_id=$1 AND user_id=$2 AND framework=$3', [guild.id, entry.user_id, entry.framework])).rows[0];
      if (!state.allowed || !balance || currentLevel(entry.framework, Number(balance.xp), balance.faith_approved) < entry.level) {
        await db.query("UPDATE progression_announcements SET status='cancelled' WHERE id=$1 AND guild_id=$2", [entry.id, guild.id]);
        return;
      }
      const channel = await guild.channels.fetch(await resource('channel', `${entry.framework.toLowerCase()}-lounge`, db));
      if (channel.parentId !== await resource('channel', entry.framework.toUpperCase(), db)
        || channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) throw new Error('Promotion channel is not private to its framework.');
      try {
        const message = await channel.send({ content: `<@${entry.user_id}> reached **${rankName(entry.framework, entry.level)}**!`,
          nonce: `xp${entry.id}`, enforceNonce: true, allowedMentions: { parse: [], users: [entry.user_id] } });
        await db.query("UPDATE progression_announcements SET status='sent',message_id=$3 WHERE guild_id=$1 AND id=$2", [guild.id, entry.id, message.id]);
      } catch (error) {
        // Only definite pre-delivery rejections can be retried automatically.
        const status = [50013, 10003].includes(error.code) || error.status === 429 ? 'pending' : 'uncertain';
        await db.query(`UPDATE progression_announcements SET status=$3,attempts=attempts+1,
          next_try=now()+make_interval(secs => LEAST(3600,30*power(2,LEAST(attempts,7)))::int) WHERE guild_id=$1 AND id=$2`, [guild.id, entry.id, status]);
        await audit(db, client.user.id, 'promotion-delivery-deferred', { recipient: entry.user_id, framework: entry.framework, amount: 0, source: 'announcement', outcome: status, announcement: entry.id });
      }
    }).catch(async error => {
      // A validation/API failure before sending is also conservatively kept
      // unconfirmed, since a database commit itself may have lost its response.
      await audit(pool, client.user.id, 'promotion-delivery-unconfirmed', { recipient: entry.user_id, framework: entry.framework, source: 'announcement', amount: 0, outcome: 'unconfirmed', announcement: entry.id }).catch(() => {});
      console.error('Promotion delivery needs staff reconciliation:', error.code ?? error.message);
    });
  }
  let running = false, stopped = false, scanCursor = null;
  const enqueue = async uid => {
    for (const framework of Object.keys(titles)) await queueTx(pool, uid, framework);
  };
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      const jobs = (await pool.query('SELECT * FROM progression_jobs WHERE guild_id=$1 AND next_try<=now() ORDER BY next_try LIMIT 15', [guild.id])).rows;
      for (const job of jobs) {
        try {
          await reconcile(job.user_id, job.framework);
          await pool.query('DELETE FROM progression_jobs WHERE guild_id=$1 AND user_id=$2 AND framework=$3 AND revision=$4', [guild.id, job.user_id, job.framework, job.revision]);
        } catch (error) {
          if (error.code === 10007) await pool.query('DELETE FROM progression_jobs WHERE guild_id=$1 AND user_id=$2 AND framework=$3 AND revision=$4', [guild.id, job.user_id, job.framework, job.revision]);
          else await pool.query(`UPDATE progression_jobs SET attempts=attempts+1,next_try=now()+interval '1 minute' WHERE guild_id=$1 AND user_id=$2 AND framework=$3`, [guild.id, job.user_id, job.framework]);
          console.error('Progression reconciliation deferred:', error.message);
        }
      }
      const entries = (await pool.query("SELECT * FROM progression_announcements WHERE guild_id=$1 AND status='pending' AND next_try<=now() ORDER BY id LIMIT 5", [guild.id])).rows;
      for (const entry of entries) await announce(entry);
    } catch (error) { console.error('Progression recovery deferred:', error.message); }
    finally { running = false; }
  }
  async function scan() {
    const records = (await pool.query('SELECT user_id FROM members WHERE guild_id=$1 AND ($2::text IS NULL OR user_id>$2) ORDER BY user_id LIMIT 100', [guild.id, scanCursor])).rows;
    for (const record of records) await enqueue(record.user_id);
    scanCursor = records.length === 100 ? records.at(-1).user_id : null;
    await drain();
  }
  const timer = setInterval(() => void drain(), 15000);
  const rescan = setInterval(() => { scan().catch(() => console.error('Progression rescan deferred.')); }, 60000);
  return { enqueue, scan, drain, reconcile, roleSafety, stop() { stopped = true; clearInterval(timer); clearInterval(rescan); } };
}
