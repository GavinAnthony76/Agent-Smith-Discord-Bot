export const TARGET_GUILD_ID = '1556423230590423042';

export function config(env = process.env) {
  const ids = key => (env[key] || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DATABASE_URL']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const owners = ids('OWNER_IDS');
  if (!owners.length) throw new Error('OWNER_IDS is required');
  const guildId = env.DISCORD_GUILD_ID;
  for (const id of [guildId, env.DISCORD_CLIENT_ID, ...owners, ...ids('APPROVER_IDS'),
    ...(env.OWNER_DISCORD_ID ? [env.OWNER_DISCORD_ID] : []),
    ...(env.BOOTSTRAP_CONFIRM_GUILD_ID ? [env.BOOTSTRAP_CONFIRM_GUILD_ID] : [])]) {
    if (!/^\d{17,20}$/.test(id)) throw new Error('Invalid Discord ID in configuration');
  }
  assertWriteTarget({ guildId }, env);
  return { token: env.DISCORD_TOKEN, clientId: env.DISCORD_CLIENT_ID, guildId,
    databaseUrl: env.DATABASE_URL, owners, ownerDiscordId: env.OWNER_DISCORD_ID, approvers: ids('APPROVER_IDS') };
}

export function assertWriteTarget(cfg, env = process.env) {
  if (cfg.guildId !== TARGET_GUILD_ID || env.DISCORD_GUILD_ID !== TARGET_GUILD_ID) {
    throw new Error('DISCORD_GUILD_ID does not match the fixed authorized Hallowed Core target; connection refused.');
  }
  if (env.BOOTSTRAP_CONFIRM_GUILD_ID !== TARGET_GUILD_ID) {
    throw new Error('BOOTSTRAP_CONFIRM_GUILD_ID does not match the fixed authorized Hallowed Core target; connection refused.');
  }
}
