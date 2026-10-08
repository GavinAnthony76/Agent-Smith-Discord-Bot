export const unavailable = 'My conversational service is temporarily unavailable. Smith’s other server functions remain operational.';
export function safetyReply(text) {
  if (/\b(ignore|override|disregard)\b.{0,70}\b(previous|system|instructions|rules)\b|\bpretend\b.{0,40}\b(owner|admin)\b|\b(system prompt|developer instructions)\b/i.test(text))
    return 'I can answer questions, but I cannot override my security rules or treat a conversation as administrator authorization.';
  if (/\b(reveal|show|give|print|dump|expose|list|read)\b.{0,80}\b(token|api.?key|secrets?|credentials?|environment variables?|env vars?|moderation history)\b|\bwhat(?:’s|'s| is) your\b.{0,20}\b(token|key|password)\b/i.test(text) || hasCredential(text))
    return 'I cannot reveal credentials, secrets or private moderation records.';
  if (/\b(?:ban|kick|timeout|purge|unban)\s+(?:me|someone|bob|<@|\w+)/i.test(text) ||
      /\b(?:give|grant|add|approve|make)\b.{0,40}\b(access|administrator|admin|role|framework)\b/i.test(text))
    return 'That requires the appropriate explicit command or button and human authorization. Additional framework access requires human approval; conversation cannot grant it.';
  return null;
}
export function hasCredential(text) {
  return /sk-[A-Za-z0-9_-]{16,}|(?:postgres(?:ql)?):\/\/\S+|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/.test(text);
}
export function safeText(value, max = 1000) {
  const text = String(value ?? '');
  return hasCredential(text) ? '[redacted]' : text.replace(/@everyone|@here/g, '[mention removed]').slice(0, max);
}
export function safeOutput(text, context) {
  if (typeof text !== 'string' || !text.trim() || hasCredential(text)) return unavailable;
  const channels = new Set(context.channels.map(channel => channel.id));
  return safeText(text, 7000)
    .replace(/<#(\d+)>/g, (mention, id) => channels.has(id) ? mention : '[restricted channel]')
    .replace(/<@(?:!|&)?\d+>/g, '[mention removed]');
}
export function splitDiscord(text, limit = 1900) {
  const result = [];
  let rest = String(text).slice(0, 7000);
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit;
    // Never split a UTF-16 surrogate pair.
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    result.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) result.push(rest);
  return result;
}
