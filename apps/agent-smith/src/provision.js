import { ChannelType, PermissionsBitField } from 'discord.js';
import { connect, overwrites } from './discord.js';
import { pool, resource, locked } from './db.js';
import { categories, roleNames, rules, frameworks } from './blueprint.js';
const mode = process.argv[2];
if (!['bootstrap','audit'].includes(mode)) throw new Error('Invalid mode');
const apply = process.argv.includes('--apply');
const { client, guild, cfg } = await connect({ allowWrites: mode === 'bootstrap' && apply });
const types = { text: ChannelType.GuildText, forum: ChannelType.GuildForum, voice: ChannelType.GuildVoice };
let failures = [];
try {
  await locked(`bootstrap:${guild.id}`, async db => {
    const saved = (await db.query('SELECT * FROM resources WHERE guild_id=$1', [guild.id])).rows;
    const roles = {};
    // Persist each resource separately: successful Discord creates survive partial runs.
    const remember = (kind,name,id) => pool.query('INSERT INTO resources VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [guild.id,kind,name,id]);
    if (mode === 'bootstrap') {
      console.log(JSON.stringify({ guild: guild.id, roles: roleNames, categories }, null, 2));
      if (!apply) { console.log('PLAN ONLY. Re-run with --apply after setting BOOTSTRAP_CONFIRM_GUILD_ID.'); return; }
      if (process.env.BOOTSTRAP_CONFIRM_GUILD_ID !== guild.id) throw new Error('New guild confirmation missing');
      if (!guild.features.includes('COMMUNITY')) throw new Error('Enable Community first; forums require it.');
      if (!saved.length && (guild.channels.cache.size > 6 || guild.roles.cache.filter(r => !r.managed && r.id !== guild.id).size > 0 || guild.memberCount > 5)) throw new Error('Not a clean new server; bootstrap refused');
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
    }
    function compare(channel, expected) {
      const norm = arr => arr.map(x => `${x.id}:${new PermissionsBitField(x.allow).bitfield}:${new PermissionsBitField(x.deny).bitfield}`).sort().join('|');
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
        if (!channel && mode === 'bootstrap') {
          if (guild.channels.cache.some(c => c.name === name)) throw new Error(`Untracked channel collision: ${name}`);
          channel = await guild.channels.create({ name,type,parent,permissionOverwrites:expected,
            ...(type === ChannelType.GuildForum ? { topic: 'Start a focused post. Keep replies in its thread.', availableTags: [{name:'Discussion'},{name:'Question'},{name:'Event'}] } : {}),
            reason: 'Agent Smith new-server bootstrap' });
          await remember('channel',name,channel.id);
        }
        if (!channel) { failures.push(`Missing channel ${name}`); continue; }
        if (channel.type !== type || (parent && channel.parentId !== parent)) failures.push(`Structure drift: ${name}`);
        compare(channel,expected);
        if (type === ChannelType.GuildCategory) parent = channel.id;
      }
    }
    if (mode === 'bootstrap') {
      for (const [name, content] of Object.entries({welcome:'Welcome to Hallowed Core, the shared home of Faith, Gaming, and Tech. Start in #rules, then use /accept and /join in #onboarding.',rules,onboarding:'Use /accept, then /join. Use /interest after joining. /request asks an allowlisted human for additional access.', 'access-requests':'Use /request framework:<name>. Requests are private; reviewers use /pending and /review in the control room.'})) {
        if (saved.some(x => x.kind === 'message' && x.name === name)) continue;
        const channel = await guild.channels.fetch(await resource('channel',name));
        const msg = await channel.send({content,allowedMentions:{parse:[]}});
        await remember('message',name,msg.id);
      }
    }
    if (mode === 'audit') {
      await guild.members.fetch();
      for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;
        const held = frameworks.filter(f => member.roles.cache.has(roles[f]));
        const record = (await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2',[guild.id,member.id])).rows[0];
        const grants = (await db.query('SELECT framework FROM grants WHERE guild_id=$1 AND user_id=$2',[guild.id,member.id])).rows.map(x=>x.framework);
        if (held.some(f => !record?.accepted_at || (record.primary_framework !== f && !grants.includes(f)))) failures.push(`Unrecorded framework access: ${member.id}`);
        if (member.permissions.has('Administrator') && !cfg.owners.includes(member.id)) failures.push(`Administrator bypass: ${member.id}`);
      }
      const known = new Set(saved.filter(x=>x.kind==='channel').map(x=>x.discord_id));
      for (const channel of guild.channels.cache.values()) if (!known.has(channel.id)) failures.push(`Unmanaged channel (review visibility manually): ${channel.name}`);
    }
  });
  console.log(failures.length ? failures.join('\n') : 'Checks passed.');
  if (failures.length) process.exitCode = 1;
} finally { client.destroy(); await pool.end(); }
