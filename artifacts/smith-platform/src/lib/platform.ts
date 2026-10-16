import { useGetPlatformSession } from '@workspace/api-client-react';

export const FALLBACK_LOGIN = '/api/platform/oauth/login';

/** Session + CSRF request options to pass to every mutation hook. */
export function useCsrf() {
  const q = useGetPlatformSession();
  const request = {
    headers: { 'X-CSRF-Token': q.data?.csrfToken ?? '' } as Record<string, string>,
    credentials: 'same-origin' as const,
  };
  return { q, session: q.data, request };
}

const STATUS_MESSAGES: Record<number, string> = {
  400: 'The request was not valid.',
  401: 'You are not signed in. Sign in with Discord and try again.',
  403: 'You are not authorized for this server or action.',
  404: 'That resource was not found.',
  409: 'The configuration changed since you loaded it. Review the latest state and try again.',
  422: 'Agent Smith could not verify that change safely.',
  429: 'Too many requests. Wait a moment and try again.',
  503: 'A dependent service is unavailable right now.',
  500: 'An unexpected server error occurred.',
};

/** Extracts a staff-facing reference ID from an API error payload, if present. */
export function errRef(e: unknown): string | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const data = (e as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const ref = d.referenceId ?? d.reference ?? d.requestId;
    if (typeof ref === 'string' && ref) return ref;
  }
  return undefined;
}

export function errStatus(e: unknown): number | undefined {
  const s = e && typeof e === 'object' ? (e as { status?: unknown }).status : undefined;
  return typeof s === 'number' ? s : undefined;
}

/** Member-safe message: server-provided message for expected statuses, never raw exceptions. */
export function errMsg(e: unknown): string {
  const status = errStatus(e);
  const ref = errRef(e);
  let msg: string | undefined;
  if (e && typeof e === 'object') {
    const data = (e as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const m = (data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error;
      if (typeof m === 'string' && m.length < 300 && !/\bat\s.+\(|stack|SQL|ECONN|TypeError|undefined/i.test(m)) msg = m;
    }
  }
  if (!msg) msg = status ? STATUS_MESSAGES[status] ?? (status >= 500 ? STATUS_MESSAGES[500] : 'The request was rejected.') :
    'Agent Smith could not reach the dashboard API.';
  return ref ? `${msg} Reference: ${ref}` : msg;
}

export const MODULE_LABELS: Record<string, string> = {
  moderation: 'Moderation',
  automod: 'Automod',
  onboarding: 'Onboarding',
  roles: 'Roles',
  leveling: 'Leveling',
  economy: 'Economy',
  achievements: 'Achievements',
  rewards: 'Rewards',
  tickets: 'Tickets',
  welcome: 'Welcome',
  feeds: 'Feeds',
  youtube: 'YouTube',
  events: 'Events',
  ai: 'AI',
  analytics: 'Analytics',
};

export const MODULE_KEYS = Object.keys(MODULE_LABELS);

export type PageDef = {
  title: string;
  blurb: string;
  module?: string;
  collections?: { key: string; label: string }[];
};

export const PAGES: Record<string, PageDef> = {
  overview: { title: 'Overview', blurb: 'Live state of this server as reported by the platform.' },
  moderation: {
    title: 'Moderation',
    blurb: 'Case history, member reports and moderation configuration.',
    module: 'moderation',
    collections: [
      { key: 'cases', label: 'Cases' },
      { key: 'reports', label: 'Reports' },
    ],
  },
  automod: { title: 'Automod', blurb: 'Automatic rule enforcement.', module: 'automod' },
  onboarding: { title: 'Onboarding', blurb: 'Guided member entry flow.', module: 'onboarding' },
  roles: { title: 'Roles', blurb: 'Self-assignable, protected and rewardable roles.', module: 'roles' },
  leveling: {
    title: 'Leveling',
    blurb: 'Experience rules, leaderboard and member profiles.',
    module: 'leveling',
    collections: [
      { key: 'leaderboard', label: 'Leaderboard' },
      { key: 'profiles', label: 'Profiles' },
    ],
  },
  economy: { title: 'Economy', blurb: 'Currency settings and the server shop.', module: 'economy', collections: [{ key: 'shop', label: 'Shop' }] },
  achievements: { title: 'Achievements', blurb: 'Milestones members can earn.', module: 'achievements', collections: [{ key: 'achievements', label: 'Achievements' }] },
  rewards: { title: 'Rewards', blurb: 'Rewards granted for progress.', module: 'rewards', collections: [{ key: 'rewards', label: 'Rewards' }] },
  tickets: {
    title: 'Tickets',
    blurb: 'Support panels and open tickets.',
    module: 'tickets',
    collections: [
      { key: 'ticket-panels', label: 'Panels' },
      { key: 'tickets', label: 'Tickets' },
    ],
  },
  welcome: { title: 'Welcome', blurb: 'Greeting messages for new members.', module: 'welcome' },
  feeds: { title: 'Feeds', blurb: 'External content feeds.', module: 'feeds', collections: [{ key: 'feeds', label: 'Feeds' }] },
  youtube: { title: 'YouTube', blurb: 'Channel upload announcements.', module: 'youtube', collections: [{ key: 'feeds', label: 'Feeds' }] },
  events: { title: 'Events', blurb: 'Scheduled community events.', module: 'events', collections: [{ key: 'events', label: 'Events' }] },
  ai: { title: 'AI', blurb: 'Assistant behaviour and limits.', module: 'ai' },
  analytics: { title: 'Analytics', blurb: 'Activity measurement settings.', module: 'analytics' },
  audit: { title: 'Audit log', blurb: 'Record of changes made through the platform.', collections: [{ key: 'audit', label: 'Audit' }] },
  settings: {
    title: 'Settings',
    blurb: 'Dashboard managers and plan entitlements.',
    collections: [
      { key: 'managers', label: 'Managers' },
      { key: 'entitlements', label: 'Entitlements' },
    ],
  },
  setup: { title: 'Server setup', blurb: 'Guided configuration for a new server.' },
};

export const NAV_GROUPS: { label: string; pages: string[] }[] = [
  { label: 'Server', pages: ['overview', 'setup', 'analytics'] },
  { label: 'Safety', pages: ['moderation', 'automod', 'onboarding', 'roles', 'tickets'] },
  { label: 'Community', pages: ['welcome', 'leveling', 'economy', 'achievements', 'rewards', 'events'] },
  { label: 'Integrations', pages: ['feeds', 'youtube', 'ai'] },
  { label: 'Admin', pages: ['audit', 'settings'] },
];

export const RECORD_ACTIONS: Record<string, { action: string; label: string; closes?: boolean }[]> = {
  cases: [
    { action: 'case-note', label: 'Add note' },
    { action: 'case-close', label: 'Close case', closes: true },
  ],
  reports: [{ action: 'report-review', label: 'Mark reviewed' }],
  'ticket-panels': [{ action: 'ticket-publish', label: 'Publish panel', closes: true }],
  tickets: [
    { action: 'ticket-claim', label: 'Claim' },
    { action: 'ticket-escalate', label: 'Escalate' },
    { action: 'ticket-close', label: 'Close', closes: true },
    { action: 'ticket-reconcile', label: 'Reconcile', closes: true },
  ],
};

export function guildIconUrl(id: string, icon?: string | null) {
  return icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.png?size=96` : null;
}
export function userAvatarUrl(id: string, avatar?: string | null) {
  return avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64` : null;
}
export function initials(s: string) {
  return s.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
