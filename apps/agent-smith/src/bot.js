import { connect } from './discord.js';
import { pool, locked, resource, audit } from './db.js';
import { frameworks, interests } from './blueprint.js';
import { maySelfJoin, canReview, assertFramework, assertAssignableRole } from './policy.js';
import { isOnboardingInteraction, onboardingAction } from './onboarding.js';
import { isAccessRequestInteraction, accessRequestAction } from './access-request.js';
import { isReviewInteraction, reviewAction, parseRequestId, pendingMessage, isPendingInteraction, pendingAction, PENDING_PAGE_SIZE } from './review.js';
import { createModeration, isModerationInteraction } from './moderation.js';
import { createAntiSpam } from './antispam.js';
import { createNativeReconciler } from './native-reconcile.js';
import { legacyAllowed } from './native-policy.js';
import { recoverApproval } from './access-recovery.js';
import { createProgression } from './progression.js';
import { createProgressionInteractions } from './progression-interactions.js';
import { assertNotOwner, refreshOwnerProtection, withRoleWorkflow } from './security-policy.js';
import { createRequestLifecycle, withdrawalAction, myRequestsMessage, assignRequestExpiry, requestExpired, transitionRequest } from './request-lifecycle.js';
import { createSmithControl } from './smith-control.js';
import { createCases } from './maintenance-cases.js';
import { createMaintenance } from './maintenance.js';
import { canGrantFramework } from './authorization.js';
import { createFeeds } from './feeds.js';
import { assertFeedSchema } from './feed-schema-check.js';
import { createWorkerStatus } from './worker-status.js';
import { createConversationHandlers } from './conversation-handler.js';
// Fail before Gateway login rather than entering a Discord-connected crash loop.
try {
  await assertFeedSchema(pool);
} catch (error) {
  await pool.end();
  throw error;
}
// One process: the status listener never starts a second Gateway connection.
const statusPort = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(statusPort) || statusPort < 1 || statusPort > 65535) {
  await pool.end();
  throw new Error('PORT must be a valid TCP port for the worker status listener.');
}
let connectedClient;
const workerStatus = createWorkerStatus({ isDiscordReady: () => connectedClient?.isReady() ?? false });
await workerStatus.listen({ port: statusPort });
console.log('Worker status listener started; Discord readiness is reported separately.');
const { client,guild,cfg } = await connect({
  allowWrites: true, waitForSession: true,
  onStartupState: phase => workerStatus.setPhase(phase),
});
connectedClient = client;
let conversation;
try {
 conversation = createConversationHandlers({client,guild,cfg,pool});
 // Command registration must not delay the existing operational handlers.
 void conversation.register().catch(() => console.error('Smith conversation command registration failed.'));
} catch {
 console.error('Smith conversation configuration unavailable; core bot continues without it.');
}
const feeds=createFeeds({guild,client,pool,resource,audit});
const requests = createRequestLifecycle({guild,client,cfg,pool,locked});
const control = createSmithControl({guild,cfg,pool,resource,feeds,lookupWarnings:conversation?.lookupWarnings});
const spam = await createAntiSpam({ guild, cfg, pool, resource });
const cases=createCases({guild,client,cfg,pool,locked,audit});
const moderation = createModeration({ guild, cfg, pool, resource, spam, recordCase:cases.record });
const native = await createNativeReconciler({ guild, client, restrictionActive:cases.restricted });
const progression = await createProgression({ guild, client, cfg });
const maintenance=createMaintenance({guild,client,cfg,pool,locked,resource,audit,native,progression,moderation,cases,feeds});
const handleProgression = createProgressionInteractions({ progression, guild, cfg, client, pool, resource, audit });
const roleIds = Object.fromEntries(await Promise.all([...frameworks,'Member'].map(async f=>[f,await resource('role',f)])));
const human = async id => {
 if(canReview(id,cfg))return true;
 try{return canGrantFramework(await guild.members.fetch({user:id,force:true}),cfg,guild);}catch{return false;}
};
async function log(actor, action, detail) {
  // The durable database log is authoritative. Discord delivery is best effort.
  try { const ch=await guild.channels.fetch(await resource('channel','audit-log')); await ch.send({content:`${action} | actor ${actor} | ${JSON.stringify(detail)}`.slice(0,1900),allowedMentions:{parse:[]}}); }
  catch { console.error('Discord audit mirror unavailable; see database audit table.'); }
}
client.on('interactionCreate', async i => {
  if (conversation && await conversation.handleInteraction(i)) return;
  if (i.isChatInputCommand() && i.commandName === 'smith-control' && i.options.getSubcommand()!=='panel') { await control.handle(i); return; }
    // Includes current-member consent and fresh, Owner-only historical recording.
    // These actions deliberately do not enter a Discord role mutation scope.
    if (await maintenance.handle(i)) {
      if (conversation && i.isChatInputCommand() && i.commandName==='smith' && i.options.getSubcommand()==='status')
        await conversation.appendStatus(i).catch(() => console.error('Conversational status follow-up unavailable.'));
      return;
    }
    if (await handleProgression(i)) return;
  if (isModerationInteraction(i)) {
    try { await moderation.handle(i); } catch (error) { console.error('Moderation interaction failed:', error.code ?? error.message); }
    return;
  }
  if ((!i.isChatInputCommand() && !isOnboardingInteraction(i) && !isReviewInteraction(i) && !isPendingInteraction(i) && !isAccessRequestInteraction(i)
    && !(i.isButton() && i.customId.startsWith('smith:request:withdraw:'))) || i.guildId !== cfg.guildId || i.user.bot) return;
  try { await i.deferReply({flags:64}); }
  catch (error) { console.error('Interaction acknowledgement failed:', error.code ?? error.message); return; }
  let approvalAttempt;
  try {
    const withdrawal = withdrawalAction(i);
    if (withdrawal) {
      await refreshOwnerProtection(guild);
      assertNotOwner(guild,i.user.id,cfg);
      if (i.message.author.id !== client.user.id) throw new Error('Use the bot’s withdrawal buttons from /requests.');
      const result=await locked(`${guild.id}:${i.user.id}`,async db=>{
        const request=(await db.query('SELECT * FROM requests WHERE guild_id=$1 AND id=$2 FOR UPDATE',[guild.id,withdrawal.id])).rows[0];
        if(!request || request.user_id!==i.user.id) throw new Error('You may withdraw only your own pending requests.');
        const status=requestExpired(request)?'expired':'withdrawn';
        await transitionRequest(db,{guildId:guild.id,request,status,actor:i.user.id});
        return `Request #${request.id} ${status}. No access was changed.`;
      });
      await i.editReply({content:result,components:[],allowedMentions:{parse:[]}});return;
    }
    const onboarding=onboardingAction(i), review=reviewAction(i), accessRequest=accessRequestAction(i), pending=pendingAction(i);
    const action=onboarding ?? review ?? accessRequest ?? pending;
    if (onboarding && (i.channelId !== await resource('channel','onboarding')
      || i.message.id !== await resource('message','onboarding')
      || i.message.author.id !== client.user.id)) {
      throw new Error('Use the official onboarding message in #onboarding.');
    }
    if (review && i.message.author.id !== client.user.id) throw new Error('Use the bot’s review buttons from /pending.');
    if (pending && i.message.author.id !== client.user.id) throw new Error('Use the bot’s page buttons from /pending.');
    if (accessRequest && (i.channelId !== await resource('channel','access-requests')
      || i.message.id !== await resource('message','access-requests')
      || i.message.author.id !== client.user.id)) {
      throw new Error('Use the official request menu in #access-requests.');
    }
    const aliases={'access-request':'request','access-approve':'review','access-deny':'review','access-revoke':'revoke'};
    const name=action?.name ?? aliases[i.commandName] ?? i.commandName, uid=i.user.id,
      target=action ? action.framework : i.options.getString('framework');
    if (name==='requests') {
      const rows=(await pool.query('SELECT * FROM requests WHERE guild_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 15',[guild.id,uid])).rows;
      await i.editReply(myRequestsMessage(rows));return;
    }
    if (['join','request','revoke'].includes(name)) assertFramework(target);
    if (['pending','review','revoke'].includes(name)) {
      if (!await human(uid)) throw new Error('Only allowlisted human reviewers or Admins may use this command.');
      if (i.channelId !== await resource('channel','access-review') && i.channelId !== await resource('channel','smith-controls')) throw new Error('Use the control room.');
    }
    if (name==='pending') {
      const after=pending?.after ?? null;
      const r=await pool.query("SELECT id,user_id,framework,created_at,expires_at FROM requests WHERE guild_id=$1 AND status='pending' AND id>$2 ORDER BY id LIMIT $3",[guild.id,after ?? '0',PENDING_PAGE_SIZE+1]);
      await i.editReply(pendingMessage(r.rows,after)); return;
    }
    let subject=uid, request;
    if (name==='review') {
      const id=parseRequestId(review ? review.requestId : i.options.getString('id'));
      request=(await pool.query('SELECT * FROM requests WHERE guild_id=$1 AND id=$2',[guild.id,id])).rows[0];
      if (!request) throw new Error('Request not found. Run /pending and use the number after “Request #”, not the member’s Discord ID.');
      subject=request.user_id;
      if (subject===uid) throw new Error('Another allowlisted human must review your request.');
    }
    if (name==='revoke') { if (!cfg.owners.includes(uid)) throw new Error('Owner only.'); subject=i.options.getUser('user').id; }
    if (['accept','join','review','revoke','interest'].includes(name)) {
      await refreshOwnerProtection(guild);
      assertNotOwner(guild, subject, cfg);
    }
    const result = await withRoleWorkflow('member-command', subject, () => locked(`${guild.id}:${subject}`,async db=>{
      if (['accept','join'].includes(name)) {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`onboarding-mode:${guild.id}`]);
        const state = (await db.query('SELECT * FROM onboarding_state WHERE guild_id=$1',[guild.id])).rows[0];
        if (!legacyAllowed(state)) throw new Error('Legacy onboarding is disabled. Complete Discord rules screening and select one community in Channels & Roles. /request still requires human review.');
      }
      const member=await guild.members.fetch({user:subject,force:true});
      if (member.user.bot) throw new Error('Human members only.');
      if (member.pending) throw new Error('Complete Discord’s server rules screening before continuing.');
      await db.query('INSERT INTO members(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[guild.id,subject]);
      const m=(await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2 FOR UPDATE',[guild.id,subject])).rows[0];
      const held=frameworks.filter(f=>member.roles.cache.has(roleIds[f]));
       const add=async f=> { const role=assertAssignableRole(await guild.roles.fetch(roleIds[f])); await member.roles.add(role,'Agent Smith explicit access workflow'); };
      let reply;
      if (name==='accept') {
        await add('Member'); await db.query('UPDATE members SET accepted_at=COALESCE(accepted_at,now()) WHERE guild_id=$1 AND user_id=$2',[guild.id,subject]);
        reply=m.primary_framework ? `You already accepted the rules and chose ${m.primary_framework}. Use /request for another community; it requires human approval.`
          : 'Rules accepted! The shared hub is now open. Choose Faith, Gaming, or Tech from the menu in #onboarding, or use /join.';
      } else if (name==='join') {
        maySelfJoin({accepted:!!m.accepted_at,existing:[...held,...(m.primary_framework?[m.primary_framework]:[])],requested:target});
        await add(target);
        await db.query('UPDATE members SET primary_framework=$3 WHERE guild_id=$1 AND user_id=$2',[guild.id,subject,target]); reply=`Welcome to ${target}! Use /interest to select topics.`;
      } else if (name==='request') {
        if (!m.accepted_at || !m.primary_framework) throw new Error('Accept rules and choose your first framework before requesting another.');
        if (held.includes(target)) throw new Error('You already have this framework.');
        const r=await db.query("INSERT INTO requests(guild_id,user_id,framework) VALUES($1,$2,$3) ON CONFLICT (guild_id,user_id,framework) WHERE status='pending' DO UPDATE SET framework=EXCLUDED.framework RETURNING id",[guild.id,subject,target]);
        request=r.rows[0];
        await assignRequestExpiry(db,guild.id,request.id);
        reply=`Request ${request.id} is pending human review. No access was granted.`;
      } else if (name==='review') {
        request=(await db.query('SELECT * FROM requests WHERE id=$1 FOR UPDATE',[request.id])).rows[0];
        if (request.status!=='pending') throw new Error('Request already reviewed.');
        if (requestExpired(request)) {
          await transitionRequest(db,{guildId:guild.id,request,status:'expired',actor:uid});
          return `Request #${request.id} expired. No access was granted; the member can resubmit.`;
        }
        const approved=review ? review.approve : i.commandName==='access-approve'?true:i.commandName==='access-deny'?false:i.options.getBoolean('approve');
        if (approved) {
           assertFramework(request.framework);
          if (!m.accepted_at || !m.primary_framework) throw new Error('Member must complete onboarding first.');
          const role = assertAssignableRole(await guild.roles.fetch(roleIds[request.framework]));
          approvalAttempt = { subject, framework: request.framework, roleId: role.id,
            requestId: request.id, preExisting: member.roles.cache.has(role.id), added: false };
          if (!approvalAttempt.preExisting) {
            await member.roles.add(role, 'Agent Smith explicit access workflow');
            approvalAttempt.added = true;
          }
          await db.query('INSERT INTO grants(guild_id,user_id,framework,reviewer) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[guild.id,subject,request.framework,uid]);
        }
        await db.query('UPDATE requests SET status=$2,reviewer=$3 WHERE id=$1',[request.id,approved?'approved':'denied',uid]);
        request.status=approved?'approved':'denied';
        reply=`Request ${request.id} ${approved?'approved':'denied'} by human ${uid}.`;
      } else if (name==='revoke') {
        if (m.primary_framework===target) throw new Error('This command revokes additional access only.');
        await member.roles.remove(roleIds[target],'Owner revoked additional access');
        for (const interest of interests[target]) await member.roles.remove(await resource('role',`Interest: ${interest}`));
        await db.query('DELETE FROM grants WHERE guild_id=$1 AND user_id=$2 AND framework=$3',[guild.id,subject,target]); reply=`Additional ${target} access revoked.`;
      } else if (name==='interest') {
        const interest=i.options.getString('name'); const f=frameworks.find(f=>interests[f].includes(interest));
        if (!f || !held.includes(f) || !m.accepted_at) throw new Error('Join the associated framework first.');
        const role=await resource('role',`Interest: ${interest}`);
         if (member.roles.cache.has(role)) await member.roles.remove(role);
         else await member.roles.add(assertAssignableRole(await guild.roles.fetch(role)));
        reply=`Updated interest: ${interest}. This role grants no channel access.`;
      } else if (['trivia','answer'].includes(name)) {
        if (!m.accepted_at || !held.includes('Gaming') || i.channelId!==await resource('channel','arcade')) throw new Error('Gaming members may use this command in #arcade.');
        if (name==='trivia') {
          if (m.last_trivia && Date.now()-new Date(m.last_trivia).getTime()<60000) throw new Error('Please wait one minute between questions.');
          const questions=[['Which Street Fighter character uses the Hadouken and is named Ryu?','ryu'],['What is the abbreviation for World of Warcraft?','wow'],['How many players compete in a standard one-on-one fighting game match?','2']];
          const [q,a]=questions[Math.floor(Math.random()*questions.length)];
          await db.query("INSERT INTO trivia_sessions VALUES($1,$2,$3,now()+interval '2 minutes') ON CONFLICT(guild_id,user_id) DO UPDATE SET answer=$3,expires_at=now()+interval '2 minutes'",[guild.id,subject,a]);
          await db.query('UPDATE members SET last_trivia=now() WHERE guild_id=$1 AND user_id=$2',[guild.id,subject]); reply=`${q}\nUse /answer within two minutes. Correct answers earn up to 10 Gaming XP, with a 10-minute XP cooldown and daily limits.`;
        }
        if (name==='answer') {
          const session=(await db.query('DELETE FROM trivia_sessions WHERE guild_id=$1 AND user_id=$2 RETURNING *',[guild.id,subject])).rows[0];
          if (!session) throw new Error('Start with /trivia.');
          const correct=new Date(session.expires_at)>new Date() && i.options.getString('answer').trim().toLowerCase()===session.answer;
          if (correct) {
            const earned = await progression.earnTx(db, { uid: subject, framework: 'Gaming', source: 'trivia',
              key: `trivia:${new Date(session.expires_at).toISOString()}`, actor: cfg.clientId, reason: 'Correct answer to a consumed, unexpired Gaming trivia session' });
            reply=`Correct! +${earned.amount} Gaming XP (${earned.outcome}).`;
          } else reply='Incorrect or expired. Try another question after the cooldown.';
        }
      } else throw new Error('Unknown command.');
      await audit(db,uid,name,{subject,framework:target,request:request?.id,
        ...(name==='review'?{from:'pending',to:request.status}:{})}); return reply;
    }), uid);
    // Subsequent reply/mirror failures cannot undo an acknowledged commit.
    approvalAttempt = undefined;
    if (name==='request') {
      // Storage is committed. Delivery failure must not imply the request failed.
      // Each explicit resubmission reuses the pending ID and retries once; no
      // automatic retry, since a rejected send can have delivered a message.
      let reply=result;
      try {
        const ch=await guild.channels.fetch(await resource('channel','access-review'));
        await ch.send({content:`New access request from ${uid} for ${target}. Request #${request.id}. Use /pending and /review.`,allowedMentions:{parse:[]}});
      } catch {
        console.error(`Staff notification unconfirmed for saved request #${request.id}; recover with /pending.`);
        reply=`${result} Your request is saved, but staff notification could not be confirmed. Retry the same community through the request menu or /request to attempt notification again using this pending request ID. An allowlisted human reviewer can find it with /pending even without a notification.`;
      }
      // An expired interaction must not prevent staff notification or produce
      // a misleading generic failure after the request was saved.
      await i.editReply({content:reply,allowedMentions:{parse:[]}}).catch(() => {
        console.error(`Private reply unavailable for saved request #${request.id}; recover with /pending.`);
      });
      await log(uid,name,{subject,framework:target,request:request.id});
      return;
    }
    progression.enqueue(subject).catch(() => console.error('Rank enqueue deferred; periodic recovery remains active.'));
    await i.editReply(result); await log(uid,name,{subject,framework:target,request:request?.id});
  } catch (e) {
    console.error('Command failed:',e.message);
    const content = approvalAttempt
      ? await recoverApproval({ attempt: approvalAttempt, error: e, locked, guild })
      : `Unable to complete: ${e.message}`;
    await i.editReply({content:content.slice(0,1900),allowedMentions:{parse:[]}}).catch(()=>{});
  }
});
const queueNative = member => {
  if (member.guild.id !== guild.id || member.user.bot) return;
  maintenance.ensureMember(member).then(()=>native.enqueue(member.id)).then(() => native.drain()).catch(() => console.error('Native event queue unavailable; periodic rescan will recover.'));
  progression.enqueue(member.id).catch(() => console.error('Progression event enqueue deferred.'));
};
client.on('guildMemberAdd', queueNative);
client.on('guildMemberUpdate', (_old, member) => queueNative(member));
client.on('guildMemberAdd',m=>maintenance.join(m).catch(()=>console.error('Member lifecycle join deferred.')));
client.on('guildMemberRemove',m=>maintenance.leave(m).catch(()=>console.error('Member lifecycle leave audit deferred.')));
client.on('guildMemberUpdate',(old,m)=>{
 if(m.guild.id!==guild.id)return;
 maintenance.enqueue(m.id);
 maintenance.event('member-updated',{subject:m.id,nicknameChanged:old.nickname!==m.nickname,
  rolesAdded:[...m.roles.cache.keys()].filter(id=>!old.roles.cache.has(id)),
  rolesRemoved:[...old.roles.cache.keys()].filter(id=>!m.roles.cache.has(id))});
});
for(const [event,action] of [['channelCreate','channel-created'],['channelDelete','channel-deleted'],['channelUpdate','channel-updated'],
 ['roleCreate','role-created'],['roleDelete','role-deleted'],['roleUpdate','role-updated']]) {
 client.on(event,(old,current)=>{const r=current??old;if(r.guild?.id===guild.id)maintenance.event(action,{resourceId:r.id});});
}
client.on('messageDelete',m=>{if(m.guildId===guild.id)maintenance.event('message-deleted',{messageId:m.id,channelId:m.channelId,authorId:m.author?.id??null});});
client.on('messageUpdate',(_old,m)=>{if(m.guildId===guild.id)maintenance.event('message-edited',{messageId:m.id,channelId:m.channelId,authorId:m.author?.id??null});});
requests.start();
await feeds.start();
native.scan().catch(() => console.error('Native startup scan deferred; periodic recovery remains active.'));
progression.scan().catch(() => console.error('Progression startup scan deferred; recovery remains active.'));
maintenance.scan().catch(error=>console.error('Maintenance startup scan deferred; periodic recovery remains active:',error.code??error.name));
client.on('error', error => console.error('Discord client error:', error.code ?? error.name));
client.on('messageCreate', message => {
  conversation?.handleMessage(message).catch(() => console.error('Smith conversation handler failed; content omitted.'));
  maintenance.handleMessage(message).catch(error=>console.error('Content rule deferred:',error.code??error.name));
  spam.handleMessage(message).catch(error => console.error('Anti-spam alert failed:', error.message));
});
let shuttingDown = false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{
 if(shuttingDown)return;
 shuttingDown=true;
 workerStatus.setPhase('stopping');
 conversation?.stop();requests.stop();native.stop();progression.stop();maintenance.stop();
 await feeds.stop();await client.destroy();await workerStatus.close();await pool.end();
 process.exit(0);
});
workerStatus.setPhase('ready');
console.log('Agent Smith ready. No AI access-control path exists.');
