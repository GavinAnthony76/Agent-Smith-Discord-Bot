import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Repeat, Volume2, VolumeX, ChevronDown, ChevronUp } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';

const TITLES = ['Identity', 'Three paths', 'Enrollment', 'Human review', 'Moderation', 'Durable state', 'Community tools', 'Finale'];
const formatTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function PlaybackStatus({ controls, onJump }: {
  controls: ReturnType<typeof useSceneControls>; onJump: (index: number) => void;
}) {
  const { tick, paused, activeDuration, activeStartTime, totalDuration, activeIndex, sceneKeys } = controls;
  const [elapsed, setElapsed] = useState(0);
  const base = useRef(0);
  useEffect(() => { base.current = 0; setElapsed(0); }, [tick]);
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(base.current + performance.now() - start), 60);
    return () => { window.clearInterval(id); base.current += performance.now() - start; };
  }, [tick, paused]);
  const time = Math.min(totalDuration, activeStartTime + Math.min(elapsed, activeDuration));
  return <>
    <div className="scene-segments">{sceneKeys.map((key, i) => <button key={key}
      title={TITLES[i]} aria-label={`Jump to scene ${i + 1}: ${TITLES[i]}`}
      aria-current={i === activeIndex ? 'true' : undefined} onClick={() => onJump(i)}>
      <i style={{ width: `${i === activeIndex ? Math.min(1, elapsed / activeDuration) * 100 : 0}%` }} />
    </button>)}</div>
    <span className="scene-counter">{activeIndex + 1}/{sceneKeys.length}</span>
    <span className="playback-time" role="timer">{formatTime(time)} / {formatTime(totalDuration)}</span>
  </>;
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const controls = useSceneControls(SCENE_DURATIONS);
  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const sensor = useRef<HTMLDivElement>(null);
  const handleJump = useCallback((index: number) => {
    controls.jumpTo(index);
    window.parent.postMessage({ type: 'REPLIT_VIDEO_SCENE_SELECTED', payload: {
      sceneIndex: index, sceneCount: TITLES.length, sceneTitle: TITLES[index],
      filePath: `src/components/video/video_scenes/Scene${index + 1}.tsx`, lineNumber: 1,
    } }, '*');
  }, [controls.jumpTo]);
  useEffect(() => {
    if (!controls.paused) return;
    const frozen = document.getAnimations().filter(a => a.playState === 'running');
    frozen.forEach(a => a.pause());
    return () => frozen.forEach(a => a.play());
  }, [controls.paused]);
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const outside = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && !sensor.current?.contains(e.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [collapsed, tapPinned]);
  if (!isIframed) return <VideoTemplate />;
  const visible = !collapsed || hovering || tapPinned;
  return <div className="video-preview">
    <VideoTemplate key={controls.mountKey} durations={controls.durations} loop
      paused={controls.paused} muted={muted} onSceneChange={controls.onSceneChange} />
    <div ref={sensor} className="control-sensor"
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHovering(true); }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setHovering(false); }}
      onPointerDown={e => { if (e.pointerType !== 'mouse' && collapsed) setTapPinned(true); }}>
      <div className={`film-controls ${visible ? '' : 'controls-hidden'}`} aria-hidden={!visible} inert={!visible}>
        <button aria-label={controls.paused ? 'Play' : 'Pause'} title={controls.paused ? 'Play' : 'Pause'} onClick={controls.togglePause}>
          {controls.paused ? <Play /> : <Pause />}</button>
        <button aria-label="Loop current scene" title="Loop current scene" aria-pressed={controls.locked}
          onClick={controls.toggleLock}><Repeat /></button>
        <button aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}
          onClick={() => setMuted(v => !v)}>{muted ? <VolumeX /> : <Volume2 />}</button>
        <div className="control-divider" />
        <PlaybackStatus controls={controls} onJump={handleJump} />
        <button aria-label={collapsed ? 'Show controls' : 'Hide controls'} aria-expanded={!collapsed}
          onClick={() => { setCollapsed(v => !v); setHovering(false); setTapPinned(false); }}>
          {collapsed ? <ChevronUp /> : <ChevronDown />}</button>
      </div>
    </div>
  </div>;
}
