import { progressionConfig, thresholds, titles, rankName, faithDisclaimer } from './progression-config.js';
import { currentLevel, xpLevel, localDay, earnedAmount, assertAwardActor, validateUnlocks } from './progression-policy.js';
import { createProgressionWorker } from './progression-worker.js';
import { TARGET_GUILD_ID } from './config.js';

export async function createProgression({ guild, client, cfg }, dependencies) {
  if (guild.id !== TARGET_GUILD_ID) throw new Error('Progression is restricted to Hallowed Core.');
  const deps = dependencies ?? await import('./db.js');
  const { pool, locked, resource, audit } = deps;
  const config = dependencies?.config ?? progressionConfig;
  validateUnlocks(config.unlocks);
  async function approved(db, uid, framework) {
    const member = await guild.members.fetch({ user: uid, force: true });
    const record = (await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2', [guild.id, uid])).rows[0];
    const grants = (await db.query('SELECT framework FROM grants WHERE guild_id=$1 AND user_id=$2', [guild.id, uid])).rows;
    const permission = record?.accepted_at && (record.primary_framework === framework || grants.some(g => g.framework === framework));
    const allowed = permission && !member.user.bot && member.pending === false
      && member.roles.cache.has(await resource('role', framework, db))
      && member.roles.cache.has(await resource('role', 'Member', db));
    return { member, allowed: !!allowed };
  }
  const queueTx = (db, uid, framework) => db.query(`INSERT INTO progression_jobs(guild_id,user_id,framework) VALUES($1,$2,$3)
    ON CONFLICT(guild_id,user_id,framework) DO UPDATE SET revision=progression_jobs.revision+1,next_try=now()`, [guild.id, uid, framework]);
  async function pendingFaith(db, uid, balance) {
    const eligible = xpLevel(Number(balance.xp));
    if (eligible > Math.max(2, balance.faith_approved)) {
      await db.query(`INSERT INTO progression_faith_reviews(guild_id,user_id,level) VALUES($1,$2,$3)
        ON CONFLICT(guild_id,user_id,level) DO UPDATE SET status='pending' WHERE progression_faith_reviews.status='ineligible'`, [guild.id, uid, eligible]);
    }
    // A correction can invalidate a threshold without losing the review audit.
    await db.query(`UPDATE progression_faith_reviews SET status='ineligible' WHERE guild_id=$1 AND user_id=$2 AND status='pending' AND level>$3`, [guild.id, uid, eligible]);
  }
  async function earnTx(db, { uid, framework, source, key, actor, reason, correction, now = new Date() }) {
    if (!titles[framework] || !key || key.length > 180 || !reason?.trim()) throw new Error('Framework, stable event ID and reason required.');
    if (!['trivia','text'].includes(source)) assertAwardActor(cfg, actor, uid, source === 'correction');
    if(source==='text'&&actor!==cfg.clientId)throw new Error('Only the deterministic text pipeline may award text XP.');
    if (source === 'trivia' && framework !== 'Gaming') throw new Error('Trivia XP belongs to Gaming only.');
    if (source === 'trivia' && actor !== cfg.clientId) throw new Error('Only the verified trivia pipeline may award trivia XP.');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`xp:${guild.id}:${uid}:${framework}`]);
    const previous = (await db.query('SELECT * FROM progression_events WHERE guild_id=$1 AND user_id=$2 AND framework=$3 AND idempotency_key=$4', [guild.id, uid, framework, key])).rows[0];
    if (previous) {
      await audit(db, actor, 'xp-event-duplicate', { recipient: uid, framework, amount: 0, source, reason, outcome: 'duplicate', key });
      return { amount: Number(previous.amount), outcome: 'duplicate', originalOutcome: previous.outcome };
    }
    const state = await approved(db, uid, framework);
    if (!state.allowed) throw new Error('Approved, screened framework membership is required. XP cannot grant access.');
    await db.query('INSERT INTO progression_balances(guild_id,user_id,framework) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [guild.id, uid, framework]);
    let balance = (await db.query('SELECT * FROM progression_balances WHERE guild_id=$1 AND user_id=$2 AND framework=$3 FOR UPDATE', [guild.id, uid, framework])).rows[0];
    const day = localDay(now, config.timezone);
    let amount, outcome;
    if (source === 'correction') {
      if (!Number.isSafeInteger(correction) || !correction || Math.abs(correction) > 1000000
        || Number(balance.xp) + correction < 0) throw new Error('Correction must be a nonzero signed integer up to 1,000,000 without a negative balance.');
      amount = correction; outcome = 'owner_correction';
    } else {
      const totals = (await db.query(`SELECT
        COALESCE(sum(amount) FILTER(WHERE local_day=$4),0)::text AS daily,
        COALESCE(sum(amount) FILTER(WHERE local_day=$4 AND source=$5),0)::text AS source_daily,
        max(created_at) FILTER(WHERE source=$5) AS last
        FROM progression_events WHERE guild_id=$1 AND user_id=$2 AND framework=$3 AND outcome='earned'`,
      [guild.id, uid, framework, day, source])).rows[0];
      ({ amount, outcome } = earnedAmount({ source, daily: Number(totals.daily), sourceDaily: Number(totals.source_daily), last: totals.last, now, config }));
    }
    if (!Number.isSafeInteger(Number(balance.xp) + amount)) throw new Error('XP exceeds the supported range.');
    await db.query(`INSERT INTO progression_events(guild_id,user_id,framework,idempotency_key,source,actor,amount,reason,outcome,local_day,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [guild.id, uid, framework, key, source, actor, amount, reason.trim(), outcome, day, now]);
    balance = (await db.query(`UPDATE progression_balances SET xp=xp+$4,updated_at=$5 WHERE guild_id=$1 AND user_id=$2 AND framework=$3 RETURNING *`,
      [guild.id, uid, framework, amount, now])).rows[0];
    if (framework === 'Faith') await pendingFaith(db, uid, balance);
    await queueTx(db, uid, framework);
    await audit(db, actor, 'xp-event', { recipient: uid, framework, amount, source, reason, outcome, key });
    return { amount, outcome, xp: Number(balance.xp) };
  }
  const earn = event => locked(`${guild.id}:${event.uid}`, db => earnTx(db, event));
  async function faithReview({ actor, id, approve, reason }) {
    if (!/^\d{1,20}$/.test(id)) throw new Error('Invalid promotion ID.');
    const initial = (await pool.query('SELECT * FROM progression_faith_reviews WHERE guild_id=$1 AND id=$2', [guild.id, id])).rows[0];
    if (!initial) throw new Error('Promotion not found.');
    assertAwardActor(cfg, actor, initial.user_id);
    return locked(`${guild.id}:${initial.user_id}`, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`xp:${guild.id}:${initial.user_id}:Faith`]);
      const review = (await db.query('SELECT * FROM progression_faith_reviews WHERE guild_id=$1 AND id=$2 FOR UPDATE', [guild.id, id])).rows[0];
      if (review.status !== 'pending') throw new Error('Promotion already reviewed or ineligible.');
      const state = await approved(db, review.user_id, 'Faith');
      if (!state.allowed) throw new Error('Approved Faith membership required.');
      const balance = (await db.query('SELECT * FROM progression_balances WHERE guild_id=$1 AND user_id=$2 AND framework=$3 FOR UPDATE', [guild.id, review.user_id, 'Faith'])).rows[0];
      if (xpLevel(Number(balance.xp)) < review.level) throw new Error('XP threshold is not met.');
      if (!reason?.trim()) throw new Error('A review reason is required.');
      if (approve) {
        await db.query(`UPDATE progression_balances SET faith_approved=GREATEST(faith_approved,$3) WHERE guild_id=$1 AND user_id=$2 AND framework='Faith'`, [guild.id, review.user_id, review.level]);
        await db.query(`UPDATE progression_faith_reviews SET status='superseded',reviewer=$3,reviewed_at=now() WHERE guild_id=$1 AND user_id=$2 AND status='pending' AND level<$4`, [guild.id, review.user_id, actor, review.level]);
      }
      await db.query('UPDATE progression_faith_reviews SET status=$3,reviewer=$4,reason=$5,reviewed_at=now() WHERE guild_id=$1 AND id=$2', [guild.id, id, approve ? 'approved' : 'denied', actor, reason]);
      await queueTx(db, review.user_id, 'Faith');
      await audit(db, actor, 'faith-promotion-reviewed', { recipient: review.user_id, framework: 'Faith', amount: 0, source: 'faith_review', level: review.level, outcome: approve ? 'approved' : 'denied', reason });
      return `Faith promotion ${id} ${approve ? 'approved' : 'denied'}. ${faithDisclaimer}`;
    });
  }
  async function profile(uid) {
    return locked(`${guild.id}:${uid}`, async db => {
      const lines = [];
      for (const framework of Object.keys(titles)) {
        if (!(await approved(db, uid, framework)).allowed) continue;
        const balance = (await db.query('SELECT * FROM progression_balances WHERE guild_id=$1 AND user_id=$2 AND framework=$3', [guild.id, uid, framework])).rows[0] ?? { xp: 0, faith_approved: 2 };
        const xp = Number(balance.xp), level = currentLevel(framework, xp, balance.faith_approved);
        const next = thresholds[level];
        const progress = next === undefined ? 'maximum rank' : `${Math.min(100, Math.floor((xp - thresholds[level - 1]) / (next - thresholds[level - 1]) * 100))}% toward ${next.toLocaleString()} XP`;
        lines.push(`**${framework}** — ${xp.toLocaleString()} XP · ${rankName(framework, level)} (Level ${level}) · ${progress}`);
        if (framework === 'Faith') {
          const pending = (await db.query(`SELECT id,level FROM progression_faith_reviews WHERE guild_id=$1 AND user_id=$2 AND status='pending' ORDER BY level DESC`, [guild.id, uid])).rows;
          if (pending.length) lines.push(`Pending Faith approval: ${pending.map(p => `Level ${p.level} (#${p.id})`).join(', ')}. Current approved title remains unchanged.`);
        }
      }
      return lines.join('\n') || 'Complete onboarding and approved framework membership first. Retained XP never grants access.';
    });
  }
  const worker = await createProgressionWorker({ guild, client, cfg, ...deps, approved, queueTx, pendingFaith, config });
  return { ...worker, earnTx, earn, faithReview, profile };
}
