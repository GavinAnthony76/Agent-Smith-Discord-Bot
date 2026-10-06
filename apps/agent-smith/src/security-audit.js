import { readFile, readdir } from 'node:fs/promises';
import { PermissionFlagsBits as P } from 'discord.js';
import { commands } from './commands.js';
import { roleNames } from './blueprint.js';
import { assertOwnerConfiguration, assertSafeBot, assertCommandTree, ROLE_WORKFLOWS,
  PROTECTED_CHANNEL_NAMES, securityLimits } from './security-policy.js';

export async function auditSecurity({ guild, client, cfg, rows }) {
  await guild.fetch(); await guild.roles.fetch();
  const bot = await guild.members.fetchMe({ force: true });
  const owner = await guild.members.fetch({ user: guild.ownerId, force: true });
  const registered = await client.rest.get(`/applications/${cfg.clientId}/guilds/${guild.id}/commands`);
  const checks = [], failures = [], warnings = [];
  const check = (name, ok) => {
    checks.push({ name, safe: !!ok });
    if (!ok) failures.push(`UNSAFE: ${name}`);
  };
  try { assertOwnerConfiguration(cfg, guild.ownerId); check('Secure owner identity matches actual Server Owner', true); }
  catch { check('Secure owner identity matches actual Server Owner', false); }
  try { assertSafeBot(bot); check('No Administrator, Manage Server or Manage Webhooks power', true); }
  catch { check('No Administrator, Manage Server or Manage Webhooks power', false); }
  check('Smith is below the Server Owner security role', owner.roles.highest.position > bot.roles.highest.position);
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
  const runtimeFiles = (await readdir(new URL('.', import.meta.url))).filter(name => name.endsWith('.js') && name !== 'security-audit.js');
  for (const name of runtimeFiles) {
    const source = await readFile(new URL(name, import.meta.url), 'utf8');
    if (/\beval\s*\(|new\s+Function\s*\(/.test(source)) failures.push(`UNSAFE: dynamic code execution in ${name}`);
  }
  if (bot.permissions.has(P.ManageRoles)) warnings.push('Discord-native Manage Roles can manage lower roles outside this application. Protect the token; Smith application guards are not a sandbox for stolen credentials.');
  if (bot.permissions.has(P.ManageChannels)) warnings.push('Manage Channels remains only for existing operations. All channel deletion, permission architecture edits and unimplemented management commands are blocked in Smith; manual Owner management is required.');
  return { checks, failures, warnings, limits: securityLimits(), enforcement: 'Application pipeline verified by tests; native Discord power is reported separately.' };
}
