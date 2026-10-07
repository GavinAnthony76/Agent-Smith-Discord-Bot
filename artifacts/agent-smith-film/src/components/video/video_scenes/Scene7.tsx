import { Rss, Trophy, Check } from 'lucide-react';
import { BLUE, GOLD, MINT, Eyebrow, SceneFrame, progress, reveal, useFilmClock } from '../Primitives';

export function Scene7() {
  const t = useFilmClock(7);
  return <SceneFrame name="Community tools" theme="tools-field" t={t} duration={7}>
    <h2 className="tools-title">Community tools.</h2>
    <div className="tools-pane feed-pane">
      <Eyebrow>OWNER-APPROVED FEEDS</Eyebrow>
      <Rss className="tool-glyph" strokeWidth={.8} />
      <div className="source-lines">{['FAITH', 'GAMING', 'TECH'].map((label, i) => <div key={label}
        style={{ color: [GOLD, BLUE, MINT][i] }}><span>{label}</span><i style={{
          transform: `scaleX(${progress(t, .6 + i * .8, 1.5)})`,
        }} /><b style={{ opacity: progress(t, 1.2 + i * .8) }} /></div>)}</div>
      <div className="delivery-receipt" style={reveal(t, 2.8)}><Check />TRACKED DELIVERY</div>
    </div>
    <div className="tools-pane xp-pane"><Eyebrow>PARTICIPATION XP</Eyebrow>
      <Trophy className="tool-glyph" strokeWidth={.8} />
      <div className="xp-rungs">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{
        height: `${4 + i * 3}vmin`, backgroundColor: i < 6 ? GOLD : '#29392e',
        transform: `scaleY(${progress(t, 1.2 + i * .5, .8)})`, opacity: i < 6 ? 1 : .65,
      }} />)}</div>
      <div className="xp-caption" style={reveal(t, 3.3)}>VERIFIED PARTICIPATION</div>
      <div className="xp-limits" style={reveal(t, 4.4)}>COOLDOWNS / DAILY LIMITS</div>
    </div>
    <p className="film-foot">Illustrative capabilities. Features require configuration.</p>
  </SceneFrame>;
}
