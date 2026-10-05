import { thresholds, titles, progressionConfig } from './progression-config.js';

export function xpLevel(xp) {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new Error('Invalid XP balance.');
  return thresholds.reduce((level, threshold, index) => xp >= threshold ? index + 1 : level, 1);
}
export function currentLevel(framework, xp, approved = 2) {
  if (!titles[framework]) throw new Error('Unknown framework.');
  const eligible = xpLevel(xp);
  return framework === 'Faith' ? Math.min(eligible, Math.max(2, approved)) : eligible;
}
export function localDay(date, timezone = progressionConfig.timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function earnedAmount({ source, daily = 0, sourceDaily = 0, last, now, config = progressionConfig }) {
  const rate = config.sources[source];
  if (!rate) throw new Error('Unknown earning source.');
  if (last && now.getTime() - new Date(last).getTime() < rate.cooldownMs) return { amount: 0, outcome: 'cooldown' };
  const amount = Math.max(0, Math.min(rate.amount, config.dailyCap - daily, rate.dailyCap - sourceDaily));
  return { amount, outcome: amount ? 'earned' : 'daily_limit' };
}
export function assertAwardActor(cfg, actor, recipient, correction = false) {
  if (!(correction ? cfg.owners : [...cfg.owners, ...cfg.approvers]).includes(actor)) throw new Error(correction ? 'Owner corrections only.' : 'Allowlisted humans only.');
  if (actor === recipient) throw new Error('You cannot award yourself XP or approve your own promotion.');
}
export function validateUnlocks(unlocks) {
  const roles = new Set();
  for (const unlock of unlocks) {
    if (!titles[unlock.framework] || !Number.isInteger(unlock.level) || unlock.level < 1 || unlock.level > 7
      || !unlock.roleName?.startsWith(`${unlock.framework} • Unlock: `)
      || !Array.isArray(unlock.channels) || !unlock.channels.length || roles.has(unlock.roleName)) {
      throw new Error('Unsafe unlock configuration: framework-specific role, rank and existing channels required.');
    }
    roles.add(unlock.roleName);
  }
}
export function legacyDecision(balance, verifiedGamingSource = false) {
  if (balance === 0) return 'empty';
  return verifiedGamingSource && Number.isSafeInteger(balance) && balance > 0 ? 'Gaming' : 'ambiguous';
}
