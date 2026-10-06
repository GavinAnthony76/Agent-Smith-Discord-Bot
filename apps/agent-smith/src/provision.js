import { ChannelType, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { connect, overwrites, botPermissions } from './discord.js';
import { pool, resource, locked } from './db.js';
import { categories, roleNames, rules, frameworks, ARRIVAL_CHANNEL_ID, selectionRoleNames } from './blueprint.js';
import { onboardingMessage } from './onboarding.js';
import { accessRequestMessage } from './access-request.js';
import { communityChannels, starterChannels } from './community.js';
import { auditProgressionRoles } from './progression-worker.js';
import { progressionConfig } from './progression-config.js';
import { auditSecurity } from './security-audit.js';
import { isProtectedOwner } from './security-policy.js';
import { manualChannelPolicy } from './manual-channels.js';
const mode = process.argv[2];
if (!['bootstrap','audit'].includes(mode)) throw new Error('Invalid mode');
const apply = process.argv.includes('--apply');
const { client, guild, cfg } = await connect({ allowWrites: mode === 'bootstrap' && apply });
const types = { text: ChannelType.GuildText, forum: ChannelType.GuildForum, voice: ChannelType.GuildVoice };
let failures = [];
try {
  await locked(`bootstrap:${guild.id}`, async db => {
    const saved = (await db.query('SELECT * FROM resources WHERE guild_id=$1', [guild.id])).rows;
    if (mode === 'audit') {
      const security = await auditSecurity({ guild, client, cfg, rows: saved, pool });
      console.log('Security audit:', JSON.stringify(security, null, 2));
      failures.push(...security.failures);
    }
    const roles = {};
    // Persist each resource separately: successful Discord creates survive partial runs.
    const remember = (kind,name,id) => pool.query('INSERT INTO resources VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [guild.id,kind,name,id]);
    const community = communityChannels(guild, cfg, client.user.id);
    const starters = starterChannels(guild);
    for (const channel of starters) {
      const row = saved.find(x => x.kind === 'starter-channel' && x.name === channel.name);
      if (row && row.discord_id !== channel.id) throw new Error(`Starter channel identity changed: ${channel.name}; review required.`);
    }
    for (const [kind, name, channel] of [['channel', 'rules', community.rules], ['community-channel', 'moderator-only', community.updates]]) {
      const row = saved.find(x => x.kind === kind && x.name === name);
      if (row && row.discord_id !== channel.id) throw new Error(`Community channel identity changed: ${name}; review required.`);
    }
    if (mode === 'bootstrap') {
      console.log(JSON.stringify({ guild: guild.id, roles: roleNames, categories }, null, 2));
      if (process.env.BOOTSTRAP_CONFIRM_GUILD_ID !== guild.id) throw new Error('New guild confirmation missing');
      if (!guild.features.includes('COMMUNITY')) throw new Error('Enable Community first; forums require it.');
      if (!saved.some(x => ['role','channel'].includes(x.kind)) && (guild.channels.cache.size > 6 || guild.roles.cache.filter(r => !r.managed && r.id !== guild.id).size > 0 || guild.memberCount > 5)) throw new Error('Not a clean new server; bootstrap refused');
      const bot = await guild.members.fetchMe();
      const missing = bot.permissions.missing(botPermissions);
      if (missing.length) throw new Error(`Bot is missing required server permissions: ${missing.join(', ')}`);
      for (const name of roleNames) {
        if (!saved.some(x => x.kind === 'role' && x.name === name) && guild.roles.cache.some(r => r.name === name)) {
          throw new Error(`Untracked role collision: ${name}`);
        }
      }
      for (const name of categories.flatMap(cat => [cat.name, ...cat.channels.map(([name]) => name)])) {
        if (name === 'rules' || (name === 'arrival-lounge' && guild.channels.cache.get(ARRIVAL_CHANNEL_ID)?.name === name) || saved.some(x => x.kind === 'channel' && x.name === name)) continue;
        if (guild.channels.cache.some(c => c.name === name)) throw new Error(`Untracked channel collision: ${name}`);
      }
      console.log('Adopt existing Community #rules into START HERE with planned read-only permissions; preserve private #moderator-only without changes.');
      console.log('Preserve default starter channels/categories as staff-only:', starters.map(c => c.name).join(', '));
      console.log('Existing channels:', [...guild.channels.cache.values()].map(c => c.name).join(', '));
      console.log('Fixed target, owner, Community, clean-server, and bot permissions checks passed.');
      if (!apply) { console.log('PLAN ONLY. No Discord resources were changed.'); return; }
      await remember('community-channel', 'moderator-only', community.updates.id);
      for (const channel of starters) {
        if (saved.some(x => x.kind === 'starter-channel' && x.name === channel.name)) continue;
        await channel.edit({
          permissionOverwrites: overwrites(guild, cfg, client.user.id, 'staff', {}),
          reason: 'Agent Smith: preserve default starter channel contents with staff-only visibility'
        });
        await remember('starter-channel', channel.name, channel.id);
      }
    }
    for (const name of roleNames) {
      const row = saved.find(x => x.kind === 'role' && x.name === name);
      let role = row && guild.roles.cache.get(row.discord_id);
      if (!role && mode === 'bootstrap') {
        if (guild.roles.cache.some(r => r.name === name)) throw new Error(`Untracked role collision: ${name}`);
        role = await guild.roles.create({ name, permissions: [], mentionable: false, reason: 'Agent Smith new-server bootstrap' });
        await remember('role', name, role.id);
      }
      if (!role) { failures.push(`Missing role ${name}`); continue; }
      roles[name] = role.id;
      if (role.permissions.bitfield !== 0n || !role.editable) failures.push(`Role permission/hierarchy drift: ${name}`);
      if (selectionRoleNames.includes(name) && guild.channels.cache.some(c => c.permissionOverwrites.cache.get(role.id)?.allow.bitfield > 0n)) failures.push(`Selection role channel grant: ${name}`);
    }
    function compare(channel, expected) {
      const norm = arr => arr.map(x => {
        let allow = new PermissionsBitField(x.allow).bitfield;
        // Preserve owner-installed Manage Permissions on the bot itself in
        // existing starter channels; it is already required on the guild role.
        if (x.id === client.user.id) allow &= ~P.ManageRoles;
        return `${x.id}:${x.type}:${allow}:${new PermissionsBitField(x.deny).bitfield}`;
      }).sort().join('|');
      if (norm([...channel.permissionOverwrites.cache.values()]) !== norm(expected)) failures.push(`Permission drift: ${channel.name}`);
    }
    for (const cat of categories) {
      const definitions = [[cat.name, ChannelType.GuildCategory, false], ...cat.channels.map(([n,t,ro]) => [n,types[t],ro])];
      let parent;
      for (const [name,type,readonly] of definitions) {
        const row = saved.find(x => x.kind === 'channel' && x.name === name);
        let channel = row && guild.channels.cache.get(row.discord_id);
        if (cat.gate && cat.gate !== 'staff' && !roles[cat.gate]) continue;
        const expected = overwrites(guild,cfg,client.user.id,cat.gate,roles,readonly);
        if (!channel && mode === 'bootstrap' && name === 'arrival-lounge') {
          channel = guild.channels.cache.get(ARRIVAL_CHANNEL_ID);
          if (!channel || channel.type !== ChannelType.GuildText || channel.name !== name || channel.rateLimitPerUser !== 5
            || !channel.permissionsFor(guild.roles.everyone).has([P.ViewChannel,P.ReadMessageHistory,P.SendMessages])) throw new Error('Authorized arrival channel must already be public with 5-second slowmode; no replacement is permitted.');
          await channel.edit({parent,lockPermissions:false,reason:'Adopt authorized public arrival channel without replacing overwrites'});
          await remember('channel',name,channel.id);
        }
        if (!channel && mode === 'bootstrap' && name === 'rules') {
          channel = await community.rules.edit({
            parent, permissionOverwrites: expected,
            reason: 'Agent Smith: adopt confirmed Community rules channel without deleting messages'
          });
          await remember('channel', name, channel.id);
        }
        if (!channel && mode === 'bootstrap') {
          if (guild.channels.cache.some(c => c.name === name)) throw new Error(`Untracked channel collision: ${name}`);
          channel = await guild.channels.create({ name,type,parent,permissionOverwrites:expected,
            ...(type === ChannelType.GuildForum ? { topic: 'Start a focused post. Keep replies in its thread.', availableTags: [{name:'Discussion'},{name:'Question'},{name:'Event'}] } : {}),
            reason: 'Agent Smith new-server bootstrap' });
          await remember('channel',name,channel.id);
        }
        if (!channel) { failures.push(`Missing channel ${name}`); continue; }
        if (channel.type !== type || (parent && channel.parentId !== parent)) failures.push(`Structure drift: ${name}`);
        if (name === 'arrival-lounge') {
          if (channel.id !== ARRIVAL_CHANNEL_ID || channel.rateLimitPerUser !== 5 || !channel.permissionsFor(guild.roles.everyone).has([P.ViewChannel,P.ReadMessageHistory,P.SendMessages])) failures.push('Arrival identity/slowmode/public permission drift.');
        } else compare(channel,expected);
        if (type === ChannelType.GuildCategory) parent = channel.id;
      }
    }
    if (mode === 'bootstrap') {
      for (const [name, content] of Object.entries({welcome:'Welcome to Hallowed Core, the shared home of Faith, Gaming, and Tech. Start in #rules, then use /accept and /join in #onboarding.',rules,onboarding:'Use /accept, then /join. Use /interest after joining. /request asks an allowlisted human for additional access.', 'access-requests':'Use /request framework:<name>. Requests are private; reviewers use /pending and /review in the control room.'})) {
        if (saved.some(x => x.kind === 'message' && x.name === name)) continue;
        const channel = await guild.channels.fetch(await resource('channel',name));
        const msg = await channel.send(name === 'onboarding' ? onboardingMessage()
          : name === 'access-requests' ? accessRequestMessage() : {content,allowedMentions:{parse:[]}});
        await remember('message',name,msg.id);
      }
    }
    if (mode === 'audit') {
      failures.push(...await auditProgressionRoles({ guild, resource, config: progressionConfig }));
      await guild.members.fetch();
      for (const member of guild.members.cache.values()) {
        if (member.user.bot || isProtectedOwner(guild,member.id)) continue;
        const held = frameworks.filter(f => member.roles.cache.has(roles[f]));
        const record = (await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2',[guild.id,member.id])).rows[0];
        const grants = (await db.query('SELECT framework FROM grants WHERE guild_id=$1 AND user_id=$2',[guild.id,member.id])).rows.map(x=>x.framework);
        if (held.some(f => !record?.accepted_at || (record.primary_framework !== f && !grants.includes(f)))) failures.push(`Unrecorded framework access: ${member.id}`);
        if (member.permissions.has('Administrator') && !cfg.owners.includes(member.id)) failures.push(`Administrator bypass: ${member.id}`);
      }
      if (!saved.some(x => x.kind === 'community-channel' && x.name === 'moderator-only' && x.discord_id === community.updates.id)) failures.push('Community Updates channel is not tracked.');
      for (const row of saved.filter(x => x.kind === 'starter-channel')) {
        const channel = guild.channels.cache.get(row.discord_id);
        if (!channel || channel.name !== row.name) failures.push(`Missing/renamed preserved starter: ${row.name}`);
        else compare(channel, overwrites(guild, cfg, client.user.id, 'staff', {}));
      }
      const known = new Set(saved.filter(x=>['channel','community-channel','starter-channel'].includes(x.kind)).map(x=>x.discord_id));
      for (const channel of guild.channels.cache.values()) {
        if (known.has(channel.id) || manualChannelPolicy(guild, channel)) continue;
        failures.push(`Unreviewed manual channel (review visibility manually): ${channel.name}`);
      }
    }
  });
  console.log(failures.length ? failures.join('\n') : 'Checks passed.');
  if (failures.length) process.exitCode = 1;
} finally { client.destroy(); await pool.end(); }
