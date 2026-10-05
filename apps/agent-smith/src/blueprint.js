export const frameworks = ['Faith', 'Gaming', 'Tech'];
export const interests = {
  Faith: ['Bible Study', 'Prayer', 'Fellowship'],
  Gaming: ['Street Fighter II', 'Street Fighter IV', 'Street Fighter V', 'Street Fighter 6', '2XKO', 'Marvel Tokon', 'World of Warcraft', 'MnM', 'Other Fighters'],
  Tech: ['Programming', 'Hardware', 'AI Discussion']
};
export const selectionRoleNames = frameworks.map(f => `Selection: ${f}`);
export const ARRIVAL_CHANNEL_ID = '1556451709272719451';
export const roleNames = ['Member', ...frameworks, ...Object.values(interests).flat().map(x => `Interest: ${x}`), ...selectionRoleNames];
export const categories = [
  { name: 'START HERE', gate: null, channels: [['welcome', 'text', true], ['rules', 'text', true], ['onboarding', 'text', true], ['arrival-lounge', 'text']] },
  { name: 'SHARED HUB', gate: 'Member', channels: [['announcements', 'text', true], ['community-help', 'forum'], ['introductions', 'forum'], ['access-requests', 'text', true]] },
  { name: 'FAITH', gate: 'Faith', channels: [['faith-lounge', 'text'], ['bible-study', 'forum'], ['prayer-and-support', 'forum'], ['faith-news', 'text', true], ['faith-room', 'voice']] },
  { name: 'GAMING', gate: 'Gaming', channels: [['gaming-lounge', 'text'], ['fighting-games', 'forum'], ['mmo-adventures', 'forum'], ['looking-for-group', 'forum'], ['gaming-news', 'text', true], ['arcade', 'text'], ['gaming-room', 'voice']] },
  { name: 'TECH', gate: 'Tech', channels: [['tech-lounge', 'text'], ['projects-and-code', 'forum'], ['hardware-help', 'forum'], ['tech-news', 'text', true], ['tech-room', 'voice']] },
  { name: 'CONTROL ROOM', gate: 'staff', channels: [['smith-controls', 'text'], ['access-review', 'text'], ['audit-log', 'text', true], ['feed-status', 'text', true]] }
];
export const rules = `Welcome! Be respectful. No harassment, hate, spam, piracy, or sharing private information. Keep each framework's topics inside its space. Faith conversations must remain respectful; no pressure to disclose beliefs. The shared hub is for introductions and logistics. Framework access is not a reward. Use /accept to accept these rules, then /join to choose ONE framework. Additional access requires /request and explicit approval by an allowlisted human. Private channels are visible to the server owner and Discord administrators; they are not confidential counseling spaces.`;
