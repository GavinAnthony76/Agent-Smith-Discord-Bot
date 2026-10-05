import { ChannelType } from 'discord.js';
import { connect } from './discord.js';
import { pool, locked, audit } from './db.js';
import { frameworks, ARRIVAL_CHANNEL_ID } from './blueprint.js';
import { nativeSettings } from './native-settings.js';

const apply = process.argv.includes('--apply');
let client;
try {
  const connected = await connect({ allowWrites: apply });
  ({ client } = connected);
  const { guild } = connected;
  if (apply) await locked(`native-prepare:${guild.id}`, async db => {
    const saved = (await db.query('SELECT * FROM resources WHERE guild_id=$1', [guild.id])).rows;
    const arrival = await guild.channels.fetch(ARRIVAL_CHANNEL_ID, { force: true });
    const parent = saved.find(r => r.kind === 'channel' && r.name === 'START HERE')?.discord_id;
    if (!parent || !arrival || arrival.guild.id !== guild.id || arrival.name !== 'arrival-lounge' || arrival.type !== ChannelType.GuildText
      || !arrival.permissionsFor(guild.roles.everyone)?.has(['ViewChannel', 'ReadMessageHistory', 'SendMessages'])
      || arrival.rateLimitPerUser !== 5) throw new Error('Authorized arrival channel is not public/readable/writable with 5-second slowmode; no changes made.');
    const tracked = saved.find(r => r.kind === 'channel' && r.name === 'arrival-lounge');
    if (tracked && tracked.discord_id !== ARRIVAL_CHANNEL_ID) throw new Error('Arrival tracking collision; no changes made.');
    // No overwrite replacement, no native UI PUT/PATCH, no other channel edits.
    if (arrival.parentId !== parent) await arrival.edit({ parent, lockPermissions: false, reason: 'Owner-authorized arrival adoption; preserve explicit channel permissions' });
    await db.query('INSERT INTO resources VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [guild.id, 'channel', 'arrival-lounge', ARRIVAL_CHANNEL_ID]);
    for (const f of frameworks) {
      await guild.roles.fetch();
      const name = `Selection: ${f}`;
      const row = saved.find(r => r.kind === 'role' && r.name === name);
      let role = row ? guild.roles.cache.get(row.discord_id) : guild.roles.cache.find(r => r.name === name);
      // Adopt a unique, safe exact-name role after a create/DB crash. No delete
      // or replacement of identities; ambiguous names require human review.
      if (guild.roles.cache.filter(r => r.name === name).size > 1) throw new Error(`Ambiguous selection role: ${name}`);
      if (row && !role) throw new Error(`Tracked selection role missing: ${name}; do not replace its ID.`);
      if (!role) role = await guild.roles.create({ name, permissions: [], mentionable: false, reason: 'Owner-authorized native selection signal; no access permissions' });
      if (role.managed || role.permissions.bitfield !== 0n || !role.editable || guild.channels.cache.some(c => c.permissionOverwrites.cache.get(role.id)?.allow.bitfield > 0n)) {
        throw new Error(`Unsafe selection role: ${name}; no role permissions changed.`);
      }
      // Persist successful creates independently of the enclosing transaction.
      await pool.query('INSERT INTO resources VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [guild.id, 'role', name, role.id]);
    }
    await db.query('INSERT INTO onboarding_state(guild_id) VALUES($1) ON CONFLICT DO NOTHING', [guild.id]);
    await audit(db, client.user.id, 'native-onboarding-prepared', { arrival: ARRIVAL_CHANNEL_ID, legacyPreserved: true, nativeUiUntouched: true });
  });
  const state = await nativeSettings(connected);
  const legacyState = (await pool.query('SELECT legacy_enabled,cutover_status FROM onboarding_state WHERE guild_id=$1', [guild.id])).rows[0];
  console.log(JSON.stringify({ mode: apply ? 'prepared' : 'inspect-only', selectionRoleIds: state.selections,
    legacyState: legacyState ?? { legacy_enabled: true, cutover_status: 'legacy' },
    screeningEnabled: state.screeningEnabled, verificationLevel: state.verificationLevel, nativePublished: state.onboarding.enabled,
    nativeMode: state.onboarding.mode, safetyErrors: state.safetyErrors, cutoverBlockers: state.publicationErrors,
    guideChannels: state.guideChannels }, null, 2));
  try {
    const guide = await client.rest.get(`/guilds/${guild.id}/new-member-welcome`);
    console.log('Guide saved configuration:', JSON.stringify({
      enabled: guide.enabled,
      tasks: guide.new_member_actions?.map(a => ({ actionType: a.action_type, channel: guild.channels.cache.get(a.channel_id)?.name ?? 'missing' })),
      resources: guide.resource_channels?.map(r => guild.channels.cache.get(r.channel_id)?.name ?? 'missing')
    }));
  } catch (error) {
    console.log(`Guide saved configuration unavailable to bot (HTTP ${Number(error.status) || 0}, code ${Number(error.code) || 0}); unsaved Discord UI draft is not observable.`);
  }
  if (state.safetyErrors.length) process.exitCode = 1;
} catch { console.error('Native preparation/inspection refused or interrupted; no raw Discord requests or secrets printed. Re-run inspect and check the safety report.'); process.exitCode = 1; }
finally { client?.destroy(); await pool.end(); }