export function config(env = process.env) {
  const ids = key => (env[key] || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DATABASE_URL']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const owners = ids('OWNER_IDS');
  if (!owners.length) throw new Error('OWNER_IDS is required');
  const guildId = env.DISCORD_GUILD_ID;
  const protectedGuildIds = ids('PROTECTED_GUILD_IDS');
  for (const id of [guildId, env.DISCORD_CLIENT_ID, ...owners, ...ids('APPROVER_IDS'), ...protectedGuildIds,
    ...(env.BOOTSTRAP_CONFIRM_GUILD_ID ? [env.BOOTSTRAP_CONFIRM_GUILD_ID] : [])]) {
    if (!/^\d{17,20}$/.test(id)) throw new Error('Invalid Discord ID in configuration');
  }
  if (protectedGuildIds.includes(guildId)) throw new Error('Protected guild refused');
  return { token: env.DISCORD_TOKEN, clientId: env.DISCORD_CLIENT_ID, guildId,
    databaseUrl: env.DATABASE_URL, owners, approvers: ids('APPROVER_IDS'), protectedGuildIds };
}

export function assertWriteTarget(cfg, env = process.env) {
  if (!cfg.protectedGuildIds?.length) {
    throw new Error('Set PROTECTED_GUILD_IDS to the old server ID before enabling Discord writes.');
  }
  if (cfg.protectedGuildIds.includes(cfg.guildId)) throw new Error('Protected guild refused');
  if (env.BOOTSTRAP_CONFIRM_GUILD_ID !== cfg.guildId) {
    throw new Error('Set BOOTSTRAP_CONFIRM_GUILD_ID to the NEW server ID before enabling Discord writes.');
  }
}
