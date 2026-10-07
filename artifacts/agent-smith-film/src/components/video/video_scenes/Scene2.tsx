import { Cross, Gamepad2, Cpu } from 'lucide-react';
import { BLUE, GOLD, MINT, SceneFrame, Trace, progress, reveal, useFilmClock } from '../Primitives';

const PATHS = [
  { name: 'FAITH', sub: 'GROW', color: GOLD, Icon: Cross },
  { name: 'GAMING', sub: 'CONNECT', color: BLUE, Icon: Gamepad2 },
  { name: 'TECH', sub: 'CREATE', color: MINT, Icon: Cpu },
];
export function Scene2() {
  const t = useFilmClock(7);
  return <SceneFrame name="Three paths" theme="community-field" t={t} duration={7}>
    <h2 className="community-title">Three paths.<span style={reveal(t, .8)}>One community.</span></h2>
    <svg className="world-lines" viewBox="0 0 1000 600" preserveAspectRatio="none">
      <Trace d="M200 340 C200 235 340 165 500 165" amount={progress(t, 1.8, 1.5)} color={GOLD} />
      <Trace d="M500 340 L500 165" amount={progress(t, 2.1, 1.3)} color={BLUE} />
      <Trace d="M800 340 C800 235 660 165 500 165" amount={progress(t, 2.4, 1.3)} color={MINT} />
      <Trace d="M200 355 C250 555 750 555 800 355" amount={progress(t, 3.8, 2.5)} color={GOLD} width={1} />
      <circle cx={200 + progress(t, 3.8, 2.2) * 600} cy={390 + Math.sin(progress(t, 3.8, 2.2) * Math.PI) * 85}
        r="4" fill={GOLD} opacity={progress(t, 3.8)} />
    </svg>
    {PATHS.map(({ name, sub, color, Icon }, i) => <div className="community-node" key={name}
      style={{ left: `${20 + i * 30}%`, color, opacity: progress(t, .3 + i * .5),
        transform: `translate(-50%,-50%) scale(${.88 + progress(t, .3 + i * .5) * .12 - progress(t, 5.8, 1.2) * .035})` }}>
      <div className="community-disc"><Icon strokeWidth={1.1} /></div>
      <h3>{name}</h3><div className="eyebrow">{sub}</div>
    </div>)}
    <div className="shared-hub" style={reveal(t, 3.3)}>SHARED HUB</div>
  </SceneFrame>;
}
