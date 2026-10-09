import { useState } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const suppliedAssets = import.meta.glob('/public/branding/*.png', { eager: true });

/** Loads supplied PNG once; falls back to the SVG placeholder without looping. */
export function SmithMark({ size = 32, banner = false, className = '' }: { size?: number; banner?: boolean; className?: string }) {
  const name = banner ? 'agent-smith-banner' : 'agent-smith-avatar';
  const [failed, setFailed] = useState(false);
  const supplied = `/public/branding/${name}.png` in suppliedAssets;
  const src = `${BASE}branding/${name}${failed || !supplied ? '-placeholder.svg' : '.png'}`;
  return (
    <img src={src} alt={banner ? 'Agent Smith banner' : 'Agent Smith'} onError={() => { if (!failed) setFailed(true); }}
      className={`${banner ? (failed || !supplied ? 'w-full object-contain' : 'w-full object-cover') : 'rounded-xl'} ${className}`} style={banner ? undefined : { width: size, height: size }} />
  );
}
