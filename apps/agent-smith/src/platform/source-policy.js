import { isIP } from 'node:net';
import { PlatformError } from './catalog.js';
export function validatePublicFeedSource(source) {
  let url;
  try { url = new URL(source); } catch { throw new PlatformError('invalid_feed_url'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
      isIP(host) || host.includes(':') || !host.includes('.') || host === 'localhost' ||
      /\.(?:local|internal|localhost|lan|home|test|invalid)$/.test(host)) {
    throw new PlatformError('feed_source_must_be_public_https');
  }
  return url.href;
}
