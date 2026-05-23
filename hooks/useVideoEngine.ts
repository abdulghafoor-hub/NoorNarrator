import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  EditorLayer,
  GenerationSettings,
  BackgroundAsset,
  AspectRatio,
} from "../types";
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

// 1. Map Aspect Ratios to actual Canvas Native Resolutions
const getAspectDimensions = (ratio: AspectRatio) => {
  switch (ratio) {
    case AspectRatio.LANDSCAPE:
      return { width: 1920, height: 1080 };
    case AspectRatio.SQUARE:
      return { width: 1080, height: 1080 };
    case AspectRatio.FEED:
      return { width: 1080, height: 1350 };
    case AspectRatio.VERTICAL:
    default:
      return { width: 1080, height: 1920 };
  }
};

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

  // Immutable State Refs for lock-free 60fps rendering
  const stateRefs = useRef({ settings, layers, activeBgs });
  useEffect(() => {
    stateRefs.current = { settings, layers, activeBgs };
  }, [settings, layers, activeBgs]);

  const globalTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef({
    voice: null as HTMLAudioElement | null,
    bgm: null as AudioBufferSourceNode | null,
  });
  const loadedAssetsRef = useRef<
    Map<string, HTMLImageElement | HTMLVideoElement>
  >(new Map());
  const layoutCache = useRef<LayoutCache>(new Map());
  const rafRef = useRef<number>(0);

  const audioDuration = audioBuffer?.duration || 10;

  // Asset Loader
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
            v.playbackRate = stateRefs.current.settings.videoSpeed || 1.0;
            v.play().catch(() => {});
            newLoaded.set(bg.id, v);
          } else {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = bg.url;
            await new Promise((resolve) => {
              img.complete ? resolve(true) : (img.onload = () => resolve(true));
            });
            newLoaded.set(bg.id, img);
          }
        }
      }
      loadedAssetsRef.current = newLoaded;
    };
    loadAssets();
  }, [activeBgs]);

  // Update video speed live
  useEffect(() => {
    loadedAssetsRef.current.forEach((asset) => {
      if (asset instanceof HTMLVideoElement) {
        asset.playbackRate = settings.videoSpeed || 1.0;
      }
    });
  }, [settings.videoSpeed]);

  // THE MAIN RENDER LOOP
  useEffect(() => {
    const draw = () => {
      if (!canvasRef.current) return;
      const { settings, layers, activeBgs } = stateRefs.current;

      // FIX #1: ENFORCE SCREEN SELECTION ON CANVAS RESOLUTION
      const dims = getAspectDimensions(settings.aspectRatio);
      if (
        canvasRef.current.width !== dims.width ||
        canvasRef.current.height !== dims.height
      ) {
        canvasRef.current.width = dims.width;
        canvasRef.current.height = dims.height;
      }

      // FIX #2: PERFECT AUDIO SYNC
      let audioTime = pauseOffsetRef.current;
      if (playbackStatus === "playing" && sourcesRef.current.voice) {
        // We now read time directly from the playing Audio Element rather than AudioContext
        // This accounts for buffering and playback speed automatically without drifting.
        audioTime = sourcesRef.current.voice.currentTime;
      }

      globalTimeRef.current =
        audioTime % Math.max(0.1, audioDuration) || audioTime;

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
  }, [playbackStatus, audioDuration, canvasRef]);

  // AUDIO CONTROLS
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

    // BGM Ducking Setup
    if (stateRefs.current.settings.bgmEnabled && bgmBuffer) {
      const bgmSource = ctx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      const gainNode = ctx.createGain();

      const voiceSegments = analyzeVoiceActivity(audioBuffer);
      // Offset ducking by current playhead to maintain sync if paused and resumed
      const timeOffset = -(
        pauseOffsetRef.current / (stateRefs.current.settings.videoSpeed || 1.0)
      );
      applyAudioDucking(
        gainNode,
        stateRefs.current.settings.bgmVolume,
        voiceSegments,
        timeOffset,
      );

      bgmSource.connect(gainNode);
      gainNode.connect(ctx.destination);
      bgmSource.start(0, pauseOffsetRef.current % bgmBuffer.duration);
      sourcesRef.current.bgm = bgmSource;
    }

    loadedAssetsRef.current.forEach((asset) => {
      if (asset instanceof HTMLVideoElement) asset.play().catch(() => {});
    });

    setPlaybackStatus("playing");
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
      if (asset instanceof HTMLVideoElement) {
        asset.pause();
        asset.currentTime = 0;
      }
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
      loadedAssetsRef.current.forEach((asset) => {
        if (asset instanceof HTMLVideoElement && asset.duration > 0) {
          asset.currentTime = time % asset.duration;
        }
      });
    },
    [playbackStatus],
  );

  return {
    playbackStatus,
    globalTimeRef,
    loadedAssetsRef,
    audioDuration,
    playPreview,
    pausePreview,
    stopPreview,
    handleScrub,
    audioCtxRef,
    layoutCache,
  };
};
