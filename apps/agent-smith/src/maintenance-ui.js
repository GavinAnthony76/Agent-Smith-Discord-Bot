import { ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle } from 'discord.js';
import { frameworks,interests } from './blueprint.js';
import { isAdmin,assertStaff,canGrantFramework } from './authorization.js';
const row=(...c)=>new ActionRowBuilder().addComponents(c);
const button=(id,label)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const sections=['MEMBERS','ONBOARDING','MODERATION','FRAMEWORKS','INTERESTS','CHANNELS','FEEDS','XP / ECONOMY','SERVER STATUS','SETTINGS'];
export function createMaintenanceUI(ctx) {
 const {guild,client,cfg,pool,members,cases,reports,moderation,native}=ctx;
 const staff=async i=>{const actor=await guild.members.fetch({user:i.user.id,force:true});assertStaff(actor,cfg,guild);return actor;};
 async function onboarding(uid) {
  const {record}=await members.context(uid);
  const prefs=await members.preferences(uid);
  const version=(await pool.query("SELECT value FROM bot_settings WHERE guild_id=$1 AND key='rules-version'",[guild.id])).rows[0]?.value??'1';
   const rules=await ctx.resource('channel','rules');
   return {content:`**Your onboarding**\nRead the current rules in <#${rules}> before confirming version **${version}**.\nRules accepted: ${record?.accepted_at?'yes':'no'}; recorded version: ${record?.rules_version_accepted??'unversioned'}\nPrimary framework: ${record?.primary_framework??'not selected'}\nSelected interests: ${prefs.filter(p=>p.desired).map(p=>p.name).join(', ')||'none'}\nState: ${record?.onboarding_status??'NEW'}\nReason: ${record?.onboarding_block_reason??'none'}\nUse Discord’s required FAITH / GAMING / TECH question to select exactly one primary. Use /interests, then Finish interests. Native Rules Screening cannot be bypassed.`,
   components:[row(button(`smith:life:agree:${version}`,'I Agree — confirm current rules'),button('smith:life:finish','Finish interests'),button('smith:life:refresh','Refresh'))]};
 }
 async function interestPanel(uid,framework) {
  const state=await members.context(uid);
  if(!state.allowed.length)throw new Error('Complete rules and primary framework selection first.');
  const f=framework??state.record.primary_framework;
  if(!state.allowed.includes(f))throw new Error('Approved framework required.');
  const prefs=await members.preferences(uid);
  const choices=[];
  for(const name of interests[f]) {
   // Missing interests are not silently provisioned into the live server.
   const id=await ctx.resource('role',`Interest: ${name}`);
   choices.push({label:name,value:name,default:prefs.some(p=>p.name===name&&p.desired)});
  }
  return {content:`**${f} interests** — preferences only, never framework access. Saved in PostgreSQL.`,
   components:[row(new StringSelectMenuBuilder().setCustomId('smith:life:framework').setPlaceholder('Approved framework')
    .addOptions(state.allowed.map(n=>({label:n,value:n,default:n===f})))),
   row(new StringSelectMenuBuilder().setCustomId(`smith:life:interests:${f}`).setMinValues(0).setMaxValues(choices.length).addOptions(choices)),
   row(button('smith:life:finish','Finish interests'))]};
 }
 async function status(actor) {
  await pool.query('SELECT 1');
  const lines=[`Discord: ${client.isReady()?'connected':'reconnecting'}`,'Database: reachable'];
  if(isAdmin(actor,cfg,guild)) {
   const health=(await pool.query('SELECT worker,last_seen_at FROM worker_health WHERE guild_id=$1',[guild.id])).rows;
   const counts=(await pool.query(`SELECT
    (SELECT count(*) FROM native_jobs WHERE guild_id=$1)::int AS native,
    (SELECT count(*) FROM requests WHERE guild_id=$1 AND status='pending')::int AS requests,
    (SELECT count(*) FROM member_reports WHERE guild_id=$1 AND status NOT IN ('closed','dismissed'))::int AS reports,
    (SELECT count(*) FROM moderation_cases WHERE guild_id=$1 AND closed_at IS NULL)::int AS cases,
    (SELECT count(*) FROM progression_jobs WHERE guild_id=$1)::int AS progression`,[guild.id])).rows[0];
   lines.push(`Worker heartbeats: ${health.map(h=>`${h.worker}: ${new Date(h.last_seen_at).toISOString()}`).join('; ')||'not yet recorded'}`,
    `Pending reconciliation/access/reports/cases/XP: ${counts.native}/${counts.requests}/${counts.reports}/${counts.cases}/${counts.progression}`,
    'Automod: passive by default; /smith-control status. Feeds: integrated worker; /smith-control feed-status for source approval/delivery health.',
    'Hosting: gateway runtime health does not establish a Reserved VM deployment.');
  }
  return lines.join('\n');
 }
 async function handle(i) {
  const cmd=i.isChatInputCommand?.()?i.commandName:null;
  const custom=i.customId??'';
  const supported=['onboarding','interests','onboarding-recover','smith','report','cases','case','case-note','case-close','member-info','mod-history'];
  const panel=cmd==='smith-control'&&i.options.getSubcommand()==='panel';
  if(!supported.includes(cmd)&&!panel&&!/^(smith:life:|smith:report:|smith:maintenance:)/.test(custom))return false;
  if(i.guildId!==guild.id)throw new Error('This interaction belongs to another server.');
  if((i.isButton?.()||i.isStringSelectMenu?.())&&i.message?.author?.id!==client.user.id)throw new Error('Use Smith’s own interface.');
  if(custom.startsWith('smith:maintenance:moreinfo:')&&i.isButton?.()) {
   const actor=await guild.members.fetch({user:i.user.id,force:true});
   if(!canGrantFramework(actor,cfg,guild))throw new Error('Configured crossover approver or Admin required.');
   const id=custom.split(':')[3];if(!/^[1-9]\d{0,18}$/.test(id))throw new Error('Invalid request.');
   await i.showModal(new ModalBuilder().setCustomId(`smith:maintenance:ask:${id}`).setTitle('Ask applicant for more information')
    .addComponents(row(new TextInputBuilder().setCustomId('question').setLabel('Question, visible in their /requests inbox').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500))));
   return true;
  }
  if(cmd==='report') {
   const target=i.options.getUser('user')?.id??'';
   await i.showModal(new ModalBuilder().setCustomId('smith:report:submit').setTitle('Private report').addComponents(
    row(new TextInputBuilder().setCustomId('target').setLabel('Reported member ID (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(target)),
    row(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
    row(new TextInputBuilder().setCustomId('reference').setLabel('Discord message link (optional)').setStyle(TextInputStyle.Short).setRequired(false))));
   return true;
  }
  if(/^smith:report:(warn|timeout):/.test(custom)&&i.isButton?.()) {
   await staff(i);
   const id=custom.split(':')[3];
   await i.showModal(new ModalBuilder().setCustomId(`smith:report:punish:${custom.split(':')[2]}:${id}`).setTitle('Human moderation decision')
    .addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel('Your moderation reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(400))));
   return true;
  }
  await i.deferReply({flags:64});
  let result;
  if(custom.startsWith('smith:maintenance:ask:')) {
   const actor=await guild.members.fetch({user:i.user.id,force:true});
   if(!canGrantFramework(actor,cfg,guild))throw new Error('Configured crossover approver or Admin required.');
   const id=custom.split(':')[3];if(!/^[1-9]\d{0,18}$/.test(id))throw new Error('Invalid request.');
   const question=i.fields.getTextInputValue('question').trim();if(!question||question.length>500)throw new Error('Question required.');
   const changed=await pool.query("UPDATE requests SET info_requested_at=now(),info_request_reason=$3 WHERE guild_id=$1 AND id=$2 AND status='pending' AND (expires_at IS NULL OR expires_at>now()) RETURNING id",[guild.id,id,question]);
   if(!changed.rowCount)throw new Error('Pending request not found.');
   await ctx.audit(pool,i.user.id,'access-more-info',{requestId:id,question});
   result='Question saved. Applicant can read it in /requests; no access decision or grant was made.';
  } else if(cmd==='onboarding'||custom==='smith:life:refresh')result=await onboarding(i.user.id);
  else if(cmd==='interests'||custom==='smith:life:framework')result=await interestPanel(i.user.id,i.values?.[0]);
  else if(custom.startsWith('smith:life:interests:')) {
   const f=custom.split(':')[3];
   if(!frameworks.includes(f)||i.values.some(n=>!interests[f].includes(n)))throw new Error('Invalid interest selection.');
   for(const n of interests[f])await members.changeInterest(i.user.id,n,f,i.values.includes(n));
   result=await interestPanel(i.user.id,f);
  } else if(custom.startsWith('smith:life:agree:')) {
   await members.accept(i.user.id,custom.slice('smith:life:agree:'.length));
   await native.enqueue(i.user.id);result=await onboarding(i.user.id);
  } else if(custom==='smith:life:finish') {
   await members.finish(i.user.id);result=await onboarding(i.user.id);
  } else if(cmd==='onboarding-recover') {
   const actor=await staff(i);if(!isAdmin(actor,cfg,guild))throw new Error('Admin-only recovery.');
   await members.recover(i.options.getUser('user',true).id,i.user.id);result='Recovery completed without resetting primary framework, approvals, warnings or punishment history.';
  } else if(cmd==='smith') {
   const actor=await guild.members.fetch({user:i.user.id,force:true});result=await status(actor);
  } else if(custom==='smith:report:submit') {
   const id=await reports.submit(i.user.id,i.fields.getTextInputValue('target'),i.fields.getTextInputValue('reason'),i.fields.getTextInputValue('reference'));
   result=`Report #${id} saved privately. Staff delivery retries if unavailable.`;
  } else if(custom.startsWith('smith:report:punish:')) {
   await staff(i);
   const [, , ,op,id]=custom.split(':');
   if(!['warn','timeout'].includes(op)||!/^[1-9]\d{0,18}$/.test(id))throw new Error('Invalid report action.');
   const r=(await pool.query('SELECT * FROM member_reports WHERE guild_id=$1 AND id=$2',[guild.id,id])).rows[0];
   if(!r||!r.target_id||['closed','dismissed'].includes(r.status))throw new Error('Unresolved report with a target required.');
   // Claim transaction refuses other staff and repeated/closed decisions.
   await reports.transition(id,i.user.id,'claim');
   await reports.reserveAction(id,i.user.id,op);
   try {
    result=await moderation.execute({operation:op,target:r.target_id,minutes:op==='timeout'?10:undefined,reason:i.fields.getTextInputValue('reason')},i.user.id);
    await reports.finishAction(id,op,'completed');
   } catch(error) {
    await reports.finishAction(id,op,'uncertain').catch(()=>{});
    throw error;
   }
  } else if(custom.startsWith('smith:report:')) {
   await staff(i);const [, ,op,id]=custom.split(':');result=`Report #${id}: ${await reports.transition(id,i.user.id,op)}.`;
  } else if(panel||custom==='smith:maintenance:panel') {
   await staff(i);
   if(i.values?.[0]==='FEEDS') {
    if(!cfg.owners.includes(i.user.id))throw new Error('Configured Owner only for feed controls.');
    if(i.channelId!==await ctx.resource('channel','smith-controls'))throw new Error('Use #smith-controls for feed controls.');
    await guild.fetch();
    const {assertOwnerConfiguration}=await import('./security-policy.js');
    assertOwnerConfiguration(cfg,guild.ownerId);
    result={content:`${await ctx.feeds.status()}\nOwner controls: /smith-control feed-save, feed-enable, feed-status id, feed-resolve.`,
     components:[row(new StringSelectMenuBuilder().setCustomId('smith:maintenance:panel').addOptions(sections.map(s=>({label:s,value:s}))))]};
   } else {
   result={content:`**Smith control panel${i.values?.[0]?` — ${i.values[0]}`:''}**\n${await status(await staff(i))}\nMembers/onboarding: /member-info, /onboarding-recover\nModeration: /mod, /cases, /case, /report\nFrameworks: /pending, /review, /revoke\nInterests: /interests\nChannels: protected; Owner manages structural changes manually\nFeeds: integrated polling; select FEEDS for Owner status/controls\nXP: /xp, /ranks, /faith-review; economy not enabled\nSettings: /smith-control status, request-expiry, automod`,
    components:[row(new StringSelectMenuBuilder().setCustomId('smith:maintenance:panel').addOptions(sections.map(s=>({label:s,value:s}))))]};
   }
  } else {
   await staff(i);
   if(cmd==='case-note') {await cases.note(i.options.getString('id',true),i.user.id,i.options.getString('note',true));result='Attributed case note saved.';}
   else if(cmd==='case-close') {await cases.close(i.options.getString('id',true),i.user.id);result='Review closed. History and active restrictions retained; use /mod untimeout or unban to remove them.';}
   else if(cmd==='case') {
    const id=i.options.getString('id',true);if(!/^[1-9]\d{0,18}$/.test(id))throw new Error('Invalid case ID.');
    const r=(await pool.query('SELECT * FROM moderation_cases WHERE guild_id=$1 AND case_id=$2',[guild.id,id])).rows[0];
    if(!r)throw new Error('New-format case not found. Older cases remain available in /mod history.');
    const notes=(await pool.query('SELECT actor_id,note FROM moderation_case_notes WHERE guild_id=$1 AND case_id=$2 ORDER BY id DESC LIMIT 5',[guild.id,id])).rows;
    result=`Case #${id}: ${r.action_type}; ${r.status}; active ${r.active}\nMember ${r.user_id}; actor ${r.moderator_id}\nReason: ${r.reason}\nExpiry: ${r.expires_at??'none'}\n${notes.map(n=>`${n.actor_id}: ${n.note}`).join('\n')}`;
   } else if(cmd==='member-info') {
    const uid=i.options.getUser('user',true).id;
    const r=(await pool.query('SELECT onboarding_status,primary_framework,rules_version_accepted,last_reconciled_at,left_at FROM members WHERE guild_id=$1 AND user_id=$2',[guild.id,uid])).rows[0];
    result=`Member ${uid}\n${JSON.stringify(r??{status:'unrecorded'})}`;
   } else {
    const uid=i.options.getUser('user')?.id;
    const r=await cases.list(uid);
    result=r.rows.map(c=>`#${c.case_id} ${c.user_id??'channel action'} ${c.action_type} ${c.status}${c.active?' [active]':''}: ${c.reason.slice(0,70)}`).join('\n')||'No new-format cases. Existing audit history is preserved in /mod history.';
    if(cmd==='mod-history'&&uid) {
     const old=await pool.query("SELECT id,action,detail FROM audit WHERE guild_id=$1 AND action LIKE 'mod.%' AND detail->>'target'=$2 ORDER BY id DESC LIMIT 10",[guild.id,uid]);
     result+=`\nLegacy/intent history:\n${old.rows.map(r=>`#${r.id} ${r.action}: ${r.detail.reason??r.detail.status??''}`).join('\n')}`;
    }
   }
  }
  const response=typeof result==='string'?{content:result}:result;
  await i.editReply({...response,content:response.content.slice(0,1900),allowedMentions:{parse:[]}});
  return true;
 }
 return {handle};
}
