import { legacyDecision, localDay } from './progression-policy.js';

export async function importLegacyBalances(db, { guildId, actor, verifiedGamingSource, audit, apply = true }) {
  const rows = (await db.query('SELECT user_id,xp FROM members WHERE guild_id=$1 AND xp<>0 FOR UPDATE', [guildId])).rows;
  const report = { nonzeroLegacyBalances: rows.length, knownGaming: rows.filter(r => legacyDecision(r.xp, verifiedGamingSource) === 'Gaming').length,
    ambiguous: rows.filter(r => legacyDecision(r.xp, verifiedGamingSource) === 'ambiguous').length, imported: 0, legacyBalancesUnchanged: true, applied: apply };
  if (!apply) return report;
  for (const row of rows) {
    if (legacyDecision(row.xp, verifiedGamingSource) === 'ambiguous') {
      await db.query('INSERT INTO progression_legacy_review(guild_id,user_id,legacy_xp,reason) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [guildId, row.user_id, row.xp, 'Legacy source unverified; preserved without attribution. Human reconciliation required.']);
      continue;
    }
    const inserted = await db.query(`INSERT INTO progression_events(guild_id,user_id,framework,idempotency_key,source,actor,amount,reason,outcome,local_day)
      VALUES($1,$2,'Gaming','legacy-gaming-v1','legacy_migration',$3,$4,$5,'migrated',$6) ON CONFLICT DO NOTHING RETURNING id`,
    [guildId, row.user_id, actor, row.xp, 'Explicitly verified legacy Gaming/trivia balance', localDay(new Date())]);
    if (inserted.rowCount) {
      await db.query(`INSERT INTO progression_balances(guild_id,user_id,framework,xp) VALUES($1,$2,'Gaming',$3)
        ON CONFLICT(guild_id,user_id,framework) DO UPDATE SET xp=progression_balances.xp+EXCLUDED.xp`,
      [guildId, row.user_id, row.xp]);
      await audit(db, actor, 'xp-legacy-migrated', { recipient: row.user_id, framework: 'Gaming', amount: row.xp, source: 'legacy_migration', outcome: 'migrated' });
      report.imported++;
    }
    await db.query("UPDATE progression_legacy_review SET status='resolved-gaming',resolved_at=now() WHERE guild_id=$1 AND user_id=$2 AND status='ambiguous'", [guildId, row.user_id]);
  }
  return report;
}
