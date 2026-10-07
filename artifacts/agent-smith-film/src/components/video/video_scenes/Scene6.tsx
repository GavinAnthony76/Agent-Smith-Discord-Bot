import { Check, RefreshCw } from 'lucide-react';
import { GOLD, MINT, SceneFrame, Trace, progress, reveal, useFilmClock } from '../Primitives';

export function Scene6() {
  const t = useFilmClock(7);
  return <SceneFrame name="Durable state" theme="archive-field" t={t} duration={7}>
    <h2 className="archive-title">Evidence,<br /><em>not guesswork.</em></h2>
    <svg className="archive-world" viewBox="0 0 1000 600">
      <path d="M370 260 V420 C370 490 710 490 710 420 V260" fill="#101e1b" stroke="#59775d" />
      {[420, 345, 270].map((y, i) => <g key={y} style={{
        transform: `translateY(${(1 - progress(t, .3 + i * .65)) * -18}px)`,
      }}><ellipse cx="540" cy={y} rx="170" ry="47" fill="#0e1b18" stroke={GOLD} strokeOpacity={.3 + progress(t, .3 + i * .65) * .5} />
        <path d={`M370 ${y} a170 47 0 0 0 340 0`} fill="none" stroke={GOLD} strokeWidth="2" /></g>)}
      {['MEMBERS', 'APPROVALS', 'AUDIT'].map((label, i) => <g key={label} opacity={progress(t, .5 + i * .8)}>
        <rect x={85 + progress(t, .5 + i * .8, 2.3) * 280} y={280 + i * 57} width="130" height="37"
          fill="#1b2920" stroke={GOLD} strokeOpacity=".6" rx="3" />
        <text x={150 + progress(t, .5 + i * .8, 2.3) * 280} y={305 + i * 57} textAnchor="middle"
          fill={GOLD} fontFamily="JetBrains Mono" fontSize="13">{label}</text>
      </g>)}
      <Trace d="M710 360 C790 360 790 260 895 260" amount={progress(t, 2.5, 2.5)} color={MINT} width={2.5} />
      <circle cx={710 + progress(t, 3, 2) * 185} cy={360 - progress(t, 3, 2) * 100} r="5" fill={MINT} opacity={progress(t, 3)} />
      <ellipse cx="540" cy="465" rx={170 + progress(t, 5.8, 1.2) * 50} ry="47" fill="none"
        stroke={MINT} strokeOpacity=".18" />
    </svg>
    <div className="archive-label" style={reveal(t, 1.2)}>PERSISTENT STATE</div>
    <div className="recovered-note" style={reveal(t, 3.9)}><RefreshCw strokeWidth={1} />
      <span>RECOVER<br />RECORDED ACCESS</span><Check /></div>
    <p className="film-foot" style={reveal(t, 4.3)}>Uncertain history stays for human review.</p>
  </SceneFrame>;
}
