import { frameworks } from './blueprint.js';

// Selection roles are signals, never access roles. The durable primary wins.
export function nativeDecision({ pending, bot, selections, record, held = [], grants = [] }) {
  if (bot) return { status: 'ignore' };
  if (pending !== false) return { status: 'waiting-screening' };
  if (selections.length > 1) return { status: 'blocked', reason: 'multiple-selections' };
  if (selections.length === 1 && !frameworks.includes(selections[0])) return { status: 'blocked', reason: 'invalid-selection' };
  const primary = record?.primary_framework;
  if (primary && (!frameworks.includes(primary) || !record.accepted_at)) {
    return { status: 'blocked', reason: 'incomplete-record' };
  }
  // A later Selection cannot establish the provenance of an older access role.
  // Preserve it for Owner review, including when there is no Selection yet.
  // Committed native intent still authorizes recovery after a partial role write.
  if (held.some(f => !record?.accepted_at || (f !== primary && !grants.includes(f)))) {
    return { status: 'blocked', reason: 'unrecorded-access' };
  }
  if (selections.length !== 1) return { status: 'waiting-selection' };
  const candidate = primary ?? selections[0];
  return { status: primary ? 'ready' : 'initialize', primary: candidate };
}

// Both phases use the SAME lock as /accept, /join, human review and revoke.
// Phase one's database commit MUST finish before any Discord access grant.
// Retrying phase two restores only the recorded primary, never the new answer.
export async function reconcileNative(transact) {
  const intent = await transact(async ctx => {
    const decision = nativeDecision(ctx.snapshot);
    if (decision.status === 'blocked') await ctx.alert(decision.reason);
    if (decision.status === 'initialize') await ctx.reserve(decision.primary);
    return decision;
  });
  if (!['initialize', 'ready'].includes(intent.status)) return intent;
  return transact(async ctx => {
    const decision = nativeDecision(ctx.snapshot);
    if (decision.status === 'blocked') await ctx.alert(decision.reason);
    if (decision.status !== 'ready') return decision;
    const added = [];
    for (const name of ['Member', decision.primary]) {
      if (await ctx.add(name)) added.push(name);
    }
    if (added.length) await ctx.recordGrant(added);
    return { ...decision, added };
  });
}

export function legacyAllowed(state) {
  return state?.legacy_enabled !== false;
}

// Discord can accept a saved configuration below its documented defaults.
// Live publication takes precedence; never broaden privacy to meet stale counts.
export function nativeDefaultChannelErrors(onboarding, defaults, writable) {
  if (onboarding?.enabled || onboarding?.mode !== 0 || (defaults >= 7 && writable >= 5)) return [];
  return [`Discord documents 7 default channels, including 5 everyone-viewable/writable; currently ${defaults} defaults and ${writable} writable. Check actual UI publication validation; do not broaden private channels.`];
}

export function nativeQuestionErrors(onboarding, roles, cosmeticRoleIds = []) {
  const errors = [];
  if (!onboarding?.enabled) errors.push('Native onboarding is not published/enabled.');
  const prompts = onboarding?.prompts ?? [];
  const candidates = prompts.filter(p => p.options?.some(o => o.role_ids?.some(id => Object.values(roles).includes(id))));
  if (candidates.length !== 1) errors.push('Exactly one selection-role question is required.');
  const question = candidates[0];
  if (question) {
    if (!question.required || !question.single_select || !question.in_onboarding) errors.push('Selection question must be required, single-choice, and asked before joining.');
    if (question.options.length !== 3) errors.push('Selection question must have exactly three answers.');
    for (const f of frameworks) {
      const matches = question.options.filter(o => o.title === f);
      if (matches.length !== 1 || matches[0].role_ids?.length !== 1 || matches[0].role_ids[0] !== roles[f] || matches[0].channel_ids?.length) {
        errors.push(`${f} must map only to its Selection role, with no channel mappings.`);
      }
    }
  }
  // Optional tracked, audited cosmetic interests are allowed; access and rank
  // roles are never accepted. Channel privacy is checked separately.
  const selections = new Set(Object.values(roles)), cosmetics = new Set(cosmeticRoleIds);
  for (const p of prompts) for (const o of p.options ?? []) {
    const assigned = o.role_ids ?? [];
    if (assigned.some(id => !selections.has(id) && !cosmetics.has(id))) errors.push('A native answer maps a non-selection/non-cosmetic role.');
    if (p !== question && assigned.some(id => selections.has(id))) errors.push('Selection roles must appear only in the required question.');
    if (assigned.some(id => cosmetics.has(id))) {
      if (p === question || p.required !== false) errors.push('Cosmetic interests must appear only in optional questions.');
      if ((o.channel_ids ?? []).length) errors.push('Cosmetic interest answers must not map channels.');
    }
  }
  return [...new Set(errors)];
}