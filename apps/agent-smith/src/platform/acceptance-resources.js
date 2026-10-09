import { AsyncLocalStorage } from 'node:async_hooks';
import { PermissionFlagsBits as P } from 'discord.js';
import { hasPermission } from '../permissions.js';
import { withPrivilegedPipeline } from '../privileged-pipeline.js';
import { LMOC_TEST_ID, platformAllowlist } from './activation.js';
import { PlatformError } from './catalog.js';

const scopes = new AsyncLocalStorage();
const VALIDATION_BUDGET_MS = 120000;
const DISPATCH_WINDOW_MS = 30000;

// Only an explicit Owner preparation may reclaim a proven pre-dispatch denial.
// Unknown sends, recorded intents/results, different Owners and stale proofs hold.
export async function claimPreDispatchRetry(pool, authority, kind) {
  if (authority.guild.id !== LMOC_TEST_ID || authority.role !== 'OWNER' ||
      !['role','category','panel'].includes(kind)) throw new PlatformError('lmoc_owner_only',403);
  return pool.query(`WITH claimed AS (
    UPDATE platform_records r SET
      data=jsonb_build_object('status','creating','reservedAt',now()),updated_at=now()
    WHERE r.guild_id=$1 AND r.collection='acceptance-resource' AND r.record_id=$2
      AND r.created_by=$3 AND r.data->>'status'='creating'
      AND EXISTS (SELECT 1 FROM platform_audit a WHERE a.guild_id=r.guild_id
        AND a.action='security.denied' AND a.after_state->>'status'='denied'
        AND a.after_state->>'operation'='acceptance.resource.create'
        AND a.after_state->>'source'='owner-confirmed-lmoc-test'
        AND a.after_state->>'resourceKind'=$4
        AND a.after_state->>'reason'='acceptance_resource_scope_expired'
        AND a.created_at>=COALESCE((r.data->>'reservedAt')::timestamptz,r.created_at))
      AND NOT EXISTS (SELECT 1 FROM platform_audit a WHERE a.guild_id=r.guild_id
        AND a.action IN ('security.intent','security.result')
        AND a.after_state->>'operation'='acceptance.resource.create'
        AND a.after_state->>'resourceKind'=$4
        AND a.created_at>=COALESCE((r.data->>'reservedAt')::timestamptz,r.created_at))
    RETURNING record_id
  ) INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
    SELECT $1,$3,'acceptance_pre_dispatch_retry','settings',
      jsonb_build_object('resourceKind',$4::text,'reason','verified_denial_before_discord_dispatch')
    FROM claimed RETURNING id`, [LMOC_TEST_ID,`resource-${kind}`,authority.actor.id,kind]);
}

export function executeAcceptanceResourceWrite(client, request, execute) {
  const scope = scopes.getStore();
  if (!scope) return null;
  if (scope.used || client !== scope.client || scope.guildId !== LMOC_TEST_ID ||
      request.method !== 'POST' || request.fullRoute !== scope.route ||
      JSON.stringify(request.body) !== scope.body || request.files?.length ||
      Date.now() > scope.expires) throw new PlatformError('acceptance_resource_scope_refused', 403);
  scope.used = true;
  return withPrivilegedPipeline({
    action: { operation: 'acceptance.resource.create', source: 'owner-confirmed-lmoc-test',
      guildId: scope.guildId, resourceKind: scope.kind },
    validate: async () => {
      await scope.validate();
      if (Date.now() > scope.expires || request.method !== 'POST' || request.fullRoute !== scope.route ||
          request.files?.length || JSON.stringify(request.body) !== scope.body)
        throw new PlatformError('acceptance_resource_scope_expired', 403);
      // Slow, rate-limited authority reads consume the validation budget, not
      // the freshness window for the subsequently authorized exact request.
      scope.dispatchUntil = Date.now() + DISPATCH_WINDOW_MS;
    },
    record: scope.record,
  }, async () => {
    if (Date.now() > scope.dispatchUntil) throw new PlatformError('acceptance_dispatch_window_expired',403);
    return execute();
  });
}

export function createAcceptanceResources({ client, pool, discord, env = process.env, requireActive }) {
  async function validate(authority, kind) {
    if (authority.guild.id !== LMOC_TEST_ID || authority.role !== 'OWNER' ||
        !platformAllowlist(env).has(LMOC_TEST_ID)) throw new PlatformError('lmoc_owner_only', 403);
    await requireActive(LMOC_TEST_ID);
    const fresh = await discord.authority({ guildId: LMOC_TEST_ID, userId: authority.actor.id, pool });
    if (fresh?.role !== 'OWNER' || fresh.guild.ownerId !== authority.actor.id ||
        !client.isReady() || !discord.memberRolesVerified(fresh.guild, fresh.guild.members.me) ||
        hasPermission(fresh.guild.members.me, P.Administrator) ||
        !hasPermission(fresh.guild.members.me, kind === 'role' ? P.ManageRoles : P.ManageChannels))
      throw new PlatformError('acceptance_resource_permissions_not_verified', 403);
    return fresh;
  }
  async function resource(authority, kind) {
    const fresh = await validate(authority, kind);
    const botId = fresh.guild.members.me.id;
    const read = P.ViewChannel | P.ReadMessageHistory;
    const write = read | P.SendMessages | P.EmbedLinks | P.AttachFiles;
    const body = kind === 'role' ? {
      name: 'LMOC TEST disposable cosmetic', permissions: '0', hoist: false, mentionable: false,
    } : {
      name: kind === 'category' ? 'lmoc-test-acceptance-private' : 'lmoc-test-acceptance-panel',
      type: kind === 'category' ? 4 : 0,
      permission_overwrites: [
        { id: LMOC_TEST_ID, type: 0,
          allow: kind === 'category' ? '0' : String(read | P.UseApplicationCommands),
          deny: String(kind === 'category' ? P.ViewChannel : P.SendMessages | P.CreatePublicThreads | P.CreatePrivateThreads) },
        { id: botId, type: 1, allow: String(write), deny: '0' },
        { id: fresh.actor.id, type: 1, allow: String(write), deny: '0' },
      ],
    };
    const recordId = `resource-${kind}`;
    const saved = (await pool.query(`SELECT data FROM platform_records WHERE guild_id=$1
      AND collection='acceptance-resource' AND record_id=$2`, [LMOC_TEST_ID,recordId])).rows[0];
    let recovered = false;
    if (saved) {
      if (saved.data.status !== 'confirmed') {
        const live = kind === 'role' ? fresh.guild.roles.cache : fresh.guild.channels.cache;
        if ([...live.values()].some(value => value.name === body.name))
          throw new PlatformError('acceptance_untracked_resource_requires_review',409);
        recovered = !!(await claimPreDispatchRetry(pool,authority,kind)).rowCount;
        if (!recovered) throw new PlatformError('acceptance_resource_uncertain_inspect_before_retry', 409);
      } else {
        const value = (kind === 'role' ? fresh.guild.roles.cache : fresh.guild.channels.cache).get(saved.data.id);
        if (!value || value.name !== body.name || kind === 'role' &&
          (value.managed || value.permissions.bitfield !== 0n || value.position >= fresh.guild.members.me.roles.highest.position))
          throw new PlatformError('acceptance_resource_drift_requires_review', 409);
        if (kind !== 'role' && (value.type !== body.type ||
          value.permissionOverwrites.cache.size !== body.permission_overwrites.length ||
          body.permission_overwrites.some(expected => {
            const actual = value.permissionOverwrites.cache.get(expected.id);
            return !actual || actual.allow.bitfield !== BigInt(expected.allow) ||
              actual.deny.bitfield !== BigInt(expected.deny);
          }))) throw new PlatformError('acceptance_resource_permissions_drift_requires_review', 409);
        return saved.data.id;
      }
    }
    const reserved = recovered ? {rowCount:1} : await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
      VALUES($1,'acceptance-resource',$2,$3,'{"status":"creating"}',$4) ON CONFLICT DO NOTHING RETURNING record_id`,
    [LMOC_TEST_ID,recordId,body.name,fresh.actor.id]);
    if (!reserved.rowCount) throw new PlatformError('acceptance_resource_reserved_inspect_before_retry', 409);
    const route = `/guilds/${LMOC_TEST_ID}/${kind === 'role' ? 'roles' : 'channels'}`;
    // An interrupted/unknown write stays reserved. Never automatically repeat or delete it.
    const value = await scopes.run({
      client,guildId:LMOC_TEST_ID,kind,route,body:JSON.stringify(body),used:false,
      expires:Date.now()+VALIDATION_BUDGET_MS,
      validate: () => validate(authority,kind),
      record: (action,data) => pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,$3,'settings',$4)`, [LMOC_TEST_ID,fresh.actor.id,action,data]),
    }, () => client.rest.post(route,{body}));
    if (!/^\d{17,20}$/.test(value?.id ?? '') || value.name !== body.name ||
        kind === 'role' && (BigInt(value.permissions ?? '-1') !== 0n || value.managed))
      throw new PlatformError('acceptance_created_resource_not_verified', 409);
    await pool.query(`UPDATE platform_records SET data=$3,updated_at=now()
      WHERE guild_id=$1 AND collection='acceptance-resource' AND record_id=$2`,
    [LMOC_TEST_ID,recordId,{status:'confirmed',id:value.id}]);
    return value.id;
  }
  return {
    async prepare(authority) {
      const roleId = await resource(authority,'role');
      const categoryId = await resource(authority,'category');
      const channelId = await resource(authority,'panel');
      return { roleId,categoryId,channelId };
    },
  };
}
