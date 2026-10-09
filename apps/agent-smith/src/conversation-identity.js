import { safeText } from './ai-safety.js';

export const HALLOWED_IDENTITY = 'I am Agent Smith, Hallowed Core’s conversational and operational assistant—not the Owner. I help with Gaming, Tech and respectful Faith questions; human-only server decisions remain with authorized people.';

export function conversationIdentity(guild, settings) {
  if (!settings.genericServer) return HALLOWED_IDENTITY;
  const personality = safeText(settings.personalityAdditions ?? '', 400);
  return `I am Agent Smith, ${safeText(guild.name, 100)}’s conversational assistant—not the Owner. ` +
    'I use this server’s configuration; protected access and staff decisions remain with authorized humans.' +
    (personality ? ` Configured personality: ${personality}` : '');
}
