import { SlashCommandBuilder, PermissionFlagsBits as P } from 'discord.js';
import { assertModerator } from './moderation-policy.js';
import { assertStaffChannel } from './permissions.js';
import { assertOwnerConfiguration } from './security-policy.js';

export const AUTOMOD_ACTIONS = Object.freeze(['log-only','escalate']);
export const smithControlCommand = new SlashCommandBuilder().setName('smith-control')
  .setDescription('Owner-only audited operational settings').setDMPermission(false).setDefaultMemberPermissions(P.Administrator)
  .addSubcommand(s=>s.setName('request-expiry').setDescription('Expiry window for new access requests; existing deadlines stay unchanged')
    .addIntegerOption(o=>o.setName('days').setDescription('Default 14 days').setRequired(true).setMinValue(1).setMaxValue(90)))
  .addSubcommand(s=>s.setName('automod').setDescription('Configure alerts only; no automatic punishment')
    .addStringOption(o=>o.setName('category').setDescription('Signal class').setRequired(true).addChoices(
      {name:'Message bursts',value:'burst'},{name:'Mass mentions',value:'mentions'}))
    .addStringOption(o=>o.setName('action').setDescription('Only passive actions are permitted').setRequired(true)
      .addChoices(...AUTOMOD_ACTIONS.map(value=>({name:value,value}))))
    .addChannelOption(o=>o.setName('channel').setDescription('Existing private #automod-escalations channel'))
    .addRoleOption(o=>o.setName('moderators').setDescription('Existing mentionable on-duty moderator role')))
  .addSubcommand(s=>s.setName('status').setDescription('Show expiry and passive automod settings'));

export function assertAutomodAction(action) {
  if (!AUTOMOD_ACTIONS.includes(action)) throw new Error('Automod is alerts-only: delete, warn, timeout, kick and ban are disabled.');
}
export function createSmithControl({guild,cfg,pool,resource}) {
  return {async handle(i) {
    try {
      if(i.guildId!==guild.id || i.user.bot) throw new Error('Authorized server and human owners only.');
      assertModerator(i.user.id,cfg);
      if(i.channelId!==await resource('channel','smith-controls')) throw new Error('Use #smith-controls.');
      await i.deferReply({flags:64});
      await guild.fetch();assertOwnerConfiguration(cfg,guild.ownerId);
      const sub=i.options.getSubcommand();
      if(sub==='status') {
        const rows=(await pool.query('SELECT key,value FROM bot_settings WHERE guild_id=$1 ORDER BY key',[guild.id])).rows;
        await i.editReply({content:`**Operational settings**\n${rows.map(r=>`${r.key}: ${JSON.stringify(r.value)}`).join('\n')||'Defaults: request expiry 14 days; automod alerts-only.'}\nAutomatic punishments and AI execution remain disabled.`.slice(0,1900),allowedMentions:{parse:[]}});return;
      }
      let key,value;
      if(sub==='request-expiry') {
        const days=i.options.getInteger('days',true);
        if(!Number.isInteger(days)||days<1||days>90)throw new Error('Choose 1–90 days.');
        key='request-expiry';value={days};
      } else if(sub==='automod') {
        const category=i.options.getString('category',true),action=i.options.getString('action',true);
        if(!['burst','mentions'].includes(category))throw new Error('Unknown automod category.');
        assertAutomodAction(action);
        key=`automod:${category}`;value={action};
        if(action==='escalate') {
          const selection=i.options.getChannel('channel'),selectedRole=i.options.getRole('moderators');
          if(!selection || !selectedRole)throw new Error('Choose a private #automod-escalations channel and an on-duty moderator role.');
          await guild.roles.fetch();await guild.fetch();
          const channel=await guild.channels.fetch(selection.id),role=guild.roles.cache.get(selectedRole.id);
          if(channel.name!=='automod-escalations' || !role || role.id===guild.id || role.managed || !role.mentionable)throw new Error('Use #automod-escalations and a mentionable non-managed moderator role, not @everyone.');
          assertStaffChannel(channel,guild,cfg,role.id);
          value={action,channelId:channel.id,moderatorRoleId:role.id};
        }
      } else throw new Error('Unknown operational setting.');
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('INSERT INTO bot_settings(guild_id,key,value) VALUES($1,$2,$3) ON CONFLICT(guild_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',[guild.id,key,JSON.stringify(value)]);
        await db.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)',[guild.id,i.user.id,'settings.changed',JSON.stringify({key,value})]);
        await db.query('COMMIT');
      } catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
      await i.editReply({content:`Saved ${key}. Existing access and request deadlines are unchanged. Automod remains alerts-only.`,allowedMentions:{parse:[]}});
    }catch(error){
      const reply={content:`Unable to complete: ${error.message}`.slice(0,1900),allowedMentions:{parse:[]}};
      if(i.deferred||i.replied)await i.editReply(reply).catch(()=>{});else await i.reply({...reply,flags:64}).catch(()=>{});
    }
  }};
}
