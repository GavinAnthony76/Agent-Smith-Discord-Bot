export const thresholds = [0, 1000, 3500, 9000, 22000, 50000, 100000];
export const titles = {
  Gaming: ['Novice', 'Beginner', 'Skilled', 'Expert', 'Champion', 'Master', 'Legend'],
  Faith: ['Initiate', 'Student of the Word', 'Bible Worker', 'Bible Scholar', 'Disciple of the Word', 'Steward of the Word', 'Master of the Word'],
  Tech: ['Tech Apprentice', 'Technician', 'Tech Pro', 'Tech Giant', 'Tech Lord', 'Lord Digital', 'The One']
};
export const progressionConfig = {
  dailyCap: 150,
  timezone: 'America/Chicago',
  sources: {
    trivia: { amount: 10, cooldownMs: 600000, dailyCap: 30, automatic: true },
    helpful_answer: { amount: 40, cooldownMs: 3600000, dailyCap: 80, automatic: false },
    verified_event: { amount: 50, cooldownMs: 14400000, dailyCap: 100, automatic: false },
    completed_activity: { amount: 30, cooldownMs: 3600000, dailyCap: 60, automatic: false }
  },
  // Future unlocks use a dedicated "<Framework> • Unlock: ..." role, never
  // the rank role. Channels must already belong to that framework's category.
  unlocks: []
};
export const rankName = (framework, level) => `${framework} • ${titles[framework][level - 1]}`;
export const rankDefinitions = Object.keys(titles).flatMap(framework =>
  thresholds.map((_, index) => ({ framework, level: index + 1, name: rankName(framework, index + 1) })));
export const faithDisclaimer = 'Faith titles recognize community participation and service, not spiritual worth, teaching/moderation authority, or unquestionable religious authority.';
