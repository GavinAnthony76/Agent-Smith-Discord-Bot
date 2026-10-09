import {
  Activity, BadgeCheck, BarChart3, CalendarDays, Coins, DoorOpen, Gavel,
  Gift, Hand, LayoutDashboard, Rss, Settings, ShieldAlert, Sparkles,
  Ticket, TrendingUp, Trophy, Video, type LucideIcon,
} from 'lucide-react';

export const MODULE_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard, setup: Settings, settings: Settings,
  moderation: Gavel, automod: ShieldAlert, onboarding: DoorOpen,
  roles: BadgeCheck, leveling: TrendingUp, economy: Coins,
  achievements: Trophy, rewards: Gift, tickets: Ticket, welcome: Hand,
  feeds: Rss, youtube: Video, events: CalendarDays, ai: Sparkles,
  analytics: BarChart3, logs: Activity,
};
