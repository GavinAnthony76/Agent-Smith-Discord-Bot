import { connect } from './discord.js';
import { pool, resource, locked, audit } from './db.js';
import { rankDefinitions, progressionConfig, faithDisclaimer } from './progression-config.js';
import { auditProgressionRoles } from './progression-worker.js';
const apply = process.argv.includes('--apply');
let client;
try {
  const connected = await connect({ allowWrites: apply });
  client = connected.client;
  const { guild, cfg } = connected;
  await guild.roles.fetch(); await guild.channels.fetch();
  const report = { created: 0, adopted: 0, existing: 0, names: rankDefinitions.map(d => d.name), applied: apply };
  await locked(`bootstrap:${guild.id}`, async db => {
    for (const { name } of rankDefinitions) {
      const tracked = (await db.query("SELECT discord_id FROM resources WHERE guild_id=$1 AND kind='role' AND name=$2", [guild.id, name])).rows[0];
      const candidates = guild.roles.cache.filter(r => r.name === name);
      if (candidates.size > 1) throw new Error(`Duplicate rank name: ${name}; no guessing or deletion.`);
      let role = tracked ? await guild.roles.fetch(tracked.discord_id) : candidates.first();
      if (role && (role.name !== name || role.managed || role.permissions.bitfield !== 0n || !role.editable
        || guild.channels.cache.some(c => c.permissionOverwrites.cache.get(role.id)?.allow.bitfield > 0n))) throw new Error(`Unsafe existing rank: ${name}`);
      if (tracked && !role) throw new Error(`Tracked rank missing: ${name}; resource identity will not be replaced automatically.`);
      if (tracked) report.existing++;
      else if (role) report.adopted++;
      else report.created++;
      if (!apply) continue;
      if (!role) role = await guild.roles.create({ name, permissions: [], mentionable: false, hoist: false, reason: 'Approved framework cosmetic progression; no access permissions' });
      if (!tracked) {
        await db.query("INSERT INTO resources(guild_id,kind,name,discord_id) VALUES($1,'role',$2,$3)", [guild.id, name, role.id]);
        await audit(db, cfg.clientId, 'rank-role-tracked', { framework: name.split(' • ')[0], name, role: role.id, outcome: 'tracked', amount: 0 });
      }
    }
    if (apply) {
      const existing = (await db.query("SELECT discord_id FROM resources WHERE guild_id=$1 AND kind='message' AND name='progression-guide'", [guild.id])).rows[0];
      if (!existing) {
        const channel = await guild.channels.fetch(await resource('channel', 'announcements', db));
        const message = await channel.send({ content: `**Framework progression**\nUse /ranks for all seven ladders, thresholds and earning rules, and /profile for your private progress. Each framework progresses independently. Rank roles grant no channel access or administrative powers.\n${faithDisclaimer}\nFaith levels 3–7 require explicit human approval; XP never bypasses membership approval.`, allowedMentions: { parse: [] } });
        await db.query("INSERT INTO resources(guild_id,kind,name,discord_id) VALUES($1,'message','progression-guide',$2)", [guild.id, message.id]);
      }
    }
  });
  if (apply) {
    const errors = await auditProgressionRoles({ guild, resource, config: progressionConfig });
    if (errors.length) throw new Error(errors.join('; '));
  }
  console.log(JSON.stringify(report));
} finally { client?.destroy(); await pool.end(); }
