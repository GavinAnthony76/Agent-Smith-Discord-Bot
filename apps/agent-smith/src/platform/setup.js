import { createHash, randomUUID } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord.js';
import { MODULE_KEYS, PlatformError, permitScope } from './catalog.js';
import { TARGET_GUILD_ID } from '../config.js';
import { assertProductionGuildWritable } from './guild-lifecycle.js';
import { assertBotCapabilities, hasPermission, assertRoleChannelGrants } from '../permissions.js';
import { protectedResources } from '../protected-resources.js';
import { operationalFailure } from './diagnostics.js';

const RECORD='setup-lifecycle';
const STAGES=[
  ['bot','Bot Connected'],['permissions','Permission Check'],['preflight','Guild Preflight'],
  ['database','Database Setup'],['resources','Role/Channel Configuration'],
  ['commands','Command Verification'],['runtime','Runtime Verification'],['ready','Ready'],
];
const steps=()=>STAGES.map(([key,label])=>({key,label,status:'PENDING'}));
const previewPlan={
  willCreate:['Missing dashboard configuration records only; no Discord roles, channels, categories or forums.'],
  willReuse:['Selected existing log/welcome channels and saved compatible module configurations.'],
  willNotChange:['Owner and protected roles','Unrelated channels and guild permissions',
    'Existing XP, levels, achievements, access and consent','Hallowed Core native policy and human-reviewed crossover'],
};
function normalize(input) {
  if(!input || !Array.isArray(input.modules) || input.modules.some(key=>!MODULE_KEYS.includes(key)) ||
      input.modules.length>MODULE_KEYS.length ||
      [input.logChannelId,input.welcomeChannelId].some(id=>id!==null && !/^\d{17,20}$/.test(id??'')))
    throw new PlatformError('invalid_setup_input',400);
  return {modules:[...new Set(input.modules)].sort(),
    logChannelId:input.logChannelId,welcomeChannelId:input.welcomeChannelId};
}
const digest=(guildId,input)=>createHash('sha256').update(JSON.stringify({guildId,...input})).digest('hex');
const mark=(state,key,status,message)=>{
  const row=state.steps.find(item=>item.key===key);
  Object.assign(row,{status,...(message?{message}:{})});
};
export function createSetupService({pool,discord,env,entitlements,defaultModule,runtimeStatus}) {
  async function state(authority) {
    const scope=permitScope(authority.permit,'settings');
    if(scope.guildId!==authority.guild.id || scope.userId!==authority.actor.id)
      throw new PlatformError('guild_access_denied',403);
    const id=authority.guild.id;
    const rows=await pool.query(`SELECT r.data,r.revision,r.updated_at,g.setup_complete FROM platform_guilds g
      LEFT JOIN platform_records r ON r.guild_id=g.guild_id AND r.collection='system-setup'
        AND r.record_id=$2 WHERE g.guild_id=$1`,[id,RECORD]);
    const row=rows.rows[0];
    if(row?.data) return {...row.data,revision:row.revision,updatedAt:row.updated_at?.toISOString?.()??row.updated_at};
    return {state:row?.setup_complete?'VERIFYING':discord.client?.isReady?.()?'PREFLIGHT':'NOT_INSTALLED',
      classification:row?.setup_complete?'PARTIALLY_CONFIGURED':'READY_TO_CONFIGURE',
      revision:0,steps:steps(),retrySafe:true,preview:previewPlan,updatedAt:null};
  }
  async function preflight(authority,input) {
    permitScope(authority.permit,'settings',true);
    assertProductionGuildWritable(authority.guild.id);
    if(authority.role!=='OWNER' || permitScope(authority.permit,'settings',true).role!=='OWNER')
      throw new PlatformError('owner_required',403);
    const config=normalize(input);
    const result=await state(authority);
    result.steps=steps();
    result.preview=previewPlan;
    result.state='PREFLIGHT';
    result.previewHash=digest(authority.guild.id,config);
    let stage='bot';
    try {
      const {guild,actor}=authority;
      const bot=guild.members?.me;
      if(!discord.client?.isReady?.() || !bot) throw new PlatformError('bot_not_connected',503);
      mark(result,stage,'HEALTHY','Existing Gateway; no additional bot session.');
      stage='permissions';
      if(!hasPermission(bot,P.ManageRoles) || !bot.roles?.highest ||
          (guild.ownerId!==actor.id && !hasPermission(actor,P.ManageGuild)) ||
          guild.ownerId===bot.id || !discord.memberRolesVerified(guild,bot) ||
          !discord.memberRolesVerified(guild,actor))
        throw new PlatformError('setup_permissions_not_verified',422);
      try {assertBotCapabilities(bot);}
      catch {throw new PlatformError('bot_permission_policy_requires_owner_review',422);}
      const owner=actor.id===guild.ownerId?actor:await guild.members.fetch({user:guild.ownerId,force:true});
      if(!owner.roles?.highest || bot.roles.highest.comparePositionTo(owner.roles.highest)>=0)
        throw new PlatformError('bot_must_remain_below_owner',422);
      mark(result,stage,'HEALTHY','Bot remains below Owner; no permission changes.');
      stage='preflight';
      const resources=(await pool.query('SELECT kind,name,discord_id FROM resources WHERE guild_id=$1',[guild.id])).rows;
      if(guild.id===TARGET_GUILD_ID &&
          ['Member','Faith','Gaming','Tech'].some(name=>!resources.some(row=>row.kind==='role' && row.name===name)))
        throw new PlatformError('native_access_configuration_missing',422);
      const registry=protectedResources({guild,bot,owner,rows:resources});
      if(!registry.size) throw new PlatformError('protected_resources_unverified',422);
      for(const id of [config.logChannelId,config.welcomeChannelId].filter(Boolean)) {
        const channel=guild.channels.cache.get(id);
        if(!channel || channel.isThread?.() || !hasPermission(actor,P.ViewChannel,channel) ||
            !hasPermission(bot,P.ViewChannel,channel))
          throw new PlatformError('selected_channel_not_verified',422);
      }
      // Native grants retain the same parent-aware access-role checks as onboarding.
      if(guild.id===TARGET_GUILD_ID) for(const item of resources.filter(r=>r.kind==='role' &&
          ['Member','Faith','Gaming','Tech'].includes(r.name))) {
        const role=guild.roles.cache.get(item.discord_id);
        if(!role || role.managed || role.position>=bot.roles.highest.position)
          throw new PlatformError('native_access_role_not_verified',422);
        try {assertRoleChannelGrants(role,guild);}
        catch {throw new PlatformError('native_access_policy_requires_owner_review',422);}
      }
      mark(result,stage,'HEALTHY','Protected resources recognized; selected channels verified.');
      stage='database';
      await pool.query('SELECT 1 FROM platform_guilds LIMIT 1');
      await pool.query('SELECT 1 FROM platform_modules LIMIT 1');
      await pool.query('SELECT 1 FROM platform_records LIMIT 1');
      for(const key of config.modules) await entitlements.requireModule(guild.id,key);
      mark(result,stage,'HEALTHY','Database and required module configuration schema reachable.');
      stage='resources';
      mark(result,stage,'HEALTHY','Reuse only; no Discord resource creation requested.');
      stage='commands';
      const commands=await discord.client.rest.get(`/applications/${env.DISCORD_CLIENT_ID??discord.client.user.id}/guilds/${guild.id}/commands`);
      const required=guild.id===TARGET_GUILD_ID?['accept','join']:['smith','smith-community'];
      if(!Array.isArray(commands) || !required.every(name=>commands.some(c=>c.name===name)))
        throw new PlatformError('commands_require_owner_review',422);
      mark(result,stage,'HEALTHY','Existing command names verified; no command registration performed.');
      stage='runtime';
      const runtime=await runtimeStatus?.(guild.id);
      if(runtime?.botConnected!==true || guild.id!==TARGET_GUILD_ID && !runtime?.runtimeActive)
        throw new PlatformError('runtime_not_verified',503);
      mark(result,stage,'HEALTHY','Existing production Gateway is connected.');
      result.classification=result.classification==='ALREADY_CONFIGURED'?'ALREADY_CONFIGURED':'READY_TO_CONFIGURE';
      result.retrySafe=true;
    } catch(error) {
      const failure=operationalFailure(error,{guildId:authority.guild.id,operation:'setup',stage});
      result.state='DEGRADED'; result.classification='BLOCKED';result.retrySafe=false;
      result.failureStatus=failure.status;
      result.referenceId=failure.body.referenceId;
      mark(result,stage,'BLOCKED',`${failure.body.message} Reference: ${failure.body.referenceId}`);
    }
    return result;
  }
  async function run(authority,input) {
    const checked=await preflight(authority,input);
    if(checked.classification==='BLOCKED') throw new PlatformError('setup_preflight_blocked',checked.failureStatus??422);
    if(input.confirmed!==true || input.previewHash!==checked.previewHash)
      throw new PlatformError('setup_confirmation_required',422);
    if(!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<0)
      throw new PlatformError('setup_revision_required',400);
    const config=normalize(input),guildId=authority.guild.id;
    const attemptId=randomUUID();
    let journalRevision;
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`platform-setup:${guildId}`]);
      let old=(await db.query(`SELECT data,revision FROM platform_records WHERE guild_id=$1
        AND collection='system-setup' AND record_id=$2 FOR UPDATE`,[guildId,RECORD])).rows[0];
      if(old?.data.state==='READY' && old.data.previewHash===checked.previewHash) {
        await db.query('COMMIT');
        return {ok:true,message:'Already configured. Existing settings and resources were preserved.'};
      }
      if((old?.revision??0)!==input.expectedRevision ||
          old?.data.state==='CONFIGURING' && Date.parse(old.data.leaseUntil)>Date.now())
        throw new PlatformError('setup_changed_or_in_progress',409);
      // Explicit Owner setup, not a side-effect of viewing a dashboard.
      await db.query(`INSERT INTO platform_guilds(guild_id,policy_key,settings,setup_complete)
        VALUES($1,$2,$3,false) ON CONFLICT DO NOTHING`,
      [guildId,guildId===TARGET_GUILD_ID?'hallowed-core':'standard',{name:authority.guild.name}]);
      journalRevision=(old?.revision??0)+1;
      const data={...checked,state:'CONFIGURING',classification:'PARTIALLY_CONFIGURED',retrySafe:true,
        attemptId,leaseUntil:new Date(Date.now()+60000).toISOString()};
      await db.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,revision,created_by)
        VALUES($1,'system-setup',$2,'Owner-confirmed setup lifecycle',$3,$4,$5)
        ON CONFLICT(guild_id,collection,record_id) DO UPDATE SET data=EXCLUDED.data,
          revision=EXCLUDED.revision,updated_at=now()`,[guildId,RECORD,data,journalRevision,authority.actor.id]);
      await db.query('COMMIT');
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`platform-setup:${guildId}`]);
      old=(await db.query(`SELECT data FROM platform_records WHERE guild_id=$1
        AND collection='system-setup' AND record_id=$2 FOR UPDATE`,[guildId,RECORD])).rows[0];
      if(old?.data.attemptId!==attemptId) throw new PlatformError('setup_changed_or_in_progress',409);
      if(entitlements.enforced(guildId)) {
        const existing=(await db.query('SELECT module_key,enabled FROM platform_modules WHERE guild_id=$1',[guildId])).rows;
        const additions=config.modules.filter(key=>!existing.some(row=>row.module_key===key)).length;
        if(additions) await entitlements.requireCapacity(guildId,'configuration','module_configuration_count',
          existing.filter(row=>row.enabled).length,additions,db);
      }
      await db.query(`INSERT INTO platform_entitlements(guild_id) VALUES($1) ON CONFLICT DO NOTHING`,[guildId]);
      for(const key of MODULE_KEYS) {
        const defaults=defaultModule(key,guildId===TARGET_GUILD_ID,env);
        await db.query(`INSERT INTO platform_modules(guild_id,module_key,enabled,configuration_json,updated_by)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(guild_id,module_key) DO NOTHING`,
        [guildId,key,config.modules.includes(key),defaults.configuration,authority.actor.id]);
      }
      await db.query(`UPDATE platform_guilds SET setup_complete=true,
        settings=jsonb_strip_nulls($2::jsonb)||jsonb_strip_nulls(settings),updated_at=now() WHERE guild_id=$1`,[guildId,{
          logChannelId:config.logChannelId,welcomeChannelId:config.welcomeChannelId}]);
      const ready={...checked,state:'READY',classification:'ALREADY_CONFIGURED',retrySafe:true};
      ready.steps=ready.steps.map(step=>({...step,status:'COMPLETE'}));
      await db.query(`UPDATE platform_records SET data=$3,revision=revision+1,updated_at=now()
        WHERE guild_id=$1 AND collection='system-setup' AND record_id=$2`,[guildId,RECORD,ready]);
      await db.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,'setup_completed','settings',$3)`,[guildId,authority.actor.id,{
          attemptId,previewHash:checked.previewHash,modules:config.modules,discordWrites:0}]);
      await db.query('COMMIT');
      return {ok:true,message:'Setup verified and saved. Existing resources, access and member data were preserved.'};
    } catch(error) {
      await db.query('ROLLBACK').catch(()=>{});
      const failure=operationalFailure(error,{guildId,operation:'setup',stage:'configuration'});
      // A lost commit acknowledgement must never overwrite a committed READY.
      await pool.query(`UPDATE platform_records SET data=data||$3::jsonb,revision=revision+1,updated_at=now()
        WHERE guild_id=$1 AND collection='system-setup' AND record_id=$2
          AND data->>'attemptId'=$4 AND data->>'state'='CONFIGURING'`,[guildId,RECORD,{
            state:'DEGRADED',classification:'PARTIALLY_CONFIGURED',retrySafe:true,
            referenceId:failure.body.referenceId,
            steps:checked.steps.map(step=>step.key==='database'?{...step,status:'BLOCKED',
              message:'Configuration was not confirmed. Refresh state before resuming.'}:step),
          },attemptId]).catch(()=>{});
      throw error;
    } finally {db.release();}
  }
  return {state,preflight,run};
}
