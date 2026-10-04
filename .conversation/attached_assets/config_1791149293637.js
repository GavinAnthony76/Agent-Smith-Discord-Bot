export function config(env = process.env) {
  const ids = key => (env[key] || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DATABASE_URL']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const owners = ids('OWNER_IDS');
  if (!owners.length) throw new Error('OWNER_IDS is required');
  const guildId = env.DISCORD_GUILD_ID;
  for (const id of [guildId, env.DISCORD_CLIENT_ID, ...owners, ...ids('APPROVER_IDS'), ...ids('PROTECTED_GUILD_IDS')]) {
    if (!/^\d{17,20}$/.test(id)) throw new Error('Invalid Discord ID in configuration');
  }
  if (ids('PROTECTED_GUILD_IDS').includes(guildId)) throw new Error('Protected guild refused');
  return { token: env.DISCORD_TOKEN, clientId: env.DISCORD_CLIENT_ID, guildId,
    databaseUrl: env.DATABASE_URL, owners, approvers: ids('APPROVER_IDS') };
}
