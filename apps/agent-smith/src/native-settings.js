import { ChannelType, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { categories, frameworks, interests, roleNames, ARRIVAL_CHANNEL_ID } from './blueprint.js';
import { overwrites } from './discord.js';
import { pool } from './db.js';
import { nativeQuestionErrors, nativeDefaultChannelErrors } from './native-policy.js';

export async function nativeSettings({ client, guild, cfg }) {
  await guild.fetch();
  await guild.roles.fetch();
  await guild.channels.fetch();
  const rows = (await pool.query('SELECT * FROM resources WHERE guild_id=$1', [guild.id])).rows;
  const id = (kind, name) => rows.find(r => r.kind === kind && r.name === name)?.discord_id;
  const roles = Object.fromEntries(roleNames.map(name => [name, id('role', name)]));
  const selections = Object.fromEntries(frameworks.map(f => [f, roles[`Selection: ${f}`]]));
  const cosmeticIds = Object.values(interests).flat().map(name => roles[`Interest: ${name}`]).filter(Boolean);
  const safetyErrors = [];
  for (const name of roleNames) {
    const role = guild.roles.cache.get(roles[name]);
    if (!role || role.name !== name || role.managed || role.permissions.bitfield !== 0n || !role.editable) safetyErrors.push(`Unsafe/missing tracked role: ${name}`);
  }
  for (const f of frameworks) {
    const selectionId = selections[f];
    if (selectionId && guild.channels.cache.some(c => c.permissionOverwrites.cache.get(selectionId)?.allow.bitfield > 0n)) {
      safetyErrors.push(`Selection: ${f} has channel grants; remove those grants before proceeding.`);
    }
  }
  for (const roleId of cosmeticIds) {
    if (guild.channels.cache.some(c => {
      const overwrite = c.permissionOverwrites.cache.get(roleId);
      return overwrite && (overwrite.allow.bitfield !== 0n || overwrite.deny.bitfield !== 0n);
    })) safetyErrors.push(`Cosmetic interest changes channel permissions: ${guild.roles.cache.get(roleId)?.name}`);
  }
  const norm = entries => entries.map(e => {
    let allow = new PermissionsBitField(e.allow).bitfield;
    if (e.id === client.user.id) allow &= ~P.ManageRoles;
    return `${e.id}:${e.type}:${allow}:${new PermissionsBitField(e.deny).bitfield}`;
  }).sort().join('|');
  const publicIds = [];
  for (const cat of categories) {
    const parent = id('channel', cat.name);
    for (const [name, type, readonly] of [[cat.name, 'category', false], ...cat.channels]) {
      const channel = guild.channels.cache.get(id('channel', name));
      if (!channel) { safetyErrors.push(`Missing tracked channel: ${name}`); continue; }
      const expectedType = { category: ChannelType.GuildCategory, text: ChannelType.GuildText, forum: ChannelType.GuildForum, voice: ChannelType.GuildVoice }[type];
      if (channel.name !== name || channel.type !== expectedType || (type !== 'category' && channel.parentId !== parent)) safetyErrors.push(`Channel identity/structure drift: ${name}`);
      if (name === 'arrival-lounge') {
        const everyone = channel.permissionsFor(guild.roles.everyone);
        if (channel.id !== ARRIVAL_CHANNEL_ID || channel.rateLimitPerUser !== 5 || !everyone?.has([P.ViewChannel, P.ReadMessageHistory, P.SendMessages])) {
          safetyErrors.push('Arrival lounge must be the authorized public text channel with history, send permission and 5-second slowmode.');
        }
        // Adopt the owner's public channel without replacing its custom
        // overwrites. Dangerous public administrative permissions still fail.
        if (everyone?.has(P.Administrator) || everyone?.has(P.ManageChannels) || everyone?.has(P.ManageRoles)) safetyErrors.push('Unsafe public arrival permissions.');
      } else if (norm([...channel.permissionOverwrites.cache.values()]) !== norm(overwrites(guild, cfg, client.user.id, cat.gate, roles, readonly))) {
        safetyErrors.push(`Permission drift: ${name}`);
      }
      if (!cat.gate && type === 'text') publicIds.push(channel.id);
    }
  }
  const updates = guild.channels.cache.get(id('community-channel', 'moderator-only'));
  if (!updates || updates.id !== guild.publicUpdatesChannelId || updates.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) safetyErrors.push('Private Community Updates identity/visibility drift.');
  for (const row of rows.filter(r => r.kind === 'starter-channel')) {
    const ch = guild.channels.cache.get(row.discord_id);
    if (!ch || norm([...ch.permissionOverwrites.cache.values()]) !== norm(overwrites(guild, cfg, client.user.id, 'staff', {}))) safetyErrors.push(`Preserved starter drift: ${row.name}`);
  }
  await guild.members.fetch();
  const records = (await pool.query('SELECT * FROM members WHERE guild_id=$1', [guild.id])).rows;
  const grants = (await pool.query('SELECT user_id,framework FROM grants WHERE guild_id=$1', [guild.id])).rows;
  let unrecorded = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const record = records.find(r => r.user_id === member.id);
    const held = frameworks.filter(f => member.roles.cache.has(roles[f]));
    if (held.some(f => !record?.accepted_at || (record.primary_framework !== f && !grants.some(g => g.user_id === member.id && g.framework === f)))) unrecorded++;
    if (member.permissions.has(P.Administrator) && !cfg.owners.includes(member.id)) safetyErrors.push('An unallowlisted member has Administrator bypass.');
  }
  if (unrecorded) safetyErrors.push(`Framework assignments lack matching onboarding/human-grant records for ${unrecorded} existing human member(s); preserve roles and require human review.`);
  const onboarding = await client.rest.get(`/guilds/${guild.id}/onboarding`);
  const publicationErrors = nativeQuestionErrors(onboarding, selections, cosmeticIds);
  if (!guild.features.includes('MEMBER_VERIFICATION_GATE_ENABLED')) publicationErrors.push('Rules screening must be enabled before cutover.');
  for (const channelId of [...(onboarding.default_channel_ids ?? []), ...onboarding.prompts.flatMap(p => p.options.flatMap(o => o.channel_ids ?? []))]) {
    if (!publicIds.includes(channelId)) publicationErrors.push('Native defaults/answers reference a non-public entry channel.');
  }
  for (const name of ['welcome', 'onboarding', 'arrival-lounge']) {
    if (!onboarding.default_channel_ids.includes(id('channel', name))) publicationErrors.push(`Add ${name} as a native default channel.`);
  }
  if (onboarding.mode === 0) {
    const defaults = [...new Set(onboarding.default_channel_ids)];
    const writable = defaults.filter(channelId => guild.channels.cache.get(channelId)?.permissionsFor(guild.roles.everyone)?.has([P.ViewChannel, P.SendMessages])).length;
    publicationErrors.push(...nativeDefaultChannelErrors(onboarding, defaults.length, writable));
  }
  const guideChannels = ['welcome', 'rules', 'onboarding', 'arrival-lounge'].map(name => {
    const ch = guild.channels.cache.get(id('channel', name) ?? (name === 'arrival-lounge' ? ARRIVAL_CHANNEL_ID : undefined));
    const p = ch?.permissionsFor(guild.roles.everyone);
    return { name, view: p?.has(P.ViewChannel) ?? false, history: p?.has(P.ReadMessageHistory) ?? false, send: p?.has(P.SendMessages) ?? false };
  });
  return { safetyErrors: [...new Set(safetyErrors)], publicationErrors: [...new Set(publicationErrors)],
    onboarding, selections, guideChannels, rows, roles, screeningEnabled: guild.features.includes('MEMBER_VERIFICATION_GATE_ENABLED'), verificationLevel: guild.verificationLevel };
}