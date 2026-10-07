import { LockKeyhole, FileLock2, UserRoundCheck, Files, ShieldCheck } from 'lucide-react';
import { GOLD, MINT, SceneFrame, Trace, progress, reveal, useFilmClock } from '../Primitives';

export function Scene5() {
  const t = useFilmClock(7);
  return <SceneFrame name="Moderation" theme="moderation-field" t={t} duration={7}>
    <div className="shield-world">
      <svg viewBox="0 0 420 460">
        <path d="M210 25 L370 93 V240 C370 335 292 398 210 435 C128 398 50 335 50 240 V93 Z"
          fill="#112722" stroke="#214f43" strokeWidth="2" />
        <Trace d="M210 25 L370 93 V240 C370 335 292 398 210 435 C128 398 50 335 50 240 V93 Z"
          amount={progress(t, 0, 1.2)} color={MINT} width={2.5} />
        <path d="M210 60 L337 115 V240 C337 311 277 367 210 400 C143 367 83 311 83 240 V115 Z"
          fill="none" stroke={GOLD} opacity=".3" strokeDasharray="3 9"
          strokeDashoffset={-t * 14} />
      </svg>
      <LockKeyhole className="shield-lock" strokeWidth={.8} style={reveal(t, 1.3)} />
    </div>
    <div className="moderation-copy"><h2>Guard the<br /><em>community.</em></h2>
      <div className="case-lines">{[
        [FileLock2, 'PRIVATE REPORT', .6],
        [UserRoundCheck, 'HUMAN DECISION', 2],
        [Files, 'RETAINED CASE', 3.4],
      ].map(([Icon, label, at], i) => {
        const Glyph = Icon as typeof Files;
        return <div key={i} style={reveal(t, at as number)}><Glyph strokeWidth={1.3} /><span>{label as string}</span>
          <i style={{ width: `${progress(t, Number(at) + .4, 1) * 100}%` }} /></div>;
      })}</div>
      <div className="protected-note" style={reveal(t, 4.7)}><ShieldCheck />
        <div><strong>Protected accounts</strong><span>Management refused</span></div></div>
    </div>
  </SceneFrame>;
}
