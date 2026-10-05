// Read-only REST/SQL inspection. No Gateway login, Discord mutations, migrations,
// member changes or mode changes; safe while the owner edits native drafts.
import { REST, Routes, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { config } from './config.js';
import { pool } from './db.js';
import { frameworks, interests } from './blueprint.js';
import { overwrites } from './discord.js';
import { nativeQuestionErrors } from './native-policy.js';

const cfg = config(), gid = cfg.guildId;
const rest = new REST({ timeout: 15000, retries: 0 }).setToken(cfg.token);
const names = bits => new PermissionsBitField(bits).toArray();
try {
  const [guild, bot, roles, channels, resources, records, grants, mode] = await Promise.all([
    rest.get(Routes.guild(gid)), rest.get(Routes.user('@me')), rest.get(Routes.guildRoles(gid)), rest.get(Routes.guildChannels(gid)),
    pool.query('SELECT * FROM resources WHERE guild_id=$1', [gid]).then(r => r.rows),
    pool.query('SELECT * FROM members WHERE guild_id=$1', [gid]).then(r => r.rows),
    pool.query('SELECT * FROM grants WHERE guild_id=$1', [gid]).then(r => r.rows),
    pool.query('SELECT legacy_enabled,cutover_status FROM onboarding_state WHERE guild_id=$1', [gid]).then(r => r.rows[0])
  ]);
  if (bot.id !== cfg.clientId || !cfg.owners.includes(guild.owner_id)) throw new Error('Target bot/owner identity mismatch.');
  const id = (kind, name) => resources.find(r => r.kind === kind && r.name === name)?.discord_id;
  const byRole = new Map(roles.map(r => [r.id, r]));
  function permissions(channel, held = []) {
    let bits = BigInt(byRole.get(gid).permissions);
    for (const rid of held) bits |= BigInt(byRole.get(rid)?.permissions ?? 0);
    if (bits & P.Administrator) return PermissionsBitField.All;
    const overrides = channel.permission_overwrites ?? [], everyone = overrides.find(o => o.id === gid && o.type === 0);
    if (everyone) bits = (bits & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
    let deny = 0n, allow = 0n;
    for (const o of overrides) if (o.type === 0 && held.includes(o.id)) { deny |= BigInt(o.deny); allow |= BigInt(o.allow); }
    return (bits & ~deny) | allow;
  }
  const selections = Object.fromEntries(frameworks.map(f => [f, id('role', `Selection: ${f}`)]));
  const cosmetics = Object.values(interests).flat().map(name => ({ name: `Interest: ${name}`, id: id('role', `Interest: ${name}`) }));
  const report = { capturedAt: new Date().toISOString(), target: gid, mode, selections, screeningEnabled: guild.features.includes('MEMBER_VERIFICATION_GATE_ENABLED') };
  const onboarding = await rest.get(Routes.guildOnboarding(gid));
  report.native = { enabled: onboarding.enabled, mode: onboarding.mode,
    defaults: onboarding.default_channel_ids.map(cid => channels.find(c => c.id === cid)?.name ?? 'missing'),
    prompts: onboarding.prompts.map(p => ({ title: p.title, required: p.required, single: p.single_select, prejoin: p.in_onboarding,
      options: p.options.map(o => ({ title: o.title, roles: o.role_ids.map(rid => byRole.get(rid)?.name ?? 'missing'),
        channels: o.channel_ids.map(cid => channels.find(c => c.id === cid)?.name ?? 'missing') })) })),
    blockers: nativeQuestionErrors(onboarding, selections, cosmetics.map(r => r.id)) };
  const defaultIds = [...new Set(onboarding.default_channel_ids)];
  const writableDefaults = defaultIds.filter(cid => {
    const c = channels.find(channel => channel.id === cid);
    return c && new PermissionsBitField(permissions(c)).has([P.ViewChannel, P.SendMessages]);
  }).length;
  report.native.defaultCriteria = { defaults: defaultIds.length, everyoneWritable: writableDefaults,
    defaultModeSatisfied: defaultIds.length >= 7 && writableDefaults >= 5 };
  if (onboarding.mode === 0 && !report.native.defaultCriteria.defaultModeSatisfied) {
    report.native.blockers.push('DEFAULT mode requires 7 default channels, including 5 everyone-viewable/writable. Do not open private channels to satisfy it.');
  }
  report.interests = cosmetics.map(role => ({
    name: role.name, zeroGuildPermissions: byRole.get(role.id)?.permissions === '0',
    overwriteChannels: channels.filter(c => (c.permission_overwrites ?? []).some(o => o.id === role.id && (BigInt(o.allow) || BigInt(o.deny)))).map(c => c.name),
    additionalEffectiveGrants: channels.filter(c => (permissions(c, [role.id]) & ~permissions(c)) !== 0n
      || (permissions(c, [id('role', 'Member'), role.id]) & ~permissions(c, [id('role', 'Member')])) !== 0n).map(c => c.name)
  }));
  report.guideTaskChannels = ['welcome', 'onboarding', 'arrival-lounge', 'rules'].map(name => {
    const c = channels.find(c => c.id === id('channel', name)), p = new PermissionsBitField(permissions(c));
    return { name, id: c.id, type: c.type, view: p.has(P.ViewChannel), history: p.has(P.ReadMessageHistory), send: p.has(P.SendMessages), slowmode: c.rate_limit_per_user ?? 0 };
  });
  try {
    const guide = await rest.get(`/guilds/${gid}/new-member-welcome`);
    report.savedGuide = { enabled: guide.enabled, tasks: guide.new_member_actions?.map(a => ({ type: a.action_type,
      channel: channels.find(c => c.id === a.channel_id)?.name ?? 'missing' })), resources: guide.resource_channels?.map(r => channels.find(c => c.id === r.channel_id)?.name ?? 'missing') };
  } catch (e) { report.savedGuide = { unavailable: true, status: e.status, code: e.code, unsavedDraftObservable: false }; }
  const help = channels.find(c => c.id === id('channel', 'community-help'));
  const normal = o => {
    let allow = new PermissionsBitField(o.allow).bitfield;
    if (o.id === bot.id) allow &= ~P.ManageRoles;
    return { ...o, allow, deny: new PermissionsBitField(o.deny).bitfield };
  };
  const actual = help.permission_overwrites.map(normal);
  const expected = overwrites({ id: gid, ownerId: guild.owner_id }, cfg, bot.id, 'Member',
    Object.fromEntries(resources.filter(r => r.kind === 'role').map(r => [r.name, r.discord_id]))).map(normal);
  report.communityHelp = { id: help.id, type: help.type, everyoneView: new PermissionsBitField(permissions(help)).has(P.ViewChannel),
    memberView: new PermissionsBitField(permissions(help, [id('role', 'Member')])).has(P.ViewChannel),
    differences: [...new Set([...actual, ...expected].map(o => o.id))].flatMap(rid => {
      const a = actual.find(o => o.id === rid), e = expected.find(o => o.id === rid);
      if (a?.allow === e?.allow && a?.deny === e?.deny && a?.type === e?.type) return [];
      return [{ principal: rid === bot.id ? 'Agent Smith' : byRole.get(rid)?.name ?? 'member override',
        unexpected: !e, missing: !a, allowAdded: names((a?.allow ?? 0n) & ~(e?.allow ?? 0n)),
        allowMissing: names((e?.allow ?? 0n) & ~(a?.allow ?? 0n)), denyAdded: names((a?.deny ?? 0n) & ~(e?.deny ?? 0n)), denyMissing: names((e?.deny ?? 0n) & ~(a?.deny ?? 0n)) }];
    }) };
  const members = [];
  let after;
  do {
    const page = await rest.get(Routes.guildMembers(gid), { query: new URLSearchParams({ limit: '1000', ...(after ? { after } : {}) }) });
    members.push(...page);
    if (page.length < 1000) break;
    after = page.at(-1).user.id;
  } while (true);
  report.unrecorded = members.filter(m => !m.user.bot).flatMap(m => {
    const record = records.find(r => r.user_id === m.user.id), held = frameworks.filter(f => m.roles.includes(id('role', f)));
    const approved = grants.filter(g => g.user_id === m.user.id).map(g => g.framework);
    const unmatched = held.filter(f => !record?.accepted_at || (record.primary_framework !== f && !approved.includes(f)));
    return unmatched.length ? [{ id: m.user.id, held, unmatched, memberRole: m.roles.includes(id('role', 'Member')),
      recordExists: !!record, accepted: !!record?.accepted_at, primary: record?.primary_framework ?? null,
      grants: approved, selections: frameworks.filter(f => m.roles.includes(selections[f])), pending: m.pending ?? null }] : [];
  });
  const caseIds = report.unrecorded.map(m => m.id);
  report.caseBotHistory = (await pool.query(`SELECT action,count(*)::int n FROM audit WHERE guild_id=$1 AND
    (actor=ANY($2::text[]) OR detail->>'subject'=ANY($2::text[]) OR detail->>'recipient'=ANY($2::text[])) GROUP BY action`, [gid, caseIds])).rows;
  try {
    const log = await rest.get(Routes.guildAuditLog(gid), { query: new URLSearchParams({ action_type: '25', limit: '100' }) });
    report.recentRoleHistory = log.audit_log_entries.filter(e => caseIds.includes(e.target_id)).map(e => ({
      target: e.target_id, byBot: e.user_id === bot.id, byGuildOwner: e.user_id === guild.owner_id,
      changes: e.changes?.map(c => ({ key: c.key, roles: Array.isArray(c.new_value) ? c.new_value.map(r => r.name) : [] }))
    }));
  } catch (e) { report.recentRoleHistory = { unavailable: true, status: e.status, code: e.code }; }
  report.cutoverBlockers = [...report.native.blockers];
  if (!report.screeningEnabled) report.cutoverBlockers.push('Rules screening is disabled.');
  if (report.interests.some(r => !r.zeroGuildPermissions || r.overwriteChannels.length || r.additionalEffectiveGrants.length)) report.cutoverBlockers.push('Unsafe cosmetic interest permissions.');
  if (report.communityHelp.differences.length) report.cutoverBlockers.push('community-help overwrite differs from the approved blueprint.');
  if (report.unrecorded.length) report.cutoverBlockers.push(`${report.unrecorded.length} existing humans have unmatched framework access; preserve roles pending human reconciliation.`);
  report.scope = 'Read-only diagnosis, not the complete checked cutover preflight. Unsaved UI drafts are not observable.';
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error('Read-only diagnosis incomplete:', e.code ?? e.name);
  process.exitCode = 1;
} finally { await pool.end(); }
