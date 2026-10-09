import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_CATALOG, LIMIT_KEYS } from '../src/platform/feature-catalog.js';
import { resolveAssignment, decideFeature, checkCapacity, validatePolicyLimits, entitlementMemberMessage } from '../src/platform/entitlement-policy.js';
import { createEntitlementService } from '../src/platform/entitlements.js';
import { canAssignPlan } from '../src/platform/plan-administration.js';
import { createSelfRoleService } from '../src/platform/roles.js';
import { createTicketService } from '../src/platform/tickets.js';
import { createWelcomeService } from '../src/platform/welcome.js';
import { createEconomyService } from '../src/platform/economy.js';
import { createActivityService } from '../src/platform/activity.js';
import { meterProvider } from '../src/platform/ai-usage.js';
import { TARGET_GUILD_ID } from '../src/config.js';

const guildId = '80000000000000001', other = '80000000000000002', userId = '90000000000000001';
// These are deliberately synthetic acceptance rules, NEVER marketing/production policy.
const policies = ['FREE', 'PRO', 'ULTIMATE'].flatMap(plan => [
  { plan, feature_key: 'xp', minimum_plan: 'PRO', available: true, approved: true, limits: { xp_events_monthly: 2 } },
  { plan, feature_key: 'levels', minimum_plan: 'ULTIMATE', available: true, approved: true, limits: { level_milestone_count: 2 } },
  { plan, feature_key: 'roles', minimum_plan: 'PRO', available: true, approved: true, limits: { custom_role_count: 2 } },
  { plan, feature_key: 'advanced_channels', minimum_plan: 'ULTIMATE', available: true, approved: true, limits: { channel_mapping_count: 2 } },
]);
function service(plan = 'FREE', overrides = {}) {
  const data = { legacy: { plan: 'FREE', limits: {} }, assignment: { plan, status: 'ACTIVE' },
    catalog: FEATURE_CATALOG, policies, modules: { leveling: true }, moduleRows: [] };
  return createEntitlementService({ query: async () => ({ rows: [] }) }, {
    env: { PLATFORM_ENTITLEMENT_GUILD_IDS: guildId, PLATFORM_ENTITLEMENT_POLICY_APPROVED: 'true', ...overrides },
    loadState: async () => data,
  });
}
test('catalog has no finalized minimum tiers, prices or activated unsupported adapters', () => {
  assert.ok(FEATURE_CATALOG.every(f => f.minimumPlan === null && f.downgradeBehavior.includes('PRESERVE_EARNED')));
  assert.ok(FEATURE_CATALOG.find(f => f.key === 'advanced_channels').supported === false);
  for (const key of ['module_configuration_count','xp_events_monthly','achievement_count','ai_requests_monthly','analytics_retention_days','ticket_retention_days','custom_role_count','channel_mapping_count'])
    assert.ok(LIMIT_KEYS.has(key));
});
for (const plan of ['FREE', 'PRO', 'ULTIMATE']) test(`isolated ${plan} tier resolution and higher-tier refusal`, async () => {
  const s = service(plan);
  assert.equal(await s.hasFeature(guildId, 'xp'), plan !== 'FREE');
  assert.equal(await s.hasFeature(guildId, 'levels'), plan === 'ULTIMATE');
  assert.equal(await s.canUseModule(guildId, 'leveling'), plan !== 'FREE');
  assert.equal((await s.getGuildPlan(guildId)).effectivePlan, plan);
  if (plan !== 'ULTIMATE') await assert.rejects(s.requireFeature(guildId, 'levels'), e => e.status === 403);
  else assert.equal(await s.getFeatureLimit(guildId, 'xp', 'xp_events_monthly'), 2);
});
test('approval switch, guild boundary and rule approval cannot leak fixture restrictions', async () => {
  for (const env of [{ PLATFORM_ENTITLEMENT_POLICY_APPROVED: 'false' }, { PLATFORM_ENTITLEMENT_GUILD_IDS: '' }])
    assert.equal(await service('FREE', env).hasFeature(guildId, 'xp'), true);
  assert.equal(await service().hasFeature(other, 'xp'), true);
  assert.equal(await service().hasFeature(TARGET_GUILD_ID, 'xp'), true);
  assert.equal(decideFeature({ featureKey: 'xp', plan: 'FREE', enforced: true, policies: policies.map(p => ({...p, approved:false})) }).entitled, true);
  assert.throws(() => decideFeature({ featureKey: 'constructor', plan: 'FREE', enforced: false }), /unknown_feature/);
});
test('lifecycle expiry and suspension preserve assignment but resolve reviewed capabilities as FREE', () => {
  for (const status of ['SUSPENDED', 'EXPIRED'])
    assert.equal(resolveAssignment({plan:'ULTIMATE',status}).effectivePlan, 'FREE');
  for (const status of ['ACTIVE','TRIAL','MANUAL'])
    assert.equal(resolveAssignment({plan:'PRO',status}).effectivePlan, 'PRO');
  const old = {plan:'PRO',status:'TRIAL',expires_at:'2026-01-01T00:00:00Z'};
  assert.equal(resolveAssignment(old,'FREE',Date.parse('2026-02-01')).status,'EXPIRED');
  assert.equal(old.status,'TRIAL');
  assert.throws(() => resolveAssignment({plan:'ADMIN',status:'ACTIVE'}), /invalid_entitlement_assignment/);
});
test('dependencies honor disabled configuration, unavailable parents and detect cycles', () => {
  const base = {featureKey:'levels',plan:'ULTIMATE',enforced:true,policies};
  assert.equal(decideFeature({...base,modules:{leveling:false}}).entitled,false);
  assert.equal(decideFeature({...base,policies:policies.map(p=>p.feature_key==='xp'?{...p,available:false}:p)}).entitled,false);
  const catalog=FEATURE_CATALOG.map(f=>f.key==='xp'?{...f,dependencies:['levels']}:f);
  assert.equal(decideFeature({...base,catalog,modules:{leveling:true}}).entitled,false);
  assert.equal(decideFeature({...base,modules:{}}).entitled,false);
});
test('configured limits distinguish zero, unlimited, absent, reached and over-limit', () => {
  assert.equal(checkCapacity(0,0),false);
  assert.equal(checkCapacity(-1,50000),true);
  assert.equal(checkCapacity(null,50000),true);
  assert.equal(checkCapacity(2,1),true);
  assert.equal(checkCapacity(2,2),false);
  assert.equal(checkCapacity(2,3,0),false);
  assert.throws(()=>validatePolicyLimits({role_mapping_count:-2}),/invalid_entitlement_limits/);
  assert.throws(()=>validatePolicyLimits({provider_cost:1}),/invalid_entitlement_limits/);
  assert.throws(()=>checkCapacity(2,-1),/invalid_usage/);
});
test('role and channel configuration capacity use central fixture limits', async () => {
  const s=service('PRO');
  await s.checkConfiguration(guildId,'roles',{selfAssignableRoles:['a','b']});
  await assert.rejects(s.checkConfiguration(guildId,'roles',{selfAssignableRoles:['a','b','c']}),/plan_limit_reached/);
  await assert.rejects(s.requireCapacity(guildId,'advanced_channels','channel_mapping_count',0),/feature_not_enabled/);
  await assert.rejects(service('ULTIMATE').requireCapacity(guildId,'advanced_channels','channel_mapping_count',2),/plan_limit_reached/);
});
test('basic XP does not require paid milestones; enabled saves validate projected parent state', async () => {
  const data = { legacy: { plan: 'FREE', limits: {} }, assignment: { plan: 'PRO', status: 'MANUAL' },
    catalog: FEATURE_CATALOG, policies, modules: { leveling: false }, moduleRows: [] };
  const s = createEntitlementService({}, { env: { PLATFORM_ENTITLEMENT_GUILD_IDS: guildId,
    PLATFORM_ENTITLEMENT_POLICY_APPROVED: 'true' }, loadState: async () => data });
  await s.checkConfiguration(guildId, 'leveling', { thresholds: [] });
  await assert.rejects(s.checkConfiguration(guildId, 'leveling', { thresholds: [1] }), /feature_not_enabled/);
  data.assignment.plan = 'ULTIMATE';
  await s.checkConfiguration(guildId, 'leveling', { thresholds: [1, 2] });
  await assert.rejects(s.checkConfiguration(guildId, 'leveling', { thresholds: [1, 2, 3] }), /plan_limit_reached/);
  assert.equal(data.modules.leveling, false, 'Validation never enables the saved parent module itself');
});
test('application admin, guild permission and local test scope are all required for assignment', () => {
  const authority={guild:{id:guildId},actor:{id:userId},role:'OWNER'};
  const env={NODE_ENV:'development',OWNER_IDS:userId,PLATFORM_ENABLED_GUILD_IDS:guildId};
  assert.equal(canAssignPlan(authority,env),true);
  assert.equal(canAssignPlan(authority,{...env,OWNER_IDS:''}),false);
  assert.equal(canAssignPlan(authority,{...env,NODE_ENV:'production'}),false);
  assert.equal(canAssignPlan({...authority,role:'VIEW_ONLY'},env),false);
  assert.equal(canAssignPlan({...authority,guild:{id:other}},env),false);
});
test('worker, role and channel entry points refuse before any privileged call', async () => {
  const s=service();
  let writes=0;
  await assert.rejects(s.runFeatureTask(guildId,'xp',()=>{writes++;}),/feature_not_enabled/);
  const fail=async()=>{writes++;throw new Error('privileged call should never run');};
  await assert.rejects(createSelfRoleService({entitlements:s,discord:{freshGuild:fail}})
    .assign({guildId,memberId:userId,roleId:other}),/feature_not_enabled/);
  const blocked={requireFeature:()=>s.requireFeature(guildId,'advanced_channels')};
  await assert.rejects(createTicketService({entitlements:blocked})
    .open({guildId,actorId:userId}),/feature_not_enabled/);
  assert.equal(writes,0);
});
test('worker helper cannot activate an unsupported adapter even without tier enforcement', async () => {
  const s = createEntitlementService({}, { env: {} });
  let called = false;
  await assert.rejects(s.runFeatureTask(guildId, 'advanced_channels', () => { called = true; }),
    /runtime_module_not_implemented/);
  assert.equal(called, false);
});
test('welcome worker, XP worker, economy and AI cannot bypass a denied feature', async () => {
  const denied={enforced:()=>true,requireFeature:async()=>{const e=new Error('denied');throw e;},hasFeature:async()=>false};
  const fail=async()=>{throw new Error('side effect must not run');};
  assert.deepEqual(await createWelcomeService({entitlements:denied,moduleConfig:fail})
    .join({guild:{id:guildId},user:{bot:false},joinedTimestamp:Date.now()}),{skipped:true});
  await assert.rejects(createActivityService({connect:fail},{entitlements:denied}).awardText({
    guildId,author:{id:userId,bot:false},content:'eligible meaningful text',createdTimestamp:Date.now(),
  },{textEnabled:true}),/denied/);
  await assert.rejects(createEconomyService({entitlements:denied,moduleConfig:fail})
    .change({guildId,userId,interactionId:other,kind:'daily'}),/denied/);
  await assert.rejects(meterProvider({provider:{configured:true,complete:fail},pool:{query:fail},guildId,entitlements:denied}).complete([]),/denied/);
  assert.equal(entitlementMemberMessage({code:'feature_not_enabled_for_community'}),'This feature is not enabled for this community.');
});
test('analytics and ticket retention are configurable view windows, never deletion instructions', async () => {
  const data={legacy:{plan:'FREE',limits:{}},assignment:{plan:'PRO',status:'MANUAL'},catalog:FEATURE_CATALOG,modules:{},moduleRows:[],
    policies:[{plan:'PRO',feature_key:'analytics',approved:true,available:true,limits:{analytics_retention_days:7}}]};
  const s=createEntitlementService({}, {env:{PLATFORM_ENTITLEMENT_GUILD_IDS:guildId,PLATFORM_ENTITLEMENT_POLICY_APPROVED:'true'},
    loadState:async()=>data});
  assert.equal(await s.retentionWindow(guildId,'analytics',30),7);
  assert.equal(await s.retentionWindow(guildId,'analytics',1),1);
  data.policies[0].limits.analytics_retention_days=0;
  assert.equal(await s.retentionWindow(guildId,'analytics',30),0);
});
