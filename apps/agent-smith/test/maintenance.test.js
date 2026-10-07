import test from 'node:test';
import assert from 'node:assert/strict';
import { memberLifecycle,authorizedFrameworks,validateInterest,caseOutcome } from '../src/lifecycle-policy.js';
import { nativeDecision } from '../src/native-policy.js';
import { contentSignals } from '../src/content-automod.js';
import { eligibleText } from '../src/text-participation.js';
import { moderationAlias } from '../src/moderation.js';
import { isOwner,isAdmin,isModerator,canGrantFramework,canPerformDangerousAction } from '../src/authorization.js';
import { PermissionsBitField,PermissionFlagsBits as P } from 'discord.js';
const accepted={accepted_at:new Date(),primary_framework:'Gaming'};
test('persistent lifecycle respects screening, choices, stage requirements and restrictions',()=>{
 assert.equal(memberLifecycle({pending:true}).state,'RULES_PENDING');
 assert.equal(memberLifecycle({pending:false}).state,'RULES_PENDING');
 assert.equal(memberLifecycle({pending:false,record:{accepted_at:new Date()}}).state,'FRAMEWORK_PENDING');
 assert.equal(memberLifecycle({pending:false,record:{...accepted,onboarding_flow:'staged'}}).state,'INTERESTS_PENDING');
 assert.equal(memberLifecycle({pending:false,record:accepted,held:['Gaming'],memberRole:true}).state,'ACTIVE');
 assert.equal(memberLifecycle({pending:false,record:accepted,held:['Gaming','Faith'],memberRole:true}).state,'ONBOARDING_BLOCKED');
 assert.equal(memberLifecycle({pending:false,record:accepted,held:['Gaming','Faith'],grants:['Faith'],memberRole:true}).state,'ACTIVE');
 assert.equal(memberLifecycle({pending:false,record:accepted,held:['Gaming'],memberRole:true,restricted:true}).reason,'active-restriction');
});
test('staged native decisions record primary only after explicit consent, then wait for interests',()=>{
 const base={pending:false,selections:['Gaming'],record:{onboarding_flow:'staged'}};
 assert.equal(nativeDecision(base).status,'waiting-rules');
 assert.equal(nativeDecision({...base,record:{...base.record,rules_version_accepted:'1',accepted_at:new Date()}}).status,'initialize');
 assert.equal(nativeDecision({...base,record:{...accepted,onboarding_flow:'staged',rules_version_accepted:'1'}}).status,'waiting-interests');
 assert.equal(nativeDecision({...base,record:{...accepted,onboarding_flow:'staged',rules_version_accepted:'1',interests_completed_at:new Date()}}).status,'ready');
 assert.equal(nativeDecision({...base,restricted:true}).reason,'active-restriction');
});
test('interests require durable authorization and cannot be security roles',()=>{
 assert.deepEqual(authorizedFrameworks(accepted,['Tech','Tech','invalid']),['Gaming','Tech']);
 assert.deepEqual(authorizedFrameworks({primary_framework:'Gaming'},['Tech']),[]);
 assert.equal(validateInterest('Street Fighter 6','Gaming',['Gaming']),'Interest: Street Fighter 6');
 assert.throws(()=>validateInterest('Gaming','Gaming',['Gaming']));
 assert.throws(()=>validateInterest('Prayer','Faith',['Gaming']));
});
test('unknown moderation outcomes never become confirmed restrictions',()=>{
 assert.equal(caseOutcome({status:'completed'}),'completed');
 assert.equal(caseOutcome({status:'failed',errorCode:50013}),'failed');
 assert.equal(caseOutcome({status:'failed'}),'uncertain');
});
test('deterministic automod detects all supported rule classes without AI or user regex',()=>{
 assert.deepEqual(contentSignals('Join discord.gg/unknown',{}),['external-invite']);
 assert.deepEqual(contentSignals('Join discord.gg/allowed',{allowedInviteCodes:['allowed']}),[]);
 assert.ok(contentSignals('Some BLOCKEDWORD now',{bannedWords:['blockedword']}).includes('banned-word'));
 assert.ok(contentSignals('https://sub.scam.example/x',{blockedDomains:['scam.example']}).includes('blocked-domain'));
 assert.ok(!contentSignals('https://not-scam.example/x',{blockedDomains:['scam.example']}).includes('blocked-domain'));
 for(const signal of ['mass-mention','message-flood','duplicate-spam'])assert.ok(contentSignals('hello',{}, {mentions:5,messages:8,duplicates:3}).includes(signal));
 assert.ok(contentSignals('😀'.repeat(20)).includes('emoji-flood'));
 assert.ok(contentSignals('THIS IS A VERY LONG CAPS FLOOD MESSAGE').includes('caps-flood'));
 assert.ok(contentSignals('free nitro https://scam.example').includes('scam-pattern'));
});
test('text eligibility rejects commands, tiny posts, caps and known scam farming',()=>{
 for(const text of ['/command hello world more','!repeat some text again','a','aaaaaaaaaaaaaaaaaaaaa','free nitro https://scam.example'])assert.equal(eligibleText(text),false);
 assert.equal(eligibleText('Here is a helpful contribution to the conversation.'),true);
});
test('moderation command aliases preserve the real interaction transport',()=>{
 let called=false;const input={commandName:'warn',options:{getString:()=> 'reason'},reply(){called=this===input;}};
 const facade=moderationAlias(input);
 assert.equal(facade.commandName,'mod');assert.equal(facade.options.getSubcommand(),'warn');
 assert.equal(facade.options.getString('reason'),'reason');facade.reply();assert.equal(called,true);
});
test('central authorization distinguishes Owner, Admin, Moderator and crossover approver',()=>{
 const cfg={owners:['owner'],ownerDiscordId:'owner',approvers:['approver']},guild={ownerId:'owner'};
 const member=(id,permission=0n)=>({id,user:{bot:false},permissions:new PermissionsBitField(permission)});
 assert.ok(isOwner(member('owner'),cfg,guild));
 assert.ok(isAdmin(member('admin',P.Administrator),cfg,guild));
 assert.ok(isModerator(member('mod',P.ModerateMembers),cfg,guild));
 assert.ok(canGrantFramework(member('approver'),cfg,guild));
 assert.equal(canGrantFramework(member('mod',P.ModerateMembers),cfg,guild),false);
 assert.equal(canPerformDangerousAction(member('mod',P.ModerateMembers),cfg,guild,'ban'),false);
 assert.equal(canPerformDangerousAction(member('owner'),cfg,guild,'nuke'),false);
});
