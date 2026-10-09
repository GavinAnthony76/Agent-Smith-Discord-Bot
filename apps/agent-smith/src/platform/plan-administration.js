import { PlatformError, permitScope, dashboardCan } from './catalog.js';
import { platformAllowlist } from './activation.js';
import { TARGET_GUILD_ID } from '../config.js';
import { PLANS, PLAN_STATUSES } from './entitlement-policy.js';

export function canAssignPlan(authority, env) {
  const owners = new Set((env.OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean));
  return env.NODE_ENV !== 'production' && authority.guild.id !== TARGET_GUILD_ID &&
    platformAllowlist(env).has(authority.guild.id) && owners.has(authority.actor.id) &&
    dashboardCan(authority.role, 'settings', true);
}
export async function assignPlan(pool, authority, input, env) {
  permitScope(authority.permit, 'settings', true);
  if (!canAssignPlan(authority, env)) throw new PlatformError('platform_admin_required', 403);
  if (!input || Object.keys(input).some(k => !['plan', 'status', 'expiresAt', 'reason', 'revision'].includes(k)) ||
      !PLANS.includes(input.plan) || !PLAN_STATUSES.includes(input.status) ||
      !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500)
    throw new PlatformError('invalid_plan_assignment');
  const expiresAt = input.expiresAt == null ? null : new Date(input.expiresAt);
  if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw new PlatformError('invalid_plan_expiry');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const guild = await db.query('SELECT guild_id FROM platform_guilds WHERE guild_id=$1 AND installed=true FOR UPDATE', [authority.guild.id]);
    if (!guild.rows.length) throw new PlatformError('guild_access_denied', 403);
    const old = (await db.query('SELECT * FROM platform_plan_assignments WHERE guild_id=$1 FOR UPDATE', [authority.guild.id])).rows[0];
    if ((old?.revision ?? 0) !== input.revision) throw new PlatformError('plan_changed_reload', 409);
    const next = (await db.query(`INSERT INTO platform_plan_assignments(guild_id,plan,status,expires_at,metadata,assigned_by,revision)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(guild_id) DO UPDATE SET
      plan=EXCLUDED.plan,status=EXCLUDED.status,expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata,
      assigned_by=EXCLUDED.assigned_by,assigned_at=now(),updated_at=now(),revision=EXCLUDED.revision RETURNING *`,
      [authority.guild.id, input.plan, input.status, expiresAt, { reason: input.reason.trim() }, authority.actor.id, input.revision + 1])).rows[0];
    await db.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,before_state,after_state)
      VALUES($1,$2,'plan.manually_assigned','settings',$3,$4)`,
      [authority.guild.id, authority.actor.id, old ?? {}, { ...next, policyActivation: false,
        downgradePolicy: 'PRESERVE_EARNED; DISABLE_NEW_GRANTS', modulesAutoEnabled: false }]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
