import { connect } from './discord.js';
import { pool, locked, resource, audit } from './db.js';
import { frameworks, interests } from './blueprint.js';
import { maySelfJoin, canReview, assertFramework, assertAssignableRole } from './policy.js';
import { isOnboardingInteraction, onboardingAction } from './onboarding.js';
import { isAccessRequestInteraction, accessRequestAction } from './access-request.js';
import { isReviewInteraction, reviewAction, parseRequestId, pendingMessage } from './review.js';
import { createModeration, isModerationInteraction } from './moderation.js';
import { createAntiSpam } from './antispam.js';
import { createNativeReconciler } from './native-reconcile.js';
import { legacyAllowed } from './native-policy.js';
import { recoverApproval } from './access-recovery.js';
const { client,guild,cfg } = await connect({ allowWrites: true });
const spam = await createAntiSpam({ guild, cfg, pool, resource });
const moderation = createModeration({ guild, cfg, pool, resource, spam });
const native = await createNativeReconciler({ guild, client });
const roleIds = Object.fromEntries(await Promise.all([...frameworks,'Member'].map(async f=>[f,await resource('role',f)])));
const human = id => canReview(id,cfg);
async function log(actor, action, detail) {
  // The durable database log is authoritative. Discord delivery is best effort.
  try { const ch=await guild.channels.fetch(await resource('channel','audit-log')); await ch.send({content:`${action} | actor ${actor} | ${JSON.stringify(detail)}`.slice(0,1900),allowedMentions:{parse:[]}}); }
  catch { console.error('Discord audit mirror unavailable; see database audit table.'); }
}
client.on('interactionCreate', async i => {
  if (isModerationInteraction(i)) { await moderation.handle(i); return; }
  if ((!i.isChatInputCommand() && !isOnboardingInteraction(i) && !isReviewInteraction(i) && !isAccessRequestInteraction(i)) || i.guildId !== cfg.guildId || i.user.bot) return;
  await i.deferReply({flags:64});
  let approvalAttempt;
  try {
    const onboarding=onboardingAction(i), review=reviewAction(i), accessRequest=accessRequestAction(i);
    const action=onboarding ?? review ?? accessRequest;
    if (onboarding && (i.channelId !== await resource('channel','onboarding')
      || i.message.id !== await resource('message','onboarding')
      || i.message.author.id !== client.user.id)) {
      throw new Error('Use the official onboarding message in #onboarding.');
    }
    if (review && i.message.author.id !== client.user.id) throw new Error('Use the bot’s review buttons from /pending.');
    if (accessRequest && (i.channelId !== await resource('channel','access-requests')
      || i.message.id !== await resource('message','access-requests')
      || i.message.author.id !== client.user.id)) {
      throw new Error('Use the official request menu in #access-requests.');
    }
    const name=action?.name ?? i.commandName, uid=i.user.id,
      target=action ? action.framework : i.options.getString('framework');
    if (['join','request','revoke'].includes(name)) assertFramework(target);
    if (['pending','review','revoke'].includes(name)) {
      if (!human(uid)) throw new Error('Only allowlisted human reviewers may use this command.');
      if (i.channelId !== await resource('channel','access-review') && i.channelId !== await resource('channel','smith-controls')) throw new Error('Use the control room.');
    }
    if (name==='pending') {
      const r=await pool.query("SELECT id,user_id,framework FROM requests WHERE guild_id=$1 AND status='pending' ORDER BY id LIMIT 20",[guild.id]);
      await i.editReply(pendingMessage(r.rows)); return;
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
    const result = await locked(`${guild.id}:${subject}`,async db=>{
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
        reply=`Request ${request.id} is pending human review. No access was granted.`;
      } else if (name==='review') {
        request=(await db.query('SELECT * FROM requests WHERE id=$1 FOR UPDATE',[request.id])).rows[0];
        if (request.status!=='pending') throw new Error('Request already reviewed.');
        const approved=review ? review.approve : i.options.getBoolean('approve');
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
      } else if (['trivia','answer','profile'].includes(name)) {
        if (!m.accepted_at || !held.includes('Gaming') || i.channelId!==await resource('channel','arcade')) throw new Error('Gaming members may use this command in #arcade.');
        if (name==='profile') reply=`XP: ${m.xp}. Cosmetic tier: ${m.xp>=100?'Arcade Regular':'New Challenger'}. Rewards never grant framework access.`;
        if (name==='trivia') {
          if (m.last_trivia && Date.now()-new Date(m.last_trivia).getTime()<60000) throw new Error('Please wait one minute between questions.');
          const questions=[['Which Street Fighter character uses the Hadouken and is named Ryu?','ryu'],['What is the abbreviation for World of Warcraft?','wow'],['How many players compete in a standard one-on-one fighting game match?','2']];
          const [q,a]=questions[Math.floor(Math.random()*questions.length)];
          await db.query("INSERT INTO trivia_sessions VALUES($1,$2,$3,now()+interval '2 minutes') ON CONFLICT(guild_id,user_id) DO UPDATE SET answer=$3,expires_at=now()+interval '2 minutes'",[guild.id,subject,a]);
          await db.query('UPDATE members SET last_trivia=now() WHERE guild_id=$1 AND user_id=$2',[guild.id,subject]); reply=`${q}\nUse /answer within two minutes. Correct answers earn 10 XP.`;
        }
        if (name==='answer') {
          const session=(await db.query('DELETE FROM trivia_sessions WHERE guild_id=$1 AND user_id=$2 RETURNING *',[guild.id,subject])).rows[0];
          if (!session) throw new Error('Start with /trivia.');
          const correct=new Date(session.expires_at)>new Date() && i.options.getString('answer').trim().toLowerCase()===session.answer;
          if (correct) await db.query('UPDATE members SET xp=xp+10 WHERE guild_id=$1 AND user_id=$2',[guild.id,subject]);
          reply=correct?'Correct! +10 XP.':'Incorrect or expired. Try another question after the cooldown.';
        }
      } else throw new Error('Unknown command.');
      await audit(db,uid,name,{subject,framework:target,request:request?.id}); return reply;
    });
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
  native.enqueue(member.id).then(() => native.drain()).catch(() => console.error('Native event queue unavailable; periodic rescan will recover.'));
};
client.on('guildMemberAdd', queueNative);
client.on('guildMemberUpdate', (_old, member) => queueNative(member));
native.scan().catch(() => console.error('Native startup scan deferred; periodic recovery remains active.'));
client.on('messageCreate', message => {
  spam.handleMessage(message).catch(error => console.error('Anti-spam alert failed:', error.message));
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{native.stop();client.destroy();await pool.end();process.exit(0);});
console.log('Agent Smith ready. No AI access-control path exists.');
