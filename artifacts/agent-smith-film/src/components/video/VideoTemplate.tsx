import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { VideoCanvas, VideoPausedContext, useVideoPlayer } from '@/lib/video';
import { ContinuitySeal, FilmHeader } from './Primitives';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';
import { Scene7 } from './video_scenes/Scene7';
import { Scene8 } from './video_scenes/Scene8';
import './film.css';

export const SCENE_DURATIONS = {
  identity: 5000, community: 7000, enrollment: 8000, review: 8000,
  moderation: 7000, maintenance: 7000, tools: 7000, finale: 6000,
};
const SCENES = [Scene1, Scene2, Scene3, Scene4, Scene5, Scene6, Scene7, Scene8];
const KEYS = Object.keys(SCENE_DURATIONS);
const SCENE_START_SEC = Object.fromEntries(KEYS.map((key, i) => [
  key, Object.values(SCENE_DURATIONS).slice(0, i).reduce((sum, ms) => sum + ms, 0) / 1000,
]));
export default function VideoTemplate({
  durations = SCENE_DURATIONS, loop = true, paused = false, muted = false, onSceneChange,
}: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const sceneIndex = KEYS.indexOf(baseSceneKey);
  const Scene = SCENES[sceneIndex];
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastScene = useRef<string | null>(null);
  const timingScene = useRef<string | null>(null);
  const elapsedBase = useRef(0);
  const runningSince = useRef<number | null>(null);
  const needsStartupSync = useRef(true);
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  useEffect(() => {
    if (timingScene.current !== currentSceneKey) {
      timingScene.current = currentSceneKey;
      elapsedBase.current = 0;
    }
    if (paused) { runningSince.current = null; return; }
    const started = performance.now();
    runningSince.current = started;
    return () => {
      elapsedBase.current += performance.now() - started;
      runningSince.current = null;
    };
  }, [currentSceneKey, paused]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = .45;
    if (paused) { audio.pause(); return; }
    let alignAfterFirstTick: (() => void) | undefined;
    const play = () => {
      const sceneChanged = lastScene.current !== currentSceneKey;
      const align = () => {
        const elapsed = elapsedBase.current + (runningSince.current === null ? 0 : performance.now() - runningSince.current);
        const target = (SCENE_START_SEC[baseSceneKey] ?? 0) + elapsed / 1000;
        if (Math.abs(audio.currentTime - target) > .18) audio.currentTime = target;
      };
      if (sceneChanged) {
        needsStartupSync.current = true;
        align();
        lastScene.current = currentSceneKey;
      }
      if (needsStartupSync.current) {
        alignAfterFirstTick = () => {
          if (audio.paused || audio.currentTime <= .01) return;
          align();
          // Some audio sinks report "playing" before their startup buffer has
          // settled. Use native media ticks for a bounded initial correction.
          const elapsed = elapsedBase.current + (runningSince.current === null ? 0 : performance.now() - runningSince.current);
          if (elapsed >= 3000) {
            needsStartupSync.current = false;
            if (alignAfterFirstTick) audio.removeEventListener('timeupdate', alignAfterFirstTick);
          }
        };
        audio.addEventListener('timeupdate', alignAfterFirstTick);
      }
      audio.play().then(() => {
        delete audio.dataset.autoplayBlocked;
        // Metadata or buffering may finish after the visuals have started.
        // Correct that startup delay without seeking on pause/resume.
        if (sceneChanged && timingScene.current === currentSceneKey && !audio.paused) align();
      }).catch(() => {
        // Browsers may require a preview control click before audible playback.
        audio.dataset.autoplayBlocked = 'true';
      });
    };
    if (audio.readyState >= 1) play();
    else audio.addEventListener('loadedmetadata', play, { once: true });
    return () => {
      audio.removeEventListener('loadedmetadata', play);
      if (alignAfterFirstTick) audio.removeEventListener('timeupdate', alignAfterFirstTick);
    };
  }, [currentSceneKey, baseSceneKey, paused, muted]);
  return <VideoPausedContext.Provider value={paused}>
    <VideoCanvas aspectRatio="16:9" className="smith-film">
      <motion.div className="film-camera" initial={false}
        animate={{ rotate: sceneIndex % 2 ? .12 : -.12 }}
        transition={{ duration: 1.5 }}>
        <AnimatePresence mode="sync"><Scene key={currentSceneKey} /></AnimatePresence>
      </motion.div>
      <ContinuitySeal scene={sceneIndex} /><FilmHeader scene={sceneIndex} />
      <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted} />
    </VideoCanvas>
  </VideoPausedContext.Provider>;
}
