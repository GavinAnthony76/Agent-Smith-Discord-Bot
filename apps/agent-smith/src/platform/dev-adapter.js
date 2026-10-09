import pg from 'pg';
import { createDiscordAccess } from './discord-access.js';
import { createPlatformHttp } from './http.js';
import { previewRuntimeStatus } from './activation.js';

// Preview uses REST only. Never import bot.js/connect() or create a Gateway.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const discord = createDiscordAccess();
const host = process.env.REPLIT_DEV_DOMAIN;
const origin = process.env.PLATFORM_DEV_ORIGIN ?? (host ? `https://${host}` : 'http://localhost:8080');
export const platformDev = createPlatformHttp({ pool, discord, origin, runtimeStatus: previewRuntimeStatus() });
