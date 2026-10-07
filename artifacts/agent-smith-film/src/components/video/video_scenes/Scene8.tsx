import { SceneFrame, progress, reveal, useFilmClock } from '../Primitives';

export function Scene8() {
  const t = useFilmClock(6);
  const word = t < .8 ? 'BELONG.' : t < 1.6 ? 'BUILD.' : 'GROW.';
  return <SceneFrame name="Finale" theme="finale-field" t={t} duration={6}>
    <div className="finale-rule" style={{ width: `${progress(t, .1, 4.8) * 80}%` }} />
    <div className="finale-copy" style={{ opacity: 1 - progress(t, 4.85, .45) }}>
      <div className="finale-words" style={{ opacity: 1 - progress(t, 2.3, .3) }}>{word}</div>
      <div className="finale-lockup" style={reveal(t, 2.4)}>
        <h2>HALLOWED<br />CORE</h2><p style={reveal(t, 2.7)}>Maintained by Agent Smith.</p>
        <div className="finale-frameworks" style={reveal(t, 3.2)}>FAITH / GAMING / TECH</div>
      </div>
    </div>
    <div className="finale-return" style={{ opacity: progress(t, 5.4, .6) }} />
  </SceneFrame>;
}
