import { SlashCommandBuilder, PermissionFlagsBits as P } from 'discord.js';
import { assertModerator } from './moderation-policy.js';
import { assertStaffChannel } from './permissions.js';
import { CONTENT_ACTIONS } from './content-automod.js';
import { assertOwnerConfiguration } from './security-policy.js';

export const AUTOMOD_ACTIONS = Object.freeze(['log-only','escalate']);
export const smithControlCommand = new SlashCommandBuilder().setName('smith-control')
  .setDescription('Owner-only audited operational settings').setDMPermission(false).setDefaultMemberPermissions(P.Administrator)
  .addSubcommand(s=>s.setName('feed-save').setDescription('Save a disabled public RSS/Atom source; edits require fresh approval')
    .addStringOption(o=>o.setName('id').setDescription('Lowercase source ID').setRequired(true).setMaxLength(40))
    .addStringOption(o=>o.setName('url').setDescription('Public HTTPS feed, port 443 only').setRequired(true).setMaxLength(2048))
    .addStringOption(o=>o.setName('destination').setDescription('Existing framework news channel').setRequired(true)
      .addChoices(...['faith-news','gaming-news','tech-news'].map(value=>({name:value,value}))))
    .addIntegerOption(o=>o.setName('minutes').setDescription('Poll interval, default 15 minutes').setMinValue(5).setMaxValue(1440))
    .addBooleanOption(o=>o.setName('threads').setDescription('Optional public discussion threads, default off; permissions checked')))
  .addSubcommand(s=>s.setName('feed-enable').setDescription('Explicit Owner approval or disable a saved source')
    .addStringOption(o=>o.setName('id').setDescription('Saved source ID').setRequired(true).setMaxLength(40))
    .addBooleanOption(o=>o.setName('enabled').setDescription('Approve and start polling, or stop it').setRequired(true)))
  .addSubcommand(s=>s.setName('feed-status').setDescription('Source approvals, polling health and held uncertain deliveries')
    .addStringOption(o=>o.setName('id').setDescription('Optional source ID').setMaxLength(40))
    .addIntegerOption(o=>o.setName('page').setDescription('Browse sources and held deliveries, five per page').setMinValue(1).setMaxValue(10000)))
  .addSubcommand(s=>s.setName('feed-resolve').setDescription('Review an unconfirmed delivery; never reposts it')
    .addStringOption(o=>o.setName('id').setDescription('Source ID from feed-status').setRequired(true).setMaxLength(40))
    .addStringOption(o=>o.setName('receipt').setDescription('Delivery receipt number from feed-status').setRequired(true).setMaxLength(19))
    .addStringOption(o=>o.setName('message').setDescription('Existing Smith message ID, verified against saved content').setMaxLength(20))
    .addBooleanOption(o=>o.setName('skip').setDescription('Explicitly suppress this entry permanently instead of confirming a message')))
  .addSubcommand(s=>s.setName('request-expiry').setDescription('Expiry window for new access requests; existing deadlines stay unchanged')
    .addIntegerOption(o=>o.setName('days').setDescription('Default 14 days').setRequired(true).setMinValue(1).setMaxValue(90)))
  .addSubcommand(s=>s.setName('automod').setDescription('Configure alerts only; no automatic punishment')
    .addStringOption(o=>o.setName('category').setDescription('Signal class').setRequired(true).addChoices(
      {name:'Message bursts',value:'burst'},{name:'Mass mentions',value:'mentions'}))
    .addStringOption(o=>o.setName('action').setDescription('Only passive actions are permitted').setRequired(true)
      .addChoices(...AUTOMOD_ACTIONS.map(value=>({name:value,value}))))
    .addChannelOption(o=>o.setName('channel').setDescription('Existing private #automod-escalations channel'))
    .addRoleOption(o=>o.setName('moderators').setDescription('Existing mentionable on-duty moderator role')))
  .addSubcommand(s=>s.setName('status').setDescription('Show expiry and passive automod settings'))
  .addSubcommand(s=>s.setName('panel').setDescription('Ephemeral authorized maintenance panel'))
  .addSubcommand(s=>s.setName('economy').setDescription('Enable/disable cosmetic-only credits')
   .addBooleanOption(o=>o.setName('enabled').setDescription('Enable optional credits').setRequired(true)))
  .addSubcommand(s=>s.setName('shop-item').setDescription('Configure a cosmetic profile badge, never a Discord role')
   .addStringOption(o=>o.setName('id').setDescription('Lowercase item ID').setRequired(true).setMaxLength(40))
   .addStringOption(o=>o.setName('title').setDescription('Cosmetic badge title').setRequired(true).setMaxLength(80))
   .addIntegerOption(o=>o.setName('price').setDescription('Community credit cost').setRequired(true).setMinValue(1).setMaxValue(100000)))
  .addSubcommand(s=>s.setName('rules-version').setDescription('Set version for explicit rules acknowledgment')
   .addStringOption(o=>o.setName('version').setDescription('Version identifier').setRequired(true).setMaxLength(40)))
  .addSubcommand(s=>s.setName('staged-onboarding').setDescription('Owner-approved additional steps for NEW members only')
   .addBooleanOption(o=>o.setName('enabled').setDescription('Require rules acknowledgment/interests before activation').setRequired(true))
   .addRoleOption(o=>o.setName('arrival').setDescription('Existing permission-free NEW ARRIVAL role, required when enabling')))
  .addSubcommand(s=>s.setName('content-automod').setDescription('Configure deterministic content rules; defaults remain disabled/LOG')
   .addBooleanOption(o=>o.setName('enabled').setDescription('Requires Message Content intent in Portal and runtime').setRequired(true))
   .addStringOption(o=>o.setName('rule').setDescription('Rule').setRequired(true).addChoices(...['external-invite','banned-word','blocked-domain','mass-mention','message-flood','duplicate-spam','emoji-flood','caps-flood','scam-pattern'].map(value=>({name:value,value}))))
   .addStringOption(o=>o.setName('action').setDescription('Explicit Owner-authorized action').setRequired(true).addChoices(...CONTENT_ACTIONS.map(value=>({name:value,value}))))
   .addStringOption(o=>o.setName('terms').setDescription('Comma-separated words, blocked domains or scam phrases for selected rule').setMaxLength(1000))
   .addStringOption(o=>o.setName('invites').setDescription('Comma-separated allowed internal invite codes').setMaxLength(300))
   .addChannelOption(o=>o.setName('exclude').setDescription('Add an excluded channel')))
  .addSubcommand(s=>s.setName('text-xp').setDescription('Opt-in fair text XP; requires Message Content')
   .addBooleanOption(o=>o.setName('enabled').setDescription('Enable 60-second cooldown, capped text XP').setRequired(true))
   .addChannelOption(o=>o.setName('exclude').setDescription('Add an excluded channel')));

export function assertAutomodAction(action) {
  if (!AUTOMOD_ACTIONS.includes(action)) throw new Error('Automod is alerts-only: delete, warn, timeout, kick and ban are disabled.');
}
export function createSmithControl({guild,cfg,pool,resource,feeds}) {
  return {async handle(i) {
    try {
      if(i.guildId!==guild.id || i.user.bot) throw new Error('Authorized server and human owners only.');
      assertModerator(i.user.id,cfg);
      if(i.channelId!==await resource('channel','smith-controls')) throw new Error('Use #smith-controls.');
      await i.deferReply({flags:64});
      await guild.fetch();assertOwnerConfiguration(cfg,guild.ownerId);
      const sub=i.options.getSubcommand();
      if(sub.startsWith('feed-')) {
        if(!feeds)throw new Error('Integrated feed worker unavailable.');
        let content;
        const id=i.options.getString('id');
        if(sub!=='feed-status'&&!/^[a-z0-9-]{1,40}$/.test(id??''))throw new Error('Invalid source ID.');
        if(sub==='feed-save') {
          await feeds.save({id,url:i.options.getString('url',true),destination:i.options.getString('destination',true),
            interval:i.options.getInteger('minutes')??15,threads:i.options.getBoolean('threads')??false},i.user.id);
          content=`Saved ${id} disabled. Review /smith-control feed-status, then explicitly approve with feed-enable. Existing history is preserved.`;
        } else if(sub==='feed-enable') {
          const enabled=i.options.getBoolean('enabled',true);
          await feeds.approve(id,enabled,i.user.id);
          content=`${id}: ${enabled?'Owner-approved; integrated polling enabled (up to five recent entries on first poll)':'disabled; history retained'}.`;
        } else if(sub==='feed-resolve') {
          const messageId=i.options.getString('message'),skip=i.options.getBoolean('skip')??false;
          if(skip&&messageId||!skip&&!messageId)throw new Error('Choose an existing message ID OR skip=true.');
          await feeds.resolve(id,i.options.getString('receipt',true),i.user.id,{messageId,skip});
          content='Delivery review saved and audited. No new post or thread was created.';
        } else if(sub==='feed-status')content=await feeds.status(id,i.options.getInteger('page')??1);
        else throw new Error('Unknown feed control.');
        await i.editReply({content:content.slice(0,1900),allowedMentions:{parse:[]}});return;
      }
      if(sub==='status') {
        const rows=(await pool.query('SELECT key,value FROM bot_settings WHERE guild_id=$1 ORDER BY key',[guild.id])).rows;
        await i.editReply({content:`**Operational settings**\nFeeds: integrated polling; /smith-control feed-status for approval and delivery health.\n${rows.map(r=>`${r.key}: ${JSON.stringify(r.value)}`).join('\n')||'Defaults: request expiry 14 days; automod alerts-only.'}\nAutomatic punishments and AI execution remain disabled.`.slice(0,1900),allowedMentions:{parse:[]}});return;
      }
      let key,value;
      if(sub==='text-xp') {
        const enabled=i.options.getBoolean('enabled',true);
        if(enabled&&!cfg.contentEnabled)throw new Error('Enable Message Content in Portal/runtime before text XP.');
        key='text-xp';value=(await pool.query('SELECT value FROM bot_settings WHERE guild_id=$1 AND key=$2',[guild.id,key])).rows[0]?.value??{};
        value={...value,enabled};
        const excluded=i.options.getChannel('exclude');if(excluded)value.excludedChannels=[...new Set([...(value.excludedChannels??[]),excluded.id])];
      } else if(sub==='economy') {key='economy-enabled';value=i.options.getBoolean('enabled',true);}
      else if(sub==='shop-item') {
        const id=i.options.getString('id',true),title=i.options.getString('title',true),price=i.options.getInteger('price',true);
        if(!/^[a-z0-9-]{1,40}$/.test(id)||!title.trim()||!Number.isInteger(price)||price<1||price>100000)throw new Error('Invalid cosmetic badge.');
        await pool.query('INSERT INTO community_shop(guild_id,item_id,title,price) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id,item_id) DO UPDATE SET title=EXCLUDED.title,price=EXCLUDED.price',[guild.id,id,title,price]);
        key=`shop:${id}`;value={title,price,type:'profile-badge'};
      } else if(sub==='rules-version') {
        key='rules-version';value=i.options.getString('version',true);
        if(!/^[a-zA-Z0-9._-]{1,40}$/.test(value))throw new Error('Version must be 1–40 letters/digits/dots/hyphens.');
      } else if(sub==='staged-onboarding') {
        key='staged-onboarding';value=i.options.getBoolean('enabled',true);
        if(value) {
          const role=i.options.getRole('arrival');
          const bot=await guild.members.fetchMe({force:true});
          if(!role||role.name!=='NEW ARRIVAL'||role.managed||!role.editable||role.permissions.bitfield!==0n||role.position>=bot.roles.highest.position
            ||guild.channels.cache.some(c=>c.permissionOverwrites.cache.get(role.id)?.allow.bitfield>0n))throw new Error('Choose an existing permission-free NEW ARRIVAL role below Smith with no channel access grants.');
          await pool.query("INSERT INTO resources(guild_id,kind,name,discord_id) VALUES($1,'role','NEW ARRIVAL',$2) ON CONFLICT(guild_id,kind,name) DO UPDATE SET discord_id=EXCLUDED.discord_id",[guild.id,role.id]);
        }
      } else if(sub==='content-automod') {
        const enabled=i.options.getBoolean('enabled',true),rule=i.options.getString('rule',true),action=i.options.getString('action',true);
        if(enabled&&!cfg.contentEnabled)throw new Error('Enable Message Content in Developer Portal and runtime first; no privileged intent is silently enabled.');
        if(!['external-invite','banned-word','blocked-domain','mass-mention','message-flood','duplicate-spam','emoji-flood','caps-flood','scam-pattern'].includes(rule)||!CONTENT_ACTIONS.includes(action))throw new Error('Unknown content rule/action.');
        key='content-automod';value=(await pool.query('SELECT value FROM bot_settings WHERE guild_id=$1 AND key=$2',[guild.id,key])).rows[0]?.value??{};
        value={...value,enabled,configuredBy:i.user.id,actions:{...value.actions,[rule]:action}};
        const terms=i.options.getString('terms');
        if(terms) {
          const list=terms.split(',').map(x=>x.trim()).filter(Boolean);
          if(list.length>25||list.some(x=>x.length>120))throw new Error('At most 25 bounded terms; regex is not supported.');
          const field={'banned-word':'bannedWords','blocked-domain':'blockedDomains','scam-pattern':'scamPhrases'}[rule];
          if(!field)throw new Error('Terms apply to word/domain/scam lists only.');value[field]=list;
        }
        const invites=i.options.getString('invites');if(invites)value.allowedInviteCodes=invites.split(',').map(x=>x.trim()).filter(Boolean);
        const exclude=i.options.getChannel('exclude');if(exclude)value.excludedChannels=[...new Set([...(value.excludedChannels??[]),exclude.id])];
      } else if(sub==='request-expiry') {
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
      await i.editReply({content:`Saved ${key}. Existing access and request deadlines are unchanged. Content actions remain disabled unless explicitly enabled in both runtime and Owner configuration.`,allowedMentions:{parse:[]}});
    }catch(error){
      const reply={content:`Unable to complete: ${error.message}`.slice(0,1900),allowedMentions:{parse:[]}};
      if(i.deferred||i.replied)await i.editReply(reply).catch(()=>{});else await i.reply({...reply,flags:64}).catch(()=>{});
    }
  }};
}
