import { Eyebrow, GOLD, SceneFrame, progress, reveal, useFilmClock } from '../Primitives';

export function Scene1() {
  const t = useFilmClock(5);
  return <SceneFrame name="Identity" theme="identity-field" t={t} duration={5}>
    <div className="opener-copy" style={{ transform: `translateY(${-progress(t, 3.8, 1.2) * 1.3}vmin)` }}>
      <Eyebrow>HALLOWED CORE / COMMUNITY SYSTEM</Eyebrow>
      <h1 className="opener-title"><span>AGENT</span><span style={{
        clipPath: `inset(${(1 - progress(t, .45, .55)) * 100}% 0 0 0)`, color: GOLD,
        letterSpacing: `${-.07 + (1 - progress(t, 1.4, 1)) * .07}em`,
      }}>SMITH</span></h1>
      <p className="opener-caption" style={reveal(t, 1.6)}>Three communities.<br />One shared core.</p>
    </div>
    <div className="identity-orbit" style={{
      transform: `translate(-50%,-50%) rotate(${t * 9}deg) scale(${1 + progress(t, 3.8, 1.2) * .4})`,
    }}><i /><i /><i /></div>
    <div className="identity-rule" style={{ width: `${10 + t * 5}%` }} />
  </SceneFrame>;
}
