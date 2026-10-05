import { thresholds, titles, progressionConfig, faithDisclaimer } from './progression-config.js';
import { assertAwardActor } from './progression-policy.js';
import { verifiedEvidence } from './progression-evidence.js';

export function ranksGuide() {
  return [
    '**Framework progression — independent XP in Gaming, Faith and Tech**',
    ...Object.entries(titles).map(([framework, ladder]) => `**${framework}:** ${ladder.map((title, index) => `${index + 1}. ${title} (${thresholds[index].toLocaleString()} XP)`).join(' → ')}`),
    '**Earning:** ' + Object.entries(progressionConfig.sources).map(([source, rate]) =>
      `${source}: ${rate.amount} XP, ${rate.cooldownMs / 60000}-minute cooldown, ${rate.dailyCap} XP/source/day${rate.automatic ? '' : ' (human verified)'}`).join('; '),
    `Shared daily maximum: ${progressionConfig.dailyCap} earned XP per framework (${progressionConfig.timezone}); capped awards may be partial.`,
    'No message-volume, command, bot, repeated-message, idle-voice or outside-framework XP. Trivia earns only for a correct, consumed Gaming question, not merely running a command.',
    'At ~100 XP per active day, levels 2–7 take ~10, 35, 90, 220, 500 and 1,000 active days. Verified contributions are required; XP is not guaranteed for logging in.',
    'Faith levels 3–7 also need explicit allowlisted human approval. No self-awards or self-approval.',
    faithDisclaimer,
    'Ranks have no channel/admin permissions, never grant another framework, and are not native onboarding answers. Channel unlocks are currently disabled.',
    'Use /profile for your private approved-framework progress. Staff use /xp and /faith-review in the control room.'
  ].join('\n');
}
export function createProgressionInteractions({ progression, guild, cfg, client, pool, resource, audit }) {
  return async function handle(i) {
    if (!i.isChatInputCommand() || !['profile', 'ranks', 'xp', 'faith-review'].includes(i.commandName)) return false;
    if (i.guildId !== cfg.guildId || i.user.bot) return true;
    let attempt;
    try {
      await i.deferReply({ flags: 64 });
      let response;
      if (i.commandName === 'ranks') response = ranksGuide();
      else if (i.commandName === 'profile') response = await progression.profile(i.user.id);
      else {
        if (i.commandName === 'xp' && ['award', 'correct'].includes(i.options.getSubcommand())) {
          const correction = i.options.getSubcommand() === 'correct';
          attempt = { actor: i.user.id, recipient: i.options.getUser('user').id, framework: i.options.getString('framework'),
            source: correction ? 'correction' : i.options.getString('source'),
            amount: correction ? i.options.getInteger('amount') : progressionConfig.sources[i.options.getString('source')]?.amount ?? 0,
            reason: i.options.getString('reason') };
        }
        if (![...cfg.owners, ...cfg.approvers].includes(i.user.id)) throw new Error('Allowlisted human controls only.');
        if (![await resource('channel', 'smith-controls'), await resource('channel', 'access-review')].includes(i.channelId)) throw new Error('Use the private control room.');
        const sub = i.options.getSubcommand();
        if (i.commandName === 'xp' && ['award', 'correct'].includes(sub)) {
          const uid = i.options.getUser('user').id, framework = i.options.getString('framework');
          const correction = sub === 'correct', reason = i.options.getString('reason')?.trim();
          attempt = { actor: i.user.id, recipient: uid, framework, source: correction ? 'correction' : i.options.getString('source'), amount: correction ? i.options.getInteger('amount') : progressionConfig.sources[i.options.getString('source')]?.amount, reason };
          assertAwardActor(cfg, i.user.id, uid, correction);
          if (!reason || reason.length < 10) throw new Error('A verification/correction reason of at least 10 characters is required.');
          let evidence = i.options.getString('event')?.trim();
          if (!evidence || evidence.length < 3 || evidence.length > 100 || !/^[A-Za-z0-9:_./-]+$/.test(evidence)) throw new Error('Use a stable message/event/activity/correction identifier.');
          if (!correction && (!progressionConfig.sources[attempt.source] || progressionConfig.sources[attempt.source].automatic)) throw new Error('This source is not a human-reviewed earning source.');
          if (!correction) evidence = await verifiedEvidence({ guild, resource, framework, uid, source: attempt.source, evidence });
          const result = await progression.earn({ uid, framework, source: attempt.source,
            key: `${attempt.source}:${evidence}`, actor: i.user.id, reason,
            correction: correction ? attempt.amount : undefined });
          response = `${framework}: ${result.outcome}${result.outcome === 'duplicate' ? ' (no new XP)' : ` · ${result.amount >= 0 ? '+' : ''}${result.amount} XP`}. Human approval and framework access are unchanged.`;
        } else if (i.commandName === 'xp' && sub === 'status') {
          const counts = (await pool.query(`SELECT
            (SELECT count(*) FROM progression_jobs WHERE guild_id=$1) AS role_jobs,
            (SELECT count(*) FROM progression_announcements WHERE guild_id=$1 AND status IN ('sending','uncertain')) AS uncertain_announcements,
            (SELECT count(*) FROM progression_legacy_review WHERE guild_id=$1 AND status='ambiguous') AS ambiguous_legacy`, [guild.id])).rows[0];
          response = `Rank recovery jobs: ${counts.role_jobs}; unconfirmed announcements: ${counts.uncertain_announcements}; ambiguous legacy balances: ${counts.ambiguous_legacy}. Unconfirmed sends are not blindly retried; inspect the private database audit.`;
        } else if (i.commandName === 'faith-review' && sub === 'pending') {
          const after = i.options.getString('after') ?? '0';
          if (!/^\d{1,18}$/.test(after)) throw new Error('Invalid promotion cursor.');
          const reviews = (await pool.query("SELECT id,user_id,level FROM progression_faith_reviews WHERE guild_id=$1 AND status='pending' AND id>$2 ORDER BY id LIMIT 20", [guild.id, after])).rows;
          response = reviews.length ? reviews.map(r => `#${r.id}: member ${r.user_id}, Faith level ${r.level}`).join('\n') + `\nContinue with /faith-review pending after:${reviews.at(-1).id}.` : 'No further pending Faith promotions.';
        } else if (i.commandName === 'faith-review' && sub === 'decide') {
          const record = (await pool.query('SELECT user_id FROM progression_faith_reviews WHERE guild_id=$1 AND id=$2', [guild.id, i.options.getString('id')])).rows[0];
          attempt = { actor: i.user.id, recipient: record?.user_id ?? 'unknown', framework: 'Faith', source: 'faith_review', amount: 0, reason: i.options.getString('reason') };
          response = await progression.faithReview({ actor: i.user.id, id: i.options.getString('id'), approve: i.options.getBoolean('approve'), reason: i.options.getString('reason') });
        } else throw new Error('Unknown progression control.');
      }
      await i.editReply({ content: response.slice(0, 1950), allowedMentions: { parse: [] } });
    } catch (error) {
      const uncertain = error.transactionOutcome === 'unknown';
      if (attempt) await audit(pool, i.user.id, 'xp-control-rejected', { ...attempt, outcome: uncertain ? 'unconfirmed' : 'rejected', error: error.message }).catch(() => console.error('XP rejection audit unavailable.'));
      console.error('Progression interaction failed:', error.code ?? error.message);
      if (i.deferred || i.replied) await i.editReply({ content: (uncertain
        ? 'Storage result is unconfirmed. Inspect the durable XP/review ledger before retrying; reuse the same event ID and never repeat a correction blindly.'
        : `Unable to complete: ${error.message}`).slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
    }
    return true;
  };
}
