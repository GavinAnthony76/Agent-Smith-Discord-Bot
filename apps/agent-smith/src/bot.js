import { connect } from './discord.js';
import { pool, locked, resource, audit } from './db.js';
import { frameworks, interests } from './blueprint.js';
import { maySelfJoin, canReview, assertFramework, assertAssignableRole } from './policy.js';
const { client,guild,cfg } = await connect({ allowWrites: true });
const roleIds = Object.fromEntries(await Promise.all([...frameworks,'Member'].map(async f=>[f,await resource('role',f)])));
const human = id => canReview(id,cfg);
async function log(actor, action, detail) {
  // The durable database log is authoritative. Discord delivery is best effort.
  try { const ch=await guild.channels.fetch(await resource('channel','audit-log')); await ch.send({content:`${action} | actor ${actor} | ${JSON.stringify(detail)}`.slice(0,1900),allowedMentions:{parse:[]}}); }
  catch { console.error('Discord audit mirror unavailable; see database audit table.'); }
}
client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand() || i.guildId !== cfg.guildId || i.user.bot) return;
  await i.deferReply({flags:64});
  try {
    const name=i.commandName, uid=i.user.id, target=i.options.getString('framework');
    if (['join','request','revoke'].includes(name)) assertFramework(target);
    if (['pending','review','revoke'].includes(name)) {
      if (!human(uid)) throw new Error('Only allowlisted human reviewers may use this command.');
      if (i.channelId !== await resource('channel','access-review') && i.channelId !== await resource('channel','smith-controls')) throw new Error('Use the control room.');
    }
    if (name==='pending') {
      const r=await pool.query("SELECT id,user_id,framework FROM requests WHERE guild_id=$1 AND status='pending' ORDER BY id LIMIT 20",[guild.id]);
      await i.editReply(r.rows.map(x=>`${x.id}: ${x.user_id} → ${x.framework}`).join('\n') || 'No pending requests.'); return;
    }
    let subject=uid, request;
    if (name==='review') {
      const id=i.options.getString('id'); if (!/^\d+$/.test(id)) throw new Error('Invalid request ID.');
      request=(await pool.query('SELECT * FROM requests WHERE guild_id=$1 AND id=$2',[guild.id,id])).rows[0];
      if (!request) throw new Error('Request not found.');
      subject=request.user_id;
      if (subject===uid) throw new Error('Another allowlisted human must review your request.');
    }
    if (name==='revoke') { if (!cfg.owners.includes(uid)) throw new Error('Owner only.'); subject=i.options.getUser('user').id; }
    const result = await locked(`${guild.id}:${subject}`,async db=>{
      const member=await guild.members.fetch({user:subject,force:true});
      if (member.user.bot) throw new Error('Human members only.');
      await db.query('INSERT INTO members(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[guild.id,subject]);
      const m=(await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2 FOR UPDATE',[guild.id,subject])).rows[0];
      const held=frameworks.filter(f=>member.roles.cache.has(roleIds[f]));
       const add=async f=> { const role=assertAssignableRole(await guild.roles.fetch(roleIds[f])); await member.roles.add(role,'Agent Smith explicit access workflow'); };
      let reply;
      if (name==='accept') {
        await add('Member'); await db.query('UPDATE members SET accepted_at=now() WHERE guild_id=$1 AND user_id=$2',[guild.id,subject]); reply='Rules accepted. Use /join to choose Faith, Gaming, or Tech.';
      } else if (name==='join') {
        maySelfJoin({accepted:!!m.accepted_at,existing:[...held,...(m.primary_framework?[m.primary_framework]:[])],requested:target});
        await add(target);
        await db.query('UPDATE members SET primary_framework=$3 WHERE guild_id=$1 AND user_id=$2',[guild.id,subject,target]); reply=`Welcome to ${target}! Use /interest to select topics.`;
      } else if (name==='request') {
        if (!m.accepted_at || !m.primary_framework) throw new Error('Accept rules and choose your first framework before requesting another.');
        if (held.includes(target)) throw new Error('You already have this framework.');
        const r=await db.query("INSERT INTO requests(guild_id,user_id,framework) VALUES($1,$2,$3) ON CONFLICT (guild_id,user_id,framework) WHERE status='pending' DO UPDATE SET framework=EXCLUDED.framework RETURNING id",[guild.id,subject,target]);
        reply=`Request ${r.rows[0].id} is pending human review. No access was granted.`;
      } else if (name==='review') {
        request=(await db.query('SELECT * FROM requests WHERE id=$1 FOR UPDATE',[request.id])).rows[0];
        if (request.status!=='pending') throw new Error('Request already reviewed.');
        const approved=i.options.getBoolean('approve');
        if (approved) {
           assertFramework(request.framework);
          if (!m.accepted_at || !m.primary_framework) throw new Error('Member must complete onboarding first.');
          await add(request.framework);
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
    await i.editReply(result); await log(uid,name,{subject,framework:target,request:request?.id});
    if (name==='request') {
      const ch=await guild.channels.fetch(await resource('channel','access-review')); await ch.send({content:`New access request from ${uid} for ${target}. Use /pending and /review.`,allowedMentions:{parse:[]}});
    }
  } catch (e) { console.error('Command failed:',e.message); await i.editReply({content:`Unable to complete: ${e.message}`.slice(0,1900),allowedMentions:{parse:[]}}).catch(()=>{}); }
});
// No automatic roles on join: onboarding commands are the only self-service route.
client.on('guildMemberAdd', member=> { if(member.guild.id===guild.id) console.log(`Member joined ${member.id}; onboarding required.`); });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{client.destroy();await pool.end();process.exit(0);});
console.log('Agent Smith ready. No AI access-control path exists.');
