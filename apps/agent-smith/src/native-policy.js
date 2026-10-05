import { frameworks } from './blueprint.js';

// Selection roles are signals, never access roles. The durable primary wins.
export function nativeDecision({ pending, bot, selections, record, held = [], grants = [] }) {
  if (bot) return { status: 'ignore' };
  if (pending !== false) return { status: 'waiting-screening' };
  if (selections.length > 1) return { status: 'blocked', reason: 'multiple-selections' };
  if (selections.length !== 1) return { status: 'waiting-selection' };
  if (!frameworks.includes(selections[0])) return { status: 'blocked', reason: 'invalid-selection' };
  const primary = record?.primary_framework;
  if (primary && (!frameworks.includes(primary) || !record.accepted_at)) {
    return { status: 'blocked', reason: 'incomplete-record' };
  }
  // An existing held role matching the first explicit native choice is safe
  // to initialize as primary. Any OTHER unexplained held framework blocks
  // expansion; never silently turn it into a human-approved extra grant.
  const candidate = primary ?? selections[0];
  if (held.some(f => f !== candidate && !grants.includes(f))) {
    return { status: 'blocked', reason: 'unrecorded-access' };
  }
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

export function nativeQuestionErrors(onboarding, roles) {
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
  // Do not allow another question to accidentally map Member/framework/interest
  // roles. Other optional answers may be channel-only; gated IDs are checked
  // separately against the permission blueprint before cutover.
  for (const p of prompts) for (const o of p.options ?? []) {
    if ((o.role_ids ?? []).some(id => !Object.values(roles).includes(id))) errors.push('A native answer maps a non-selection role.');
    if (p !== question && (o.role_ids ?? []).length) errors.push('Selection roles must appear only in the required question.');
  }
  return [...new Set(errors)];
}