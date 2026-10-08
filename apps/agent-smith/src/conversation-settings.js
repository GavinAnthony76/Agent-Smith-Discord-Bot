const integer = (value, fallback, min, max) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('Invalid conversation configuration.');
  return n;
};
export function conversationSettings(env = process.env) {
  const channelIds = (env.AGENT_SMITH_CHAT_CHANNEL_IDS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (channelIds.some(id => !/^\d{17,20}$/.test(id))) throw new Error('Invalid conversation channel ID.');
  const temperature = Number(env.AI_TEMPERATURE ?? 1);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('Invalid AI temperature.');
  return Object.freeze({
    enabled: env.AI_ENABLED === 'true', model: env.AI_MODEL || 'gpt-5.4-mini',
    maxTokens: integer(env.AI_MAX_RESPONSE_TOKENS, 2048, 128, 4096), temperature,
    channelIds, triggers: (env.AGENT_SMITH_TRIGGERS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
    ttlMs: integer(env.AI_CONTEXT_TTL_MINUTES, 20, 15, 30) * 60000,
    cooldownMs: integer(env.AI_COOLDOWN_SECONDS, 5, 2, 60) * 1000,
  });
}
