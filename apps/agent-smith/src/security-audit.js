import { PermissionFlagsBits as P } from 'discord.js';
import { commands } from './commands.js';
import { roleNames } from './blueprint.js';
import { assertOwnerConfiguration, assertSafeBot, assertCommandTree, ROLE_WORKFLOWS,
  PROTECTED_CHANNEL_NAMES, securityLimits, assertNotOwner, assertSafeHierarchy } from './security-policy.js';
import { assertRoleChannelGrants, assertStaffChannel, inheritedLegacyPermissionBits } from './permissions.js';
import { protectedResources } from './protected-resources.js';
import { auditProtectedLocks, nativePrimaryIsSafe } from './security-lock-audit.js';
import { auditSecuritySource } from './security-source-audit.js';
import { assertAutomodAction } from './smith-control.js';
import { auditManualChannels } from './manual-channels.js';

export async function auditSecurity({ guild, client, cfg, rows, pool }) {
  await guild.fetch(); await guild.roles.fetch();await guild.channels.fetch();
  const bot = await guild.members.fetchMe({ force: true });
  const owner = await guild.members.fetch({ user: guild.ownerId, force: true });
  const registered = await client.rest.get(`/applications/${cfg.clientId}/guilds/${guild.id}/commands`);
  const checks = [], failures = [], warnings = [];
  const check = (name, ok, details = []) => {
    checks.push({ name, safe: !!ok, details });
    if (!ok) failures.push(`UNSAFE: ${name}`);
  };
  try { assertOwnerConfiguration(cfg, guild.ownerId); check('Secure owner identity matches actual Server Owner', true); }
  catch { check('Secure owner identity matches actual Server Owner', false); }
  try { assertSafeBot(bot); check('Live bot permissions match the shared capability allowlist', true); }
  catch(error) { check('Live bot permissions match the shared capability allowlist', false,[error.message]); }
  if(inheritedLegacyPermissionBits(bot))warnings.push('Owner-approved compatibility exception: unnamed bit 47 inherited only from @everyone is non-blocking. No live permissions changed; Administrator and all other unapproved bits remain blocked.');
  try {assertSafeHierarchy(bot,owner);check('Smith is below Owner and designated senior roles',true);}
  catch(error){check('Smith is below Owner and designated senior roles',false,[error.message]);}
  check('Secure identity and protected-account allowlist are immutable at runtime',Object.isFrozen(cfg)&&Object.isFrozen(cfg.owners));
  check('Discord prevents Smith managing the actual Server Owner', !owner.manageable);
  check('Smith cannot assign its own highest role', !bot.roles.highest.editable && !roleNames.includes(bot.roles.highest.name));
  check('Smith cannot assign allowlisted roles equal to or above itself', rows.filter(r => r.kind === 'role').every(row =>
    guild.roles.cache.get(row.discord_id)?.position < bot.roles.highest.position));
  check('Role allowlist is strictly below Smith and has zero guild permissions', rows.filter(r => r.kind === 'role').every(row => {
    const role = guild.roles.cache.get(row.discord_id);
    return role && role.name === row.name && roleNames.includes(row.name) && role.permissions.bitfield === 0n
      && !role.managed && role.position < bot.roles.highest.position;
  }));
  check('Owner and Smith roles cannot be edited or deleted through management APIs', securityLimits().roleDeletes === 0);
  check('Protected channels and categories cannot be deleted', securityLimits().channelDeletes === 0
    && ['rules','onboarding','smith-controls','audit-log'].every(name => PROTECTED_CHANNEL_NAMES.has(name)));
  check('Protected framework roles cannot be deleted', securityLimits().roleDeletes === 0
    && ['Faith','Gaming','Tech'].every(name => roleNames.includes(name)));
  try { assertCommandTree([...registered, ...commands.map(c => c.toJSON())]); check('No nuke, reset or bulk destructive command exists', true); }
  catch { check('No nuke, reset or bulk destructive command exists', false); }
  check('Bulk destructive APIs disabled; one ban target and bounded purge', securityLimits().bansPerOperation === 1 && securityLimits().purge <= 100);
  check('AI has no privileged workflow capability', !ROLE_WORKFLOWS.has('ai'));
  const registry=protectedResources({guild,bot,owner,rows});
  check('ID registry includes Owner, Smith and tracked protected roles/channels',registry.has(owner.roles.highest.id)
    && registry.has(bot.roles.highest.id) && ['Faith','Gaming','Tech','rules','onboarding','audit-log','smith-controls'].every(name=>
      rows.some(row=>row.name===name&&registry.has(row.discord_id))));
  const lockFailures=auditProtectedLocks({guild,cfg,client,rows});
  check('Protected channels/categories retain expected permission locks and placement',lockFailures.length===0,lockFailures);
  const manual = auditManualChannels(guild, cfg);
  check('Owner-approved manual channels retain reviewed identity and bounded Member access',
    manual.failures.length === 0, [...manual.reviewed, ...manual.failures]);
  const grantFailures=[];
  for(const row of rows.filter(row=>row.kind==='role')) {
    try {assertRoleChannelGrants(guild.roles.cache.get(row.discord_id),guild,{bot,owner,rows,registry});}
    catch(error){grantFailures.push(`${row.name}: ${error.message}`);}
  }
  check('Role grants cannot confer unexpected channel permissions',grantFailures.length===0,grantFailures);
  const ownerDryRun=['warn','unwarn','timeout','untimeout','kick','ban','unban','purge','role-add','role-remove']
    .every(()=>{try{assertNotOwner(guild,guild.ownerId,cfg);return false;}catch{return true;}});
  check('Owner immunity dry-run rejects every management action class without API writes',ownerDryRun);
  const sourceFailures=await auditSecuritySource();
  check('Static source audit finds no ungated transport, scope bypass or AI capability import',sourceFailures.length===0,sourceFailures);
  try {
    const onboarding=await guild.fetchOnboarding();
    check('Native primary menu is single-select and maps only inert Selection roles',nativePrimaryIsSafe(onboarding));
  }catch(error){check('Native primary menu is single-select and maps only inert Selection roles',false,[`Saved onboarding could not be verified (${error.code??error.name}).`]);}
  if(!pool)check('Request lifecycle and automod settings verified in persistent storage',false,['No database reader supplied.']);
  else {
    const overdue=(await pool.query("SELECT count(*)::integer AS count FROM requests WHERE guild_id=$1 AND status='pending' AND (expires_at IS NULL OR expires_at<=now()) AND NOT(user_id=ANY($2::text[]))",
      [guild.id,[guild.ownerId,cfg.ownerDiscordId,...cfg.owners].filter(Boolean)])).rows[0].count;
    check('No eligible pending request has a missing or exceeded expiry',overdue===0,[`${overdue} overdue or undated requests; protected account history is excluded.`]);
    const settings=(await pool.query("SELECT key,value FROM bot_settings WHERE guild_id=$1 AND key LIKE 'automod:%'",[guild.id])).rows;
    const automodFailures=[];
    for(const setting of settings) {
      try {
        assertAutomodAction(setting.value.action);
        if(setting.value.action==='escalate'){
          const channel=await guild.channels.fetch(setting.value.channelId),role=guild.roles.cache.get(setting.value.moderatorRoleId);
          if(channel?.name!=='automod-escalations'||!role||role.id===guild.id||!role.mentionable)throw new Error('Destination or on-duty role drift.');
          assertStaffChannel(channel,guild,cfg,role.id);
        }
      }catch(error){automodFailures.push(`${setting.key}: ${error.message}`);}
    }
    check('Automod settings allow only log-only/escalate and private designated-staff delivery',automodFailures.length===0,automodFailures);
    const notices=(await pool.query("SELECT count(*)::integer AS count FROM request_notifications WHERE guild_id=$1 AND status IN ('sending','uncertain')",[guild.id])).rows[0].count;
    if(notices)warnings.push(`${notices} expiry notifications have unconfirmed delivery. Do not automatically resend; /requests remains the member inbox.`);
  }
  if (bot.permissions.has(P.ManageRoles)) warnings.push('Discord-native Manage Roles can manage lower roles outside this application. Protect the token; Smith application guards are not a sandbox for stolen credentials.');
  if (bot.permissions.has(P.ManageChannels)) warnings.push('Manage Channels remains only for existing operations. All channel deletion, permission architecture edits and unimplemented management commands are blocked in Smith; manual Owner management is required.');
  return { checks, failures, warnings, limits: securityLimits(), enforcement: 'Application pipeline verified by tests; native Discord power is reported separately.' };
}
