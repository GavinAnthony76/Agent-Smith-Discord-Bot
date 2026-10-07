import { frameworks, interests } from './blueprint.js';
export const LIFECYCLE_STATES=Object.freeze(['NEW','RULES_PENDING','FRAMEWORK_PENDING','INTERESTS_PENDING','ACTIVE','ONBOARDING_BLOCKED']);
export function memberLifecycle({pending,record,held=[],grants=[],memberRole=false,restricted=false}) {
 if(restricted)return {state:'ONBOARDING_BLOCKED',reason:'active-restriction'};
 if(pending!==false)return {state:'RULES_PENDING',reason:null};
 if(held.some(f=>!record?.accepted_at || (f!==record.primary_framework&&!grants.includes(f))))
  return {state:'ONBOARDING_BLOCKED',reason:'unrecorded-access-needs-human-review'};
 if(!record?.accepted_at)return {state:'RULES_PENDING',reason:null};
 if(!frameworks.includes(record.primary_framework))return {state:'FRAMEWORK_PENDING',reason:null};
 if(record.onboarding_flow==='staged'&&!record.interests_completed_at)return {state:'INTERESTS_PENDING',reason:null};
 if(!memberRole || !held.includes(record.primary_framework))return {state:'ONBOARDING_BLOCKED',reason:'approved-role-missing'};
 return {state:'ACTIVE',reason:null};
}
export function authorizedFrameworks(record,grants=[]) {
 return record?.accepted_at&&frameworks.includes(record.primary_framework)
  ? [...new Set([record.primary_framework,...grants.filter(f=>frameworks.includes(f))])]:[];
}
export function validateInterest(name,framework,allowed) {
 if(!allowed.includes(framework)||!interests[framework]?.includes(name))throw new Error('Interest must belong to an approved framework.');
 return `Interest: ${name}`;
}
export function caseOutcome(detail) {
 if(detail.status==='completed')return 'completed';
 return [50013,50001,50035,10007].includes(detail.errorCode)?'failed':'uncertain';
}
