import { Check, Fingerprint } from 'lucide-react';
import { Eyebrow, SceneFrame, progress, reveal, useFilmClock } from '../Primitives';

const ROWS = [
  ['01', 'RULES SCREENED', 'CONFIRMED', 1.2],
  ['02', 'PRIMARY: GAMING', 'SELECTED', 2.8],
  ['03', 'INTERESTS SAVED', 'SAVED', 4.4],
] as const;
export function Scene3() {
  const t = useFilmClock(8);
  return <SceneFrame name="Enrollment" theme="enrollment-field" t={t} duration={8}>
    <div className="enrollment-copy"><Eyebrow>ILLUSTRATIVE STAGED FLOW</Eyebrow>
      <h2>A clear<br /><em>way in.</em></h2>
      <Fingerprint className="fingerprint" strokeWidth={1} style={{
        opacity: .15 + progress(t, 3.6) * .35, transform: `rotate(${t * 2}deg)`,
      }} /></div>
    <div className="onboarding-page" style={{
      transform: `perspective(1200px) rotateY(${(1 - progress(t, 0, 1)) * -10}deg) translateY(${(1 - progress(t, 0, 1)) * 3}vmin)`,
    }}>
      <div className="document-head"><span>ONBOARDING RECORD</span><span>HC</span></div>
      {ROWS.map(([n, title, result, at]) => <div className="document-row" key={n}>
        <div className="document-number">{n}</div><div><strong>{title}</strong>
          <div className="document-result" style={reveal(t, at)}>{result}</div></div>
        <Check style={{ opacity: progress(t, at), transform: `scale(${progress(t, at)})` }} />
      </div>)}
      <div className="document-receipt" style={reveal(t, 5.3)}><Check /> READY</div>
      <div className="document-sweep" style={{ width: `${progress(t, .8, 6.4) * 100}%` }} />
    </div>
    <p className="film-foot" style={reveal(t, .4)}>Native screening first. Staged activation is optional.</p>
  </SceneFrame>;
}
