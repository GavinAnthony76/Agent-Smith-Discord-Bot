import { Check, UserRound, LockKeyhole } from 'lucide-react';
import { BLUE, GOLD, MINT, Eyebrow, SceneFrame, Trace, progress, reveal, useFilmClock } from '../Primitives';

export function Scene4() {
  const t = useFilmClock(8);
  const approved = t >= 4.1;
  const packet = t < 4.1 ? progress(t, .2, 1.3) * .46 : .46 + progress(t, 4.5, 1.5) * .54;
  return <SceneFrame name="Human review" theme="review-field" t={t} duration={8}>
    <div className="review-copy"><Eyebrow>CROSS-FRAMEWORK ACCESS</Eyebrow>
      <h2>Human<br /><em>judgment.</em></h2></div>
    <div className="access-gate">
      <svg viewBox="0 0 900 350">
        <path d="M60 155 H835" stroke="#39414b" strokeWidth="2" />
        <Trace d="M60 155 H420" amount={progress(t, .2, 1.3)} color={BLUE} width={3} />
        <Trace d="M470 155 H835" amount={progress(t, 4.5, 1.5)} color={MINT} width={3} />
        <circle cx={60 + packet * 775} cy="155" r="7" fill={approved ? MINT : BLUE} />
        <circle cx="450" cy="155" r={66 + Math.sin(t * 2) * 3} fill="#131820" stroke={GOLD} />
        <Trace d="M450 75 A80 80 0 1 1 449.9 75" amount={progress(t, 1.2, 2)} color={GOLD} width={2} />
      </svg>
      <div className="gate-person">{approved ? <Check /> : <UserRound />}</div>
      <div className="gate-tag gate-primary" style={{ color: BLUE }}>PRIMARY<br /><strong>GAMING</strong></div>
      <div className="gate-tag gate-additional" style={{ color: MINT }}>ADDITIONAL<br /><strong>TECH</strong></div>
      <div className="gate-status" style={{ color: approved ? MINT : GOLD }}>
        {approved ? <Check /> : <LockKeyhole />}{approved ? 'HUMAN APPROVED' : 'PENDING REVIEW'}
      </div>
    </div>
    <p className="film-foot" style={reveal(t, .5)}>Selection isn’t approval.</p>
  </SceneFrame>;
}
