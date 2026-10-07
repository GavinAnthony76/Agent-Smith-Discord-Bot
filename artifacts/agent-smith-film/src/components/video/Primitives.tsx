import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import crest from '@assets/hallowed-core-current-server-icon.png';

export const GOLD = '#e7b96a';
export const BLUE = '#64aaff';
export const MINT = '#5ee4c1';
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const progress = (t: number, start: number, duration = 0.7) => {
  const v = clamp((t - start) / duration);
  return 1 - (1 - v) ** 3;
};
export const reveal = (t: number, start: number): CSSProperties => ({
  opacity: progress(t, start, 0.45),
  transform: `translateY(${(1 - progress(t, start)) * 1.5}vmin)`,
});

// Precomputed scene-clock events freeze with VideoPausedContext. No custom RAF.
export function useFilmClock(duration: number) {
  const [t, setT] = useState(0);
  const events = useMemo(() => Array.from({ length: Math.ceil(duration * 25) - 1 },
    (_, i) => ({ time: (i + 1) * 40, callback: () => setT((i + 1) * 0.04) })), [duration]);
  useSceneTimer(events);
  return t;
}

export function SceneFrame({ name, theme, children, t, duration }: {
  name: string; theme: string; children: ReactNode; t: number; duration: number;
}) {
  const handoff = progress(t, duration * .83, duration * .17);
  return <motion.section className={`film-scene ${theme}`} data-shot={name}
    initial={{ scale: 1.012 }} animate={{ scale: 1 }}
    exit={{ opacity: 0, scale: 1.035, transition: { duration: 0.38, ease: EASE } }}
    transition={{ duration: 0.8, ease: EASE }}>
    <div className="shot-world" style={{
      transform: `perspective(1200px) rotateX(${-handoff * .8}deg) scale(${1 + handoff * .025}) translateY(${-handoff}vmin)`,
    }}>{children}</div>
  </motion.section>;
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="eyebrow" style={style}>{children}</div>;
}

export function Trace({ d, amount, color = GOLD, width = 2 }: {
  d: string; amount: number; color?: string; width?: number;
}) {
  return <path d={d} fill="none" stroke={color} strokeWidth={width}
    pathLength={1} strokeDasharray="1" strokeDashoffset={1 - clamp(amount)}
    strokeLinecap="round" strokeLinejoin="round" />;
}

export function Halo({ className = '', color = GOLD }: { className?: string; color?: string }) {
  return <div className={`halo ${className}`} style={{ color }}>
    <svg viewBox="0 0 400 400">
      <circle cx="200" cy="200" r="194" fill="none" stroke="currentColor" strokeOpacity=".2" />
      <circle cx="200" cy="200" r="180" fill="none" stroke="currentColor" strokeWidth="1.2"
        strokeDasharray="80 200 24 110" />
      {Array.from({ length: 36 }, (_, i) => <line key={i} x1="200" y1="8" x2="200" y2={i % 3 ? 13 : 19}
        stroke="currentColor" opacity={i % 3 ? .25 : .65} transform={`rotate(${i * 10} 200 200)`} />)}
    </svg>
  </div>;
}

const SEAL_POSES = [
  { left: '73%', top: '50%', width: '70vmin', opacity: 1 },
  { left: '50%', top: '28%', width: '12vmin', opacity: 1 },
  { left: '91%', top: '14%', width: '11vmin', opacity: 1 },
  { left: '91%', top: '14%', width: '11vmin', opacity: 1 },
  { left: '91%', top: '14%', width: '11vmin', opacity: 1 },
  { left: '91%', top: '14%', width: '11vmin', opacity: 1 },
  { left: '91%', top: '14%', width: '11vmin', opacity: 1 },
  { left: '24%', top: '50%', width: '38vmin', opacity: 1 },
];

export function ContinuitySeal({ scene }: { scene: number }) {
  const [closing, setClosing] = useState(false);
  useSceneTimer([
    { time: scene / 1000, callback: () => setClosing(false) },
    { time: scene === 7 ? 4900 : 1 + scene / 1000, callback: () => setClosing(scene === 7) },
  ]);
  const pose = scene === 7 && closing ? SEAL_POSES[0] : SEAL_POSES[scene] ?? SEAL_POSES[0];
  return <motion.div className="continuity-seal" initial={false} animate={pose}
    transition={{ duration: 0.85, ease: EASE }}>
    <Halo />
    <img src={crest} alt="Hallowed Core gold cross, blue gaming shield and teal technology crest" />
  </motion.div>;
}

export function FilmHeader({ scene }: { scene: number }) {
  const labels = ['IDENTITY', 'COMMUNITY', 'ENROLLMENT', 'HUMAN REVIEW', 'MODERATION', 'MAINTENANCE', 'COMMUNITY TOOLS', 'HALLOWED CORE'];
  return <div className={`film-header ${scene === 7 ? 'light-header' : ''}`}>
    <span>HALLOWED CORE</span><span>{String(scene + 1).padStart(2, '0')} / {labels[scene]}</span>
  </div>;
}
