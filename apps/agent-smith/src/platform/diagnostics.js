import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PlatformError } from './catalog.js';

const requests = new AsyncLocalStorage();
const recent = [];
export const diagnosticScope = (value, fn) => requests.run(value, fn);
export const diagnosticContext = () => requests.getStore();
export async function measureDependency(name, fn) {
  const start=performance.now();
  try { return await fn(); }
  finally {
    const context=requests.getStore();
    if(context) {
      context.timings ??={};
      context.timings[name]=(context.timings[name]??0)+performance.now()-start;
      context.calls ??={};
      context.calls[name]=(context.calls[name]??0)+1;
    }
  }
}
export function timedPool(pool) {
  const wrap = db => new Proxy(db,{
    get(target,key) {
      if(key==='query') return (...args)=>measureDependency('database',()=>target.query(...args));
      if(key==='connect') return async()=>wrap(await measureDependency('database',()=>target.connect()));
      const value=Reflect.get(target,key);
      return typeof value==='function'?value.bind(target):value;
    },
  });
  return wrap(pool);
}
export async function atStage(stage, fn) {
  const context=diagnosticContext();
  if(context) context.stage=stage;
  return fn();
}
const statusMessages={
  400:'Check the submitted values and try again.',
  401:'Sign in to continue.',
  403:'You are not authorized to perform this action.',
  404:'The requested resource was not found.',
  409:'The configuration changed or an operation is already in progress. Refresh before continuing.',
  422:"Agent Smith couldn't verify that server configuration safely. Review the failed check.",
  429:'Too many requests. Wait briefly before trying again.',
  503:'A required service is unavailable. No additional changes will be made; try again when it recovers.',
  500:"Agent Smith couldn't complete this operation safely. Share the reference with staff.",
};
const conditionMessages={
  native_access_policy_requires_owner_review:'An existing Hallowed Core access-role or channel policy differs from the reviewed configuration. Ask the Owner to review it; no access changes were made.',
  native_access_configuration_missing:'A required Hallowed Core access-role mapping is missing. The Owner must review the saved configuration before setup.',
  setup_permissions_not_verified:'The required bot permissions or current member roles could not be verified. Ask the Owner to review them; do not grant Administrator.',
  bot_permission_policy_requires_owner_review:'Bot permissions differ from the reviewed permission policy. The Owner must review them before setup.',
  bot_must_remain_below_owner:'The bot must remain below the Owner security role. The Owner must review the hierarchy.',
  commands_require_owner_review:'Required existing commands could not be verified. The Owner must review command registration before setup.',
  selected_channel_not_verified:'A selected channel is missing or not visible to the acting member and bot. Choose a verified existing channel.',
  setup_confirmation_required:'Run a fresh preflight preview and confirm its plan before applying setup.',
  setup_changed_or_in_progress:'Setup changed or another confirmed attempt is still running. Refresh its state before continuing.',
};
export function operationalFailure(error, metadata={}) {
  const context={...diagnosticContext(),...metadata};
  let status=500,code='unexpected_failure';
  if(error instanceof PlatformError) {
    status=error.status;
    code=/^[a-z0-9_]{1,100}$/.test(error.code)?error.code:code;
  } else if(error?.status===429 || error?.code==='RATE_LIMITED') {
    status=429; code='dependency_rate_limited';
  } else if(error?.status===403 || [50001,50013].includes(error?.code)) {
    status=422; code='discord_permission_check_failed';
  } else if(error?.status===404 || [10003,10004,10007,10011].includes(error?.code)) {
    status=404; code='discord_resource_missing';
  } else if(['40001','40P01','23505'].includes(error?.code)) {
    status=409; code='operation_conflict';
  } else if(/^08|^53|^57/.test(String(error?.code??'')) ||
      ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','UND_ERR_CONNECT_TIMEOUT','42P01','42703','23503'].includes(error?.code) ||
      error?.name==='AbortError' || error?.name==='TimeoutError' || error?.status>=500) {
    status=503; code='dependency_unavailable';
  }
  const referenceId=context.requestId??randomUUID();
  const entry={referenceId,operation:context.operation??'member-action',stage:context.stage??'validation',
    at:new Date().toISOString(),guildId:context.guildId??null,status,errorClass:code};
  recent.push(entry);
  if(recent.length>100) recent.shift();
  // No request bodies, sessions, token values, SQL text or member identity.
  const dependencyCode=!(error instanceof PlatformError) &&
    /^(?:[0-9A-Z]{5}|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT)$/.test(String(error?.code??''))?
    String(error.code):undefined;
  console.error(JSON.stringify({event:'smith.operation.failed',...entry,...(dependencyCode?{dependencyCode}:{})}));
  return {status,body:{error:code,message:conditionMessages[code]??statusMessages[status]??statusMessages[400],referenceId}};
}
export function recentFailures(guildId) {
  return recent.filter(row=>row.guildId===guildId).slice(-8).reverse()
    .map(({referenceId,operation,stage,at})=>({referenceId,operation,stage,at}));
}
export function safeMemberFailure(error, metadata={}) {
  const failure=operationalFailure(error,metadata);
  const known=new Set([
    'Human members only.', 'Complete Discord’s server rules screening before continuing.',
    'Accept rules and choose your first framework before requesting another.',
    'Member must complete onboarding first.', 'Join the associated framework first.',
    'Accept the rules first with /accept.', 'Use the official onboarding message in #onboarding.',
    'Use the official request menu in #access-requests.',
    'Use the bot’s withdrawal buttons from /requests.',
    'You may withdraw only your own pending requests.',
    'Use the bot’s review buttons from /pending.',
    'Use the bot’s page buttons from /pending.',
    'Only allowlisted human reviewers or Admins may use this command.',
    'Use the control room.',
    'Request not found. Run /pending and use the number after “Request #”, not the member’s Discord ID.',
    'Another allowlisted human must review your request.',
    'Owner only.', 'You already have this framework.', 'Request already reviewed.',
    'Request is no longer pending.', 'This command revokes additional access only.',
    'Legacy onboarding is disabled. Complete Discord rules screening and select one community in Channels & Roles. /request still requires human review.',
    'Invalid review button. Run /pending for current requests.',
    'Invalid pending page button. Run /pending for current requests.',
    'Use the request number shown by /pending (for example 1), not a member ID.',
    'You already selected a framework. Use /request for additional access.',
    'Choose Faith, Gaming, or Tech.',
  ]);
  const message=known.has(error?.message)?error.message:
    "Agent Smith couldn't verify that server configuration safely. Please ask staff to review it.";
  return `Unable to complete: ${message} Reference: ${failure.body.referenceId}`;
}
