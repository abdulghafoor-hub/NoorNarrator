import { useEffect, useRef, useState, useCallback } from "react";
import { EditorLayer, GenerationSettings, BackgroundAsset } from "../types";
import { drawVideoFrame, LayoutCache } from "../utils/videoUtils";
import {
  createSpiritualStudioChain,
  analyzeVoiceActivity,
  applyAudioDucking,
} from "../utils/audioEffects";

interface EngineProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  settings: GenerationSettings;
  layers: EditorLayer[];
  activeBgs: BackgroundAsset[];
  audioBuffer: AudioBuffer | null;
  audioUrl: string | null;
  bgmBuffer: AudioBuffer | null;
}

export const useVideoEngine = ({
  canvasRef,
  settings,
  layers,
  activeBgs,
  audioBuffer,
  audioUrl,
  bgmBuffer,
}: EngineProps) => {
  const [playbackStatus, setPlaybackStatus] = useState<
    "playing" | "paused" | "stopped"
  >("stopped");

  // 1. We use Refs for ALL state so the render loop NEVER has to restart when React re-renders.
  const stateRefs = useRef({ settings, layers, activeBgs });
  useEffect(() => {
    stateRefs.current = { settings, layers, activeBgs };
  }, [settings, layers, activeBgs]);

  const globalTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef({ voice: null as any, bgm: null as any });
  const loadedAssetsRef = useRef<
    Map<string, HTMLImageElement | HTMLVideoElement>
  >(new Map());
  const layoutCache = useRef<LayoutCache>(new Map());
  const rafRef = useRef<number>(0);

  const audioDuration = audioBuffer?.duration || 10;

  // 2. Asset Loader Pipeline
  useEffect(() => {
    const loadAssets = async () => {
      const newLoaded = new Map(loadedAssetsRef.current);
      for (const bg of stateRefs.current.activeBgs) {
        if (!newLoaded.has(bg.id)) {
          if (bg.type === "video") {
            const v = document.createElement("video");
            v.src = bg.url;
            v.muted = true;
            v.loop = true;
            v.crossOrigin = "anonymous";
            v.play().catch(() => {});
            newLoaded.set(bg.id, v);
          } else {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = bg.url;
            await new Promise((r) =>
              img.complete ? r(true) : (img.onload = () => r(true)),
            );
            newLoaded.set(bg.id, img);
          }
        }
      }
      loadedAssetsRef.current = newLoaded;
    };
    loadAssets();
  }, [activeBgs]);

  // 3. The Immutable Render Loop (Runs independent of React)
  useEffect(() => {
    const draw = () => {
      if (!canvasRef.current) return;
      const { settings, layers, activeBgs } = stateRefs.current;

      let audioTime = pauseOffsetRef.current;
      if (playbackStatus === "playing" && audioCtxRef.current) {
        audioTime +=
          audioCtxRef.current.currentTime * (settings.videoSpeed || 1.0);
      }

      globalTimeRef.current = audioTime % audioDuration || audioTime;

      // Extract valid assets
      const assetsToDraw = activeBgs
        .filter((bg) => loadedAssetsRef.current.has(bg.id))
        .map((bg) => ({
          id: bg.id,
          type: bg.type,
          element: loadedAssetsRef.current.get(bg.id)!,
        }));

      drawVideoFrame(
        canvasRef.current,
        assetsToDraw as any,
        layers,
        globalTimeRef.current,
        audioDuration,
        settings.backgroundAnimation,
        layoutCache.current,
        loadedAssetsRef.current,
      );

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playbackStatus, audioDuration, canvasRef]); // Loop only restarts if playback state or total duration changes

  // 4. Playback Controls
  const playPreview = useCallback(async () => {
    if (!audioUrl || !audioBuffer) return;

    if (!audioCtxRef.current)
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") await ctx.resume();

    // Voice Setup
    const audioEl = new Audio(audioUrl);
    audioEl.crossOrigin = "anonymous";
    audioEl.playbackRate = stateRefs.current.settings.videoSpeed || 1;
    audioEl.currentTime = pauseOffsetRef.current;
    sourcesRef.current.voice = audioEl;

    audioEl.onended = () => stopPreview();

    const voiceSource = ctx.createMediaElementSource(audioEl);
    createSpiritualStudioChain(ctx, voiceSource, ctx.destination);
    audioEl.play().catch(console.error);

    // BGM Setup
    if (stateRefs.current.settings.bgmEnabled && bgmBuffer) {
      const bgmSource = ctx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      const gainNode = ctx.createGain();

      const voiceSegments = analyzeVoiceActivity(audioBuffer);
      applyAudioDucking(
        gainNode,
        stateRefs.current.settings.bgmVolume,
        voiceSegments,
        0,
      );

      bgmSource.connect(gainNode);
      gainNode.connect(ctx.destination);
      bgmSource.start(0, pauseOffsetRef.current % bgmBuffer.duration);
      sourcesRef.current.bgm = bgmSource;
    }

    // Sync Videos
    loadedAssetsRef.current.forEach((asset) => {
      if (asset instanceof HTMLVideoElement) asset.play().catch(() => {});
    });

    setPlaybackStatus("playing");
    // Reset the context timer reference
    pauseOffsetRef.current = audioEl.currentTime;
  }, [audioUrl, audioBuffer, bgmBuffer]);

  const pausePreview = useCallback(() => {
    if (sourcesRef.current.voice) {
      pauseOffsetRef.current = sourcesRef.current.voice.currentTime;
      sourcesRef.current.voice.pause();
    }
    if (sourcesRef.current.bgm) sourcesRef.current.bgm.stop();

    loadedAssetsRef.current.forEach((asset) => {
      if (asset instanceof HTMLVideoElement) asset.pause();
    });

    setPlaybackStatus("paused");
  }, []);

  const stopPreview = useCallback(() => {
    if (sourcesRef.current.voice) sourcesRef.current.voice.pause();
    if (sourcesRef.current.bgm) sourcesRef.current.bgm.stop();
    loadedAssetsRef.current.forEach((asset) => {
      if (asset instanceof HTMLVideoElement) asset.pause();
    });

    pauseOffsetRef.current = 0;
    globalTimeRef.current = 0;
    setPlaybackStatus("stopped");
  }, []);

  const handleScrub = useCallback(
    (time: number) => {
      pauseOffsetRef.current = time;
      globalTimeRef.current = time;
      if (playbackStatus === "playing" && sourcesRef.current.voice) {
        sourcesRef.current.voice.currentTime = time;
      }
      // Sync Video Elements
      loadedAssetsRef.current.forEach((asset) => {
        if (asset instanceof HTMLVideoElement && asset.duration > 0) {
          asset.currentTime = time % asset.duration;
        }
      });
    },
    [playbackStatus],
  );

  // Handle external pauses
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && playbackStatus === "playing") pausePreview();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [playbackStatus, pausePreview]);

  return {
    playbackStatus,
    globalTimeRef,
    playPreview,
    pausePreview,
    stopPreview,
    handleScrub,
    loadedAssetsRef,
    audioDuration,
    audioCtxRef, // we might need it for export
    layoutCache,
  };
};
