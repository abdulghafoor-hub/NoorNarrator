import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Video,
  Download,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  History,
  Volume2,
  Mic2,
  ArrowLeft,
  Image as ImageIcon,
  Smartphone,
  Monitor,
  Instagram,
  Facebook,
  AlertCircle,
  Edit3,
  Plus,
  Trash2,
  Layers,
  Settings,
  Move,
  Type as TypeIcon,
  Sliders,
  X,
  Check,
  Save,
  Clock,
  Copy,
  Upload,
  CheckCircle2,
} from "lucide-react";
import {
  VoiceName,
  NarrationHistoryItem,
  GenerationSettings,
  AnimationType,
  BackgroundSource,
  SEOMetadata,
  AspectRatio,
  EditorLayer,
  LayerType,
  TextEffect,
  ImageEffect,
  BackgroundAnimation,
  BackgroundAsset,
  TextPosition,
} from "./types";
import {
  generateNarration,
  generateAtmosphereImage,
  generateSEOMetadata,
  generateVisualPrompt,
  generateThumbnailData,
  processScript,
  generateVideoScenes,
} from "./services/geminiService";
import {
  decode,
  decodeAudioData,
  analyzeAudioSilence,
  encodeAudioBufferToWav,
} from "./utils/audioUtils";
import {
  createSpiritualStudioChain,
  analyzeVoiceActivity,
  applyAudioDucking,
} from "./utils/audioEffects";
import { useVideoEngine } from "./hooks/useVideoEngine";
import { Timeline } from "./components/Timeline";
import { AssetLibrary } from "./components/AssetLibrary";
import { MediaAsset } from "./services/mediaApiClient";
import {
  drawVideoFrame,
  normalizeText,
  createCompositeThumbnail,
  LayoutCache,
} from "./utils/videoUtils";

const DEFAULT_TEXT = ``;
const STORAGE_KEY = "noor_last_used_text";

const ASPECT_RATIO_CONFIG = {
  [AspectRatio.VERTICAL]: {
    width: 1080,
    height: 1920,
    label: "Reels / TikTok",
    icon: Smartphone,
  },
  [AspectRatio.LANDSCAPE]: {
    width: 1920,
    height: 1080,
    label: "YouTube / Desktop",
    icon: Monitor,
  },
  [AspectRatio.SQUARE]: {
    width: 1080,
    height: 1080,
    label: "Instagram Feed",
    icon: Instagram,
  },
  [AspectRatio.FEED]: {
    width: 1080,
    height: 1350,
    label: "Facebook / Portrait",
    icon: Facebook,
  },
};

const getGeminiAspectRatio = (ratio: AspectRatio): string => {
  switch (ratio) {
    case AspectRatio.VERTICAL:
      return "9:16";
    case AspectRatio.SQUARE:
      return "1:1";
    case AspectRatio.FEED:
      return "3:4";
    default:
      return "16:9";
  }
};

type PlaybackStatus = "playing" | "paused" | "stopped";

const App: React.FC = () => {
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    const savedText = localStorage.getItem(STORAGE_KEY);
    return {
      text: savedText || DEFAULT_TEXT,
      voice: VoiceName.CHARON,
      generateImage: true,
      style: "Starry night sky over a peaceful mosque silhouette",
      animationType: AnimationType.VERTICAL_SCROLL,
      backgroundAnimation: BackgroundAnimation.ZOOM_IN,
      textPosition: TextPosition.CENTER,
      aspectRatio: AspectRatio.VERTICAL,
      backgroundSource: BackgroundSource.AI,
      selectedBackgroundIds: [], // Initialized as empty array
      bgmEnabled: false,
      bgmVolume: 0.15,
      bgmUrl: "", // Empty by default to prevent fetch errors
      videoSpeed: 1.0,
    };
  });

  const [backgrounds, setBackgrounds] = useState<BackgroundAsset[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingBG, setIsGeneratingBG] = useState(false);
  const [isGeneratingThumb, setIsGeneratingThumb] = useState(false);

  const [isDraggingText, setIsDraggingText] = useState(false);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDraggingText(true);
    handleMouseMove(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingText) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;

    // constrain to canvas bounds
    x = Math.max(0.05, Math.min(0.95, x));
    y = Math.max(0.05, Math.min(0.95, y));

    setSettings((s) => ({
      ...s,
      customX: x,
      customY: y,
      textPosition: TextPosition.CENTER,
    }));

    setLayers((prev) =>
      prev.map((l) => {
        if (l.id === "narration-main") {
          return {
            ...l,
            customX: x,
            customY: y,
            positionPreference: TextPosition.CENTER,
          };
        }
        return l;
      }),
    );
  };

  const handleMouseUp = () => {
    setIsDraggingText(false);
  };

  const [isRecording, setIsRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [bgmError, setBgmError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [currentResult, setCurrentResult] = useState<{
    audioUrl: string;
    audioBuffer?: AudioBuffer;
    base64Audio: string;
    seo?: SEOMetadata;
    thumbnailUrl?: string;
  } | null>(null);

  const [layers, setLayers] = useState<EditorLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [history, setHistory] = useState<NarrationHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [bgmBuffer, setBgmBuffer] = useState<AudioBuffer | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recordCanvasRef = useRef<HTMLCanvasElement>(null);

  const stopSignalRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Order active backgrounds based on the SELECTION array order
  const activeBgs = useMemo(() => {
    return settings.selectedBackgroundIds
      .map((id) => backgrounds.find((bg) => bg.id === id))
      .filter((bg): bg is BackgroundAsset => !!bg);
  }, [backgrounds, settings.selectedBackgroundIds]);

  const {
    playbackStatus,
    globalTimeRef,
    playPreview,
    pausePreview,
    stopPreview,
    handleScrub,
    loadedAssetsRef,
    audioDuration,
    audioCtxRef,
    layoutCache,
  } = useVideoEngine({
    canvasRef,
    settings,
    layers,
    activeBgs,
    audioBuffer: currentResult?.audioBuffer || null,
    audioUrl: currentResult?.audioUrl || null,
    bgmBuffer,
  });

  const duration = useMemo(
    () => audioDuration / (settings.videoSpeed || 1),
    [audioDuration, settings.videoSpeed],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, settings.text);
    // Invalidate cache when text changes
    layoutCache.current.clear();
  }, [settings.text]);

  // Load BGM
  useEffect(() => {
    setBgmError(null);
    if (!settings.bgmUrl) {
      setBgmBuffer(null);
      return;
    }
    const loadBgm = async () => {
      try {
        const response = await fetch(settings.bgmUrl!);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (!audioCtxRef.current)
          audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
        const decoded = await audioCtxRef.current.decodeAudioData(arrayBuffer);
        setBgmBuffer(decoded);
      } catch (e: any) {
        console.error("Failed to load BGM:", e);
        setBgmBuffer(null);
        setBgmError(e.message || "Failed to load audio file");
        // Clear the URL if it's the old default that might be failing
        if (
          settings.bgmUrl ===
          "https://upload.wikimedia.org/wikipedia/commons/6/61/Descent_-_Ambient_Music.ogg"
        ) {
          setSettings((s) => ({ ...s, bgmUrl: "" }));
        }
      }
    };
    loadBgm();
  }, [settings.bgmUrl]);

  // Invalidate cache when aspect ratio or voice changes
  useEffect(() => {
    layoutCache.current.clear();
  }, [settings.aspectRatio, settings.voice]);

  useEffect(() => {
    if (currentResult) {
      const normalized = normalizeText(settings.text);
      const audioMetadata = currentResult.audioBuffer
        ? analyzeAudioSilence(currentResult.audioBuffer)
        : undefined;
      setLayers((prev) => {
        const customLayers = prev.filter((l) => l.id !== "narration-main");
        return [
          {
            id: "narration-main",
            type: LayerType.NARRATION,
            startTime: 0,
            endTime: audioDuration,
            visible: true,
            zIndex: 1,
            text: normalized,
            animationType: settings.animationType,
            positionPreference: settings.textPosition,
            customX: settings.customX,
            customY: settings.customY,
            audioMetadata,
          },
          ...customLayers,
        ];
      });
    }
  }, [currentResult, audioDuration, settings.text, settings.animationType]);

  const handleGenerate = async () => {
    if (!settings.text.trim()) return;
    setIsGenerating(true);
    setErrorMsg(null);
    stopSignalRef.current = false;
    setCurrentResult(null);
    stopPreview();
    layoutCache.current.clear(); // Clear cache on new generation

    try {
      if (!audioCtxRef.current)
        audioCtxRef.current = new AudioContext({ sampleRate: 24000 });

      // Pass user's text down directly without changing it
      const processedScript = settings.text;

      const normalizedScript = normalizeText(processedScript);

      // 1. Generate Narration
      const base64Audio = await generateNarration(
        normalizedScript,
        settings.voice,
      );
      if (stopSignalRef.current) return;
      const audioData = decode(base64Audio);
      const audioBuffer = await decodeAudioData(
        audioData,
        audioCtxRef.current,
        24000,
        1,
      );
      const wavData = encodeAudioBufferToWav(audioBuffer);
      const audioUrl = URL.createObjectURL(
        new Blob([wavData], { type: "audio/wav" }),
      );

      // 2. Dynamic Visual Prompt
      const dynamicPrompt = await generateVisualPrompt(normalizedScript);
      setSettings((s) => ({ ...s, style: dynamicPrompt })); // Update UI with new prompt

      // 3. SEO & Image & Thumbnail Data
      const seoPromise = generateSEOMetadata(normalizedScript);
      const thumbDataPromise = generateThumbnailData(normalizedScript);

      const targetRatio = getGeminiAspectRatio(settings.aspectRatio);
      const bgPromises: Promise<string | null>[] = [];

      if (settings.generateImage) {
        // Generate 3 images for a dynamic slideshow
        bgPromises.push(
          generateAtmosphereImage(
            dynamicPrompt + ", scene 1, establishing shot",
            targetRatio,
          ),
        );
        bgPromises.push(
          generateAtmosphereImage(
            dynamicPrompt + ", scene 2, different perspective",
            targetRatio,
          ),
        );
        bgPromises.push(
          generateAtmosphereImage(
            dynamicPrompt + ", scene 3, cinematic detail",
            targetRatio,
          ),
        );
      }

      const results = await Promise.all([
        seoPromise,
        thumbDataPromise,
        ...bgPromises,
      ]);
      const seo = results[0] as SEOMetadata;
      const thumbData = results[1] as {
        visualPrompt: string;
        overlayText: string;
        styleCategory: string;
        colorPop: string;
      };
      const bgUrls = results.slice(2) as (string | null)[];

      const newBgs: BackgroundAsset[] = [];
      bgUrls.forEach((bgUrl, index) => {
        if (bgUrl) {
          newBgs.push({
            id: Date.now().toString() + index,
            url: bgUrl,
            source: BackgroundSource.AI,
            type: "image",
          });
        }
      });

      if (newBgs.length > 0) {
        setBackgrounds((prev) => [...prev, ...newBgs]);
        setSettings((s) => ({
          ...s,
          selectedBackgroundIds: newBgs.map((bg) => bg.id),
        }));
      }

      let rawThumbnailUrl: string | null = null;
      let finalThumbnailUrl: string | null = null;

      if (thumbData) {
        rawThumbnailUrl = await generateAtmosphereImage(
          thumbData.visualPrompt,
          targetRatio,
        );
        if (rawThumbnailUrl) {
          const dims = ASPECT_RATIO_CONFIG[settings.aspectRatio];
          const thumbWidth =
            settings.aspectRatio === AspectRatio.LANDSCAPE ? 1280 : dims.width;
          const thumbHeight =
            settings.aspectRatio === AspectRatio.LANDSCAPE ? 720 : dims.height;
          finalThumbnailUrl = await createCompositeThumbnail(
            rawThumbnailUrl,
            thumbData.overlayText,
            thumbData.styleCategory,
            thumbData.colorPop,
            thumbWidth,
            thumbHeight,
          );
        }
      }

      if (stopSignalRef.current) return;
      setCurrentResult({
        audioUrl,
        audioBuffer,
        base64Audio,
        seo,
        thumbnailUrl: finalThumbnailUrl || undefined,
      });

      setHistory((prev) => [
        {
          id: Date.now().toString(),
          text: settings.text,
          voice: settings.voice,
          timestamp: Date.now(),
          audioUrl,
          imageUrl: newBgs[0]?.url || activeBgs[0]?.url,
          thumbnailUrl: finalThumbnailUrl || undefined,
          seo,
          aspectRatio: settings.aspectRatio,
        },
        ...prev,
      ]);
    } catch (e: any) {
      if (!stopSignalRef.current)
        setErrorMsg(e.message || "An error occurred.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateThumbnail = async () => {
    if (!currentResult || !settings.text) return;
    setIsGeneratingThumb(true);
    try {
      const normalizedScript = normalizeText(settings.text);
      const thumbData = await generateThumbnailData(normalizedScript);
      const targetRatio = getGeminiAspectRatio(settings.aspectRatio);

      const rawThumbnailUrl = await generateAtmosphereImage(
        thumbData.visualPrompt,
        targetRatio,
      );

      if (rawThumbnailUrl) {
        const dims = ASPECT_RATIO_CONFIG[settings.aspectRatio];
        const thumbWidth =
          settings.aspectRatio === AspectRatio.LANDSCAPE ? 1280 : dims.width;
        const thumbHeight =
          settings.aspectRatio === AspectRatio.LANDSCAPE ? 720 : dims.height;
        const finalThumbnailUrl = await createCompositeThumbnail(
          rawThumbnailUrl,
          thumbData.overlayText,
          thumbData.styleCategory,
          thumbData.colorPop,
          thumbWidth,
          thumbHeight,
        );

        setCurrentResult((prev) =>
          prev ? { ...prev, thumbnailUrl: finalThumbnailUrl } : null,
        );
      }
    } catch (e: any) {
      setErrorMsg("Failed to regenerate thumbnail.");
    } finally {
      setIsGeneratingThumb(false);
    }
  };

  const generateAdditionalBG = async () => {
    setIsGeneratingBG(true);
    try {
      const targetRatio = getGeminiAspectRatio(settings.aspectRatio);
      const imageUrl = await generateAtmosphereImage(
        settings.style,
        targetRatio,
      );
      if (imageUrl) {
        const newBg: BackgroundAsset = {
          id: Date.now().toString(),
          url: imageUrl,
          source: BackgroundSource.AI,
          type: "image",
        };
        setBackgrounds((prev) => [...prev, newBg]);
        setSettings((s) => ({
          ...s,
          selectedBackgroundIds: [...s.selectedBackgroundIds, newBg.id],
        }));
      }
    } catch (e: any) {
      setErrorMsg("Failed to generate background.");
    } finally {
      setIsGeneratingBG(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        const newBg: BackgroundAsset = {
          id: Date.now().toString(),
          url,
          source: BackgroundSource.CUSTOM,
          type: file.type.startsWith("video") ? "video" : "image",
        };
        setBackgrounds((prev) => [...prev, newBg]);
        setSettings((s) => ({
          ...s,
          selectedBackgroundIds: [...s.selectedBackgroundIds, newBg.id],
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBgmUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setSettings((s) => ({ ...s, bgmUrl: url, bgmEnabled: true }));
    }
  };

  const toggleBackgroundSelection = (id: string) => {
    setSettings((prev) => {
      const exists = prev.selectedBackgroundIds.includes(id);
      if (exists) {
        return {
          ...prev,
          selectedBackgroundIds: prev.selectedBackgroundIds.filter(
            (bid) => bid !== id,
          ),
        };
      } else {
        return {
          ...prev,
          selectedBackgroundIds: [...prev.selectedBackgroundIds, id],
        };
      }
    });
  };

  const handleAddTextLayer = () => {
    const newId = `text-${Date.now()}`;
    setLayers((prev) => [
      ...prev,
      {
        id: newId,
        type: LayerType.TEXT,
        startTime: 0,
        endTime: audioDuration,
        visible: true,
        zIndex: prev.length + 1,
        text: "New Text",
        fontSize: 48,
        color: "#ffffff",
        animation: "fade",
        x: 0.5,
        y: 0.5,
      } as any,
    ]);
    setSelectedLayerId(newId);
  };

  const handleAddMediaAsset = (asset: MediaAsset) => {
    if (asset.type === "audio") {
      if (!settings.bgmEnabled)
        setSettings((s) => ({ ...s, bgmEnabled: true }));
      setSettings((s) => ({ ...s, bgmUrl: asset.srcUrl }));
      return;
    }

    const newId = `media-${Date.now()}`;
    setLayers((prev) => [
      ...prev,
      {
        id: newId,
        type: asset.type === "video" ? LayerType.VIDEO : LayerType.IMAGE,
        startTime: globalTimeRef.current,
        endTime: duration > 0 ? duration : 99999,
        visible: true,
        zIndex: 0,
        srcUrl: asset.srcUrl,
        duration: duration > 0 ? duration : 99999,
        trimStart: 0,
      } as any,
    ]);
    setSelectedLayerId(newId);

    if (asset.type === "video") {
      const v = document.createElement("video");
      v.src = asset.srcUrl;
      v.muted = true;
      v.crossOrigin = "anonymous";
      v.loop = true;
      v.onloadedmetadata = () => {
        // the video is set to loop, so we don't need to shrink the endTime to v.duration.
      };
      loadedAssetsRef.current.set(newId, v);
    } else {
      const img = new Image();
      img.src = asset.srcUrl;
      img.crossOrigin = "anonymous";
      loadedAssetsRef.current.set(newId, img);
    }
  };

  const updateLayer = (id: string, updates: Partial<EditorLayer>) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id ? ({ ...l, ...updates } as EditorLayer) : l,
      ),
    );
  };

  const handleSplitLayer = (id: string, time: number) => {
    setLayers((prev) => {
      const layerIdx = prev.findIndex((l) => l.id === id);
      if (layerIdx === -1) return prev;
      const layer = prev[layerIdx];
      if (time <= layer.startTime || time >= layer.endTime) return prev; // Cannot split outside bounds

      const newLayer = { ...layer, id: Date.now().toString(), startTime: time };
      const updatedLayer = { ...layer, endTime: time };

      const nextLayers = [...prev];
      nextLayers[layerIdx] = updatedLayer;
      nextLayers.splice(layerIdx + 1, 0, newLayer as any);
      return nextLayers;
    });
  };

  const startExport = async () => {
    if (!currentResult?.audioBuffer) return;
    stopPreview();
    setIsRecording(true);
    setRecordProgress(0);
    const config = ASPECT_RATIO_CONFIG[settings.aspectRatio];
    const canvas = recordCanvasRef.current!;
    canvas.width = config.width;
    canvas.height = config.height;

    try {
      // 1. Synthesize Audio via Offline Audio Context
      const exportSampleRate = 48000;
      const offlineCtx = new OfflineAudioContext(
        currentResult.audioBuffer.numberOfChannels,
        Math.ceil(duration * exportSampleRate),
        exportSampleRate,
      );

      // Voice
      const voiceSource = offlineCtx.createBufferSource();
      voiceSource.buffer = currentResult.audioBuffer;
      voiceSource.playbackRate.value = settings.videoSpeed || 1.0;
      createSpiritualStudioChain(
        offlineCtx as any,
        voiceSource as any,
        offlineCtx.destination as any,
      );
      voiceSource.start(0);

      // BGM
      if (settings.bgmEnabled && bgmBuffer) {
        const bgmSource = offlineCtx.createBufferSource();
        bgmSource.buffer = bgmBuffer;
        bgmSource.loop = true;
        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = settings.bgmVolume;

        const voiceSegments = analyzeVoiceActivity(currentResult.audioBuffer);
        // applyAudioDucking relies on current time of playback, we can use 0 for offline
        applyAudioDucking(gainNode, settings.bgmVolume, voiceSegments, 0);

        bgmSource.connect(gainNode);
        gainNode.connect(offlineCtx.destination);
        bgmSource.start(0);
      }

      const renderedAudio = await offlineCtx.startRendering();

      // Ensure offscreen video assets are tracked
      const exportAssets = activeBgs
        .filter((bg) => loadedAssetsRef.current.has(bg.id))
        .map((bg) => ({
          id: bg.id,
          type: bg.type,
          element: loadedAssetsRef.current.get(bg.id)!,
        }));

      layers.forEach((layer) => {
        if (
          (layer.type === LayerType.VIDEO || layer.type === LayerType.IMAGE) &&
          loadedAssetsRef.current.has(layer.id)
        ) {
          exportAssets.push({
            id: layer.id,
            type: layer.type === LayerType.VIDEO ? "video" : "image",
            element: loadedAssetsRef.current.get(layer.id)! as any,
          });
        }
      });

      // 2. Export Deterministically
      const { exportDeterministicVideo } = await import("./utils/exportUtils");
      const blob = await exportDeterministicVideo(
        canvas,
        30, // fps
        duration,
        config.width,
        config.height,
        (time) => {
          // Sync Videos First
          exportAssets.forEach((a) => {
            if (a.type === "video" && a.element) {
              a.element.currentTime = time % (a.element.duration || 10);
            }
          });
          drawVideoFrame(
            canvas,
            exportAssets as any,
            layers,
            time * (settings.videoSpeed || 1.0),
            audioDuration,
            settings.backgroundAnimation,
            layoutCache.current,
            loadedAssetsRef.current,
          );
        },
        renderedAudio,
        (progress) => setRecordProgress(progress * 100),
      );

      console.log("Blob generated", blob.size, blob.type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `noor-studio-${Date.now()}.mp4`;
      a.click();

      // Delay to ensure the download starts before object URL might get collected (rare but safe)
      await new Promise((r) => setTimeout(r, 500));
    } catch (e: any) {
      console.error("Export Error:", e);
      setErrorMsg(
        `Video Export failed: ${e?.message ?? "Unsupported in this browser."}`,
      );
    } finally {
      setIsRecording(false);
    }
  };

  const generateFullVideoTimeline = async () => {
    if (!settings.text.trim()) return;
    setIsGenerating(true);
    setErrorMsg("");
    try {
      const scenes = await generateVideoScenes(settings.text);
      const newLayers: EditorLayer[] = [];

      // Process each scene for background assets
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const isLastScene = i === scenes.length - 1;

        const startTimeTokens = scene.start_time.split(":");
        const endTimeTokens = scene.end_time.split(":");

        const startSeconds =
          parseInt(startTimeTokens[0]) * 3600 +
          parseInt(startTimeTokens[1]) * 60 +
          parseInt(startTimeTokens[2] || "0");
        let endSeconds =
          parseInt(endTimeTokens[0]) * 3600 +
          parseInt(endTimeTokens[1]) * 60 +
          parseInt(endTimeTokens[2] || "0");

        if (isLastScene) {
          endSeconds = 99999; // Ensure it covers the end of the video
        }

        const sceneDur = endSeconds - startSeconds;

        if (scene.visual_generation_prompt) {
          const { fetchFallbackMedia } =
            await import("./services/mediaApiClient");
          const { generateAtmosphereImage } =
            await import("./services/geminiService");

          let asset = await fetchFallbackMedia(
            scene.visual_generation_prompt,
            settings.aspectRatio,
          );
          let finalSrcUrl = "";
          let finalType = LayerType.IMAGE;

          if (asset) {
            finalSrcUrl = asset.srcUrl;
            finalType =
              asset.type === "video" ? LayerType.VIDEO : LayerType.IMAGE;
          } else {
            // Fallback to AI Image Generation
            const targetRatio =
              settings.aspectRatio === AspectRatio.VERTICAL
                ? "9:16"
                : settings.aspectRatio === AspectRatio.SQUARE
                  ? "1:1"
                  : "16:9";
            const img = await generateAtmosphereImage(
              scene.visual_generation_prompt,
              targetRatio,
            );
            if (img) {
              finalSrcUrl = img;
              finalType = LayerType.IMAGE;
            }
          }

          if (finalSrcUrl) {
            const layerId = `scene-bg-${Date.now()}-${Math.random()}`;

            newLayers.push({
              id: layerId,
              type: finalType,
              startTime: startSeconds,
              endTime: endSeconds,
              visible: true,
              zIndex: 0,
              srcUrl: finalSrcUrl,
              duration: sceneDur,
              trimStart: 0,
            } as any);

            // Add to loaded assets
            if (finalType === LayerType.VIDEO) {
              const v = document.createElement("video");
              v.src = finalSrcUrl;
              v.muted = true;
              v.crossOrigin = "anonymous";
              v.loop = true;
              loadedAssetsRef.current.set(layerId, v);
            } else {
              const img = new Image();
              img.src = finalSrcUrl;
              img.crossOrigin = "anonymous";
              loadedAssetsRef.current.set(layerId, img);
            }
          }
        }

        // Removed onscreen_text generation per user request
      }

      setLayers(newLayers);
      alert(
        "Scenes & Assets initialized. Please generate or assign audio track separately if needed.",
      );
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to process scene timeline.");
    } finally {
      setIsGenerating(false);
    }
  };
  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-[#020617] p-4 md:p-8">
      <canvas
        ref={recordCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          opacity: 0.01,
          pointerEvents: "none",
          zIndex: -1,
        }}
      />
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,video/*"
        onChange={handleFileUpload}
      />

      <header className="w-full max-w-6xl flex justify-between items-center mb-10 relative z-20">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-emerald-800 rounded-2xl shadow-xl shadow-emerald-950/50">
            <Video className="w-8 h-8 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              Noor Narrator Studio
            </h1>
            <p className="text-sm text-emerald-500 font-semibold tracking-widest uppercase">
              AI Voice & Video Sync
            </p>
          </div>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-5 py-2.5 glass-card rounded-xl hover:bg-emerald-900/40 transition-all flex items-center gap-2 border border-emerald-900/50"
          >
            {showHistory ? (
              <ArrowLeft className="w-5 h-5" />
            ) : (
              <History className="w-5 h-5" />
            )}
            <span className="hidden sm:inline font-bold">
              {showHistory ? "Back" : "Archive"}
            </span>
          </button>
        </div>
      </header>

      {isEditing && currentResult ? (
        <div className="fixed inset-0 z-50 bg-[#020617] flex flex-col p-6 overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-black text-white flex items-center gap-3">
              <Edit3 className="text-emerald-500" /> Professional Editor
            </h2>
            <div className="flex gap-3">
              <button
                onClick={() => setIsEditing(false)}
                className="px-6 py-2 bg-slate-800 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-slate-700 transition-colors"
              >
                <X className="w-5 h-5" /> Close Editor
              </button>
              <button
                onClick={startExport}
                className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-500 transition-colors"
              >
                <Save className="w-5 h-5" /> Export Changes
              </button>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-12 gap-8 overflow-hidden mb-6">
            <div className="col-span-3 h-full overflow-hidden">
              <AssetLibrary
                onAddAsset={handleAddMediaAsset}
                aspectRatio={settings.aspectRatio}
              />
            </div>

            <div className="col-span-6 flex flex-col items-center justify-center relative">
              <div
                className="relative group rounded-3xl overflow-hidden border-8 border-emerald-900/20 shadow-2xl bg-black"
                style={{
                  height: "50vh",
                  aspectRatio: settings.aspectRatio.replace(":", "/"),
                }}
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  className="w-full h-full object-contain cursor-move"
                />
              </div>
              <div className="mt-4 flex gap-4">
                <button
                  onClick={
                    playbackStatus === "playing" ? pausePreview : playPreview
                  }
                  className="p-3 bg-emerald-500 text-slate-950 rounded-full hover:scale-110 transition-transform shadow-lg shadow-emerald-900/50"
                  title={playbackStatus === "playing" ? "Pause" : "Play"}
                >
                  <Play
                    className={
                      playbackStatus === "playing"
                        ? "fill-current hidden"
                        : "fill-current"
                    }
                  />
                  <Pause
                    className={
                      playbackStatus === "playing" ? "fill-current" : "hidden"
                    }
                  />
                </button>
              </div>
            </div>

            <div className="col-span-3 glass-card rounded-3xl p-6 overflow-y-auto custom-scrollbar border-emerald-900/30">
              <div className="flex items-center gap-2 mb-6 text-yellow-500 font-black uppercase tracking-widest text-xs">
                <Sliders className="w-4 h-4" /> Properties
              </div>

              {selectedLayerId ? (
                (() => {
                  const layer = layers.find((l) => l.id === selectedLayerId);
                  if (!layer)
                    return (
                      <div className="text-slate-500">Layer not found</div>
                    );

                  if (layer.type === LayerType.TEXT) {
                    return (
                      <div className="space-y-4 text-sm text-slate-300">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                            Text
                          </label>
                          <textarea
                            value={(layer as any).text}
                            onChange={(e) =>
                              updateLayer(layer.id, { text: e.target.value })
                            }
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-2 focus:ring-2 focus:ring-yellow-500 focus:outline-none"
                            rows={3}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                              Color
                            </label>
                            <input
                              type="color"
                              value={(layer as any).color}
                              onChange={(e) =>
                                updateLayer(layer.id, { color: e.target.value })
                              }
                              className="w-full h-8 bg-slate-900/50 border border-slate-700 rounded cursor-pointer"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                              Font Size
                            </label>
                            <input
                              type="number"
                              value={(layer as any).fontSize}
                              onChange={(e) =>
                                updateLayer(layer.id, {
                                  fontSize: Number(e.target.value),
                                })
                              }
                              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-1.5 px-2 focus:ring-2 focus:ring-yellow-500 outline-none"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                              X Pos (0-1)
                            </label>
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              max="1"
                              value={(layer as any).x}
                              onChange={(e) =>
                                updateLayer(layer.id, {
                                  x: Number(e.target.value),
                                })
                              }
                              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-1.5 px-2 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                              Y Pos (0-1)
                            </label>
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              max="1"
                              value={(layer as any).y}
                              onChange={(e) =>
                                updateLayer(layer.id, {
                                  y: Number(e.target.value),
                                })
                              }
                              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-1.5 px-2 outline-none"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                            Animation
                          </label>
                          <select
                            value={(layer as any).animation}
                            onChange={(e) =>
                              updateLayer(layer.id, {
                                animation: e.target.value as any,
                              })
                            }
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-1.5 px-2 outline-none text-slate-300"
                          >
                            <option value="none">None</option>
                            <option value="fade">Fade</option>
                            <option value="slide">Slide</option>
                            <option value="typewriter">Typewriter</option>
                            <option value="bounce">Bounce</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                              Start (s)
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              value={layer.startTime}
                              onChange={(e) =>
                                updateLayer(layer.id, {
                                  startTime: Number(e.target.value),
                                })
                              }
                              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-1.5 px-2 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                              End (s)
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              value={layer.endTime}
                              onChange={(e) =>
                                updateLayer(layer.id, {
                                  endTime: Number(e.target.value),
                                })
                              }
                              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-1.5 px-2 outline-none"
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setLayers((prev) =>
                              prev.filter((l) => l.id !== layer.id),
                            );
                            setSelectedLayerId(null);
                          }}
                          className="w-full mt-4 flex items-center justify-center gap-2 py-2 bg-red-900/30 border border-red-900/50 text-red-400 rounded-lg hover:bg-red-900/50 hover:text-red-300 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" /> Delete Layer
                        </button>
                      </div>
                    );
                  }

                  if (layer.type === LayerType.NARRATION) {
                    return (
                      <div className="text-sm text-slate-400 mt-6 text-center">
                        Settings for Narration Layer are synced with the script.
                      </div>
                    );
                  }

                  return (
                    <div className="text-sm text-slate-400 mt-6 text-center">
                      Properties not available for this layer type.
                    </div>
                  );
                })()
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 text-xs font-bold uppercase tracking-widest text-center">
                  Select a layer to edit
                </div>
              )}
            </div>
          </div>

          <div className="h-48 shrink-0 pb-4 overflow-hidden">
            <Timeline
              layers={layers}
              duration={duration || 10}
              currentTimeRef={globalTimeRef}
              playbackStatus={playbackStatus}
              onScrub={handleScrub}
              onUpdateLayer={updateLayer}
              onSelectLayer={setSelectedLayerId}
              selectedLayerId={selectedLayerId}
              onDeleteLayer={(id) => {
                setLayers((prev) => prev.filter((l) => l.id !== id));
                setSelectedLayerId(null);
              }}
              onSplitLayer={handleSplitLayer}
            />
          </div>
        </div>
      ) : null}

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-10 relative z-10">
        {!showHistory ? (
          <>
            <div className="lg:col-span-7 space-y-6 animate-fade-in">
              <section className="glass-card rounded-3xl p-8 shadow-2xl border-emerald-900/20">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-3 text-yellow-500">
                    <Mic2 className="w-6 h-6" /> Script Editor
                  </h2>
                </div>
                {errorMsg && (
                  <div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-2xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                    <div className="text-sm text-red-200">
                      <p className="font-bold mb-1">Attention</p>
                      <p>{errorMsg}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <button
                    onClick={() => {
                      setSettings((s) => ({
                        ...s,
                        aspectRatio: AspectRatio.VERTICAL,
                        animationType: AnimationType.VERTICAL_SCROLL,
                        backgroundAnimation: BackgroundAnimation.ZOOM_IN,
                      }));
                      setLayers((prev) => {
                        const base = prev.filter(
                          (l) =>
                            ![
                              "reel-hook",
                              "video-hook",
                              "brand-watermark",
                              "narration-main",
                            ].includes(l.id),
                        );
                        return [
                          ...base,
                          {
                            id: "narration-main",
                            type: LayerType.NARRATION,
                            startTime: 0,
                            endTime: audioDuration,
                            visible: true,
                            zIndex: 1,
                            text: settings.text,
                            animationType: AnimationType.VERTICAL_SCROLL,
                            positionPreference: TextPosition.BOTTOM,
                          },
                          {
                            id: "brand-watermark",
                            type: LayerType.TEXT,
                            startTime: 0,
                            endTime: audioDuration,
                            visible: true,
                            zIndex: 2,
                            text: "LifeBeauty • Islamic Wisdom",
                            fontSize: 24,
                            color: "#0F6B4B",
                            animation: "none",
                            x: 0.5,
                            y: 0.95,
                          } as any,
                        ];
                      });
                    }}
                    className="p-4 bg-emerald-950/40 border border-yellow-500/30 rounded-2xl hover:bg-emerald-900/40 transition-all text-left flex items-start gap-4"
                  >
                    <Smartphone className="w-8 h-8 text-yellow-400 mt-1" />
                    <div>
                      <h4 className="font-bold text-yellow-400">
                        Reels Template (9:16)
                      </h4>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-1">
                        Applies Brand Kit Hook, Colors & Layout
                      </p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setSettings((s) => ({
                        ...s,
                        aspectRatio: AspectRatio.LANDSCAPE,
                        animationType: AnimationType.LEFT_TO_RIGHT,
                        backgroundAnimation: BackgroundAnimation.PAN_RIGHT,
                      }));
                      setLayers((prev) => {
                        const base = prev.filter(
                          (l) =>
                            ![
                              "reel-hook",
                              "video-hook",
                              "brand-watermark",
                              "narration-main",
                            ].includes(l.id),
                        );
                        return [
                          ...base,
                          {
                            id: "narration-main",
                            type: LayerType.NARRATION,
                            startTime: 0,
                            endTime: audioDuration,
                            visible: true,
                            zIndex: 1,
                            text: settings.text,
                            animationType: AnimationType.LEFT_TO_RIGHT,
                            positionPreference: TextPosition.LEFT,
                          },
                          {
                            id: "brand-watermark",
                            type: LayerType.TEXT,
                            startTime: 0,
                            endTime: audioDuration,
                            visible: true,
                            zIndex: 2,
                            text: "LifeBeauty • Islamic Wisdom",
                            fontSize: 32,
                            color: "#0F6B4B",
                            animation: "none",
                            x: 0.5,
                            y: 0.95,
                          } as any,
                        ];
                      });
                    }}
                    className="p-4 bg-emerald-950/40 border border-yellow-500/30 rounded-2xl hover:bg-emerald-900/40 transition-all text-left flex items-start gap-4"
                  >
                    <Monitor className="w-8 h-8 text-yellow-400 mt-1" />
                    <div>
                      <h4 className="font-bold text-yellow-400">
                        Video Template (16:9)
                      </h4>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-1">
                        Side text layout & Emotional Image
                      </p>
                    </div>
                  </button>
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={generateFullVideoTimeline}
                    disabled={isGenerating}
                    className="flex-1 py-3 bg-slate-800 text-white font-bold rounded-2xl hover:bg-slate-700 transition-all border border-slate-700 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Sparkles className="w-5 h-5 text-yellow-400" />
                    Generate Scene Pipeline
                  </button>
                </div>

                <textarea
                  className="urdu-font w-full min-h-[300px] bg-black/40 border border-emerald-900/40 rounded-2xl p-6 text-2xl text-emerald-50 focus:outline-none focus:ring-4 focus:ring-emerald-600/20 transition-all resize-y shadow-inner"
                  placeholder="یہاں اپنا اردو متن لکھیں..."
                  value={settings.text}
                  onChange={(e) =>
                    setSettings({ ...settings, text: e.target.value })
                  }
                  dir="rtl"
                />

                <div className="mt-8 space-y-6">
                  <div className="p-6 bg-emerald-950/20 border border-emerald-900/30 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                        <ImageIcon className="w-4 h-4" /> Background Gallery
                        (Slideshow)
                      </h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2 bg-emerald-800/40 hover:bg-emerald-800/60 text-emerald-100 rounded-lg transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider"
                        >
                          <Upload className="w-3 h-3" /> Upload
                        </button>
                        <button
                          onClick={generateAdditionalBG}
                          disabled={isGeneratingBG || !settings.style}
                          className="p-2 bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 rounded-lg transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider"
                        >
                          {isGeneratingBG ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}{" "}
                          Generate AI
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1 block">
                          Dynamic Scene Description (Editable)
                        </label>
                        <p className="text-[10px] text-slate-400 mb-2">
                          Describe the visual atmosphere for AI generation.
                        </p>
                      </div>
                      <input
                        className="w-full bg-black/40 border border-emerald-900/40 rounded-xl p-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-all"
                        placeholder="Scene description will appear here..."
                        value={settings.style}
                        onChange={(e) =>
                          setSettings({ ...settings, style: e.target.value })
                        }
                      />
                    </div>

                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 pt-2">
                      {backgrounds.map((bg) => {
                        const isSelected =
                          settings.selectedBackgroundIds.includes(bg.id);
                        const selectionOrder =
                          settings.selectedBackgroundIds.indexOf(bg.id) + 1;
                        return (
                          <button
                            key={bg.id}
                            onClick={() => toggleBackgroundSelection(bg.id)}
                            className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all group ${isSelected ? "border-yellow-400 shadow-lg shadow-yellow-400/20" : "border-emerald-900/40 opacity-60 hover:opacity-100"}`}
                          >
                            {bg.type === "video" ? (
                              <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                                <Video className="w-4 h-4 text-slate-500" />
                              </div>
                            ) : (
                              <img
                                src={bg.url}
                                className="w-full h-full object-cover"
                                alt="Background"
                              />
                            )}

                            {/* Source Indicator */}
                            <div
                              className={`absolute top-1 right-1 p-0.5 rounded-full ${bg.source === BackgroundSource.AI ? "bg-yellow-500" : "bg-emerald-500"}`}
                            >
                              {bg.source === BackgroundSource.AI ? (
                                <Sparkles className="w-2 h-2 text-white" />
                              ) : (
                                <Upload className="w-2 h-2 text-white" />
                              )}
                            </div>

                            {/* Selection Indicator */}
                            {isSelected && (
                              <div className="absolute inset-0 bg-yellow-500/20 flex items-center justify-center">
                                <div className="bg-yellow-500 text-black font-bold text-xs w-5 h-5 rounded-full flex items-center justify-center shadow-md">
                                  {selectionOrder}
                                </div>
                              </div>
                            )}
                          </button>
                        );
                      })}
                      {backgrounds.length === 0 && (
                        <div className="col-span-full py-8 text-center border-2 border-dashed border-emerald-900/20 rounded-xl">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            No Backgrounds Loaded
                          </p>
                        </div>
                      )}
                    </div>
                    {backgrounds.length > 0 && (
                      <p className="text-[10px] text-slate-400 text-center uppercase tracking-wider">
                        Select multiple images to create a slideshow.
                      </p>
                    )}
                  </div>

                  <div className="p-6 bg-emerald-950/10 border border-emerald-900/20 rounded-3xl space-y-4">
                    <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                      <Monitor className="w-4 h-4" /> Cinematic Settings
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                          Narrator Voice
                        </label>
                        <select
                          className="w-full bg-emerald-950/50 border border-emerald-900/40 rounded-xl p-4 text-sm text-emerald-100 focus:outline-none transition-all"
                          value={settings.voice}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              voice: e.target.value as VoiceName,
                            })
                          }
                        >
                          <option value={VoiceName.CHARON}>
                            Charon - Deep & Spiritual
                          </option>
                          <option value={VoiceName.KORE}>
                            Kore - Clear Classic
                          </option>
                          <option value={VoiceName.PUCK}>
                            Puck - Gentle Narrative
                          </option>
                          <option value={VoiceName.FENRIR}>
                            Fenrir - Strong Male
                          </option>
                          <option value={VoiceName.ZEPHYR}>
                            Zephyr - Elegant Female
                          </option>
                        </select>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                          Background Animation
                        </label>
                        <select
                          className="w-full bg-emerald-950/50 border border-emerald-900/40 rounded-xl p-4 text-sm text-emerald-100 focus:outline-none transition-all"
                          value={settings.backgroundAnimation}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              backgroundAnimation: e.target
                                .value as BackgroundAnimation,
                            })
                          }
                        >
                          {Object.values(BackgroundAnimation).map((anim) => (
                            <option key={anim} value={anim}>
                              {anim}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                          Script Animation
                        </label>
                        <select
                          className="w-full bg-emerald-950/50 border border-emerald-900/40 rounded-xl p-4 text-sm text-emerald-100 focus:outline-none transition-all"
                          value={settings.animationType}
                          onChange={(e) => {
                            const val = e.target.value as AnimationType;
                            setSettings({ ...settings, animationType: val });
                            setLayers((prev) =>
                              prev.map((l) =>
                                l.id === "narration-main"
                                  ? ({ ...l, animationType: val } as typeof l)
                                  : l,
                              ),
                            );
                          }}
                        >
                          <option value={AnimationType.VERTICAL_SCROLL}>
                            Vertical Read
                          </option>
                          <option value={AnimationType.RIGHT_TO_LEFT}>
                            Slide Right to Left
                          </option>
                          <option value={AnimationType.LEFT_TO_RIGHT}>
                            Slide Left to Right
                          </option>
                        </select>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                          Text Position
                        </label>
                        <select
                          className="w-full bg-emerald-950/50 border border-emerald-900/40 rounded-xl p-4 text-sm text-emerald-100 focus:outline-none transition-all"
                          value={settings.textPosition}
                          onChange={(e) => {
                            const newPos = e.target.value as TextPosition;
                            setSettings({
                              ...settings,
                              textPosition: newPos,
                              customX: undefined,
                              customY: undefined,
                            });
                            setLayers((prev) =>
                              prev.map((l) =>
                                l.id === "narration-main"
                                  ? ({
                                      ...l,
                                      positionPreference: newPos,
                                      customX: undefined,
                                      customY: undefined,
                                    } as typeof l)
                                  : l,
                              ),
                            );
                          }}
                        >
                          {Object.values(TextPosition).map((pos) => (
                            <option key={pos} value={pos}>
                              {pos}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                          Auto-Generate Visuals
                        </label>
                        <div className="flex items-center gap-3 p-4 bg-black/20 border border-emerald-900/40 rounded-xl">
                          <input
                            type="checkbox"
                            id="genImg"
                            checked={settings.generateImage}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                generateImage: e.target.checked,
                              })
                            }
                            className="w-4 h-4 text-emerald-600 rounded bg-black/40 border-emerald-900/40 focus:ring-emerald-500"
                          />
                          <label
                            htmlFor="genImg"
                            className="text-xs font-bold text-slate-400 uppercase tracking-wider"
                          >
                            Enable AI Scene Creation
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 bg-emerald-950/10 border border-emerald-900/20 rounded-3xl space-y-4">
                    <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                      <Volume2 className="w-4 h-4" /> Audio Settings
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                          Background Music
                        </label>
                        <div className="flex items-center gap-3 p-4 bg-black/20 border border-emerald-900/40 rounded-xl">
                          <input
                            type="checkbox"
                            id="bgmEnabled"
                            checked={settings.bgmEnabled}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                bgmEnabled: e.target.checked,
                              })
                            }
                            className="w-4 h-4 text-emerald-600 rounded bg-black/40 border-emerald-900/40 focus:ring-emerald-500"
                          />
                          <label
                            htmlFor="bgmEnabled"
                            className="text-xs font-bold text-slate-400 uppercase tracking-wider"
                          >
                            Enable BGM
                          </label>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                          BGM Volume
                        </label>
                        <div className="flex items-center gap-3 p-4 bg-black/20 border border-emerald-900/40 rounded-xl">
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={settings.bgmVolume}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                bgmVolume: parseFloat(e.target.value),
                              })
                            }
                            className="w-full accent-emerald-500"
                            disabled={!settings.bgmEnabled}
                          />
                          <span className="text-xs font-bold text-slate-400 w-8 text-right">
                            {Math.round(settings.bgmVolume * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3 mt-4">
                      <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                        BGM URL or File (Optional)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="w-full bg-emerald-950/50 border border-emerald-900/40 rounded-xl p-4 text-sm text-emerald-100 focus:outline-none transition-all"
                          placeholder="Enter custom audio URL..."
                          value={settings.bgmUrl || ""}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              bgmUrl: e.target.value,
                              bgmEnabled: e.target.value
                                ? true
                                : settings.bgmEnabled,
                            })
                          }
                        />
                        <input
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          id="bgm-upload"
                          onChange={handleBgmUpload}
                        />
                        <label
                          htmlFor="bgm-upload"
                          className="flex items-center justify-center px-4 rounded-xl border transition-all cursor-pointer bg-emerald-600/30 border-emerald-500 text-emerald-200 hover:bg-emerald-500/40"
                        >
                          <Upload className="w-5 h-5" />
                        </label>
                      </div>
                      {bgmError && (
                        <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {bgmError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-8 space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest block mb-1">
                      Export Dimension
                    </label>
                    <p className="text-[10px] text-slate-400 mb-4">
                      Select the aspect ratio for your video.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {Object.entries(ASPECT_RATIO_CONFIG).map(
                      ([key, config]) => {
                        const Icon = config.icon;
                        const isActive = settings.aspectRatio === key;
                        return (
                          <button
                            key={key}
                            onClick={() =>
                              setSettings({
                                ...settings,
                                aspectRatio: key as AspectRatio,
                              })
                            }
                            className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${isActive ? "bg-emerald-600/30 border-emerald-500 text-emerald-200" : "bg-black/20 border-emerald-900/20 text-slate-500 hover:border-emerald-900/50"}`}
                          >
                            <Icon
                              className={`w-5 h-5 ${isActive ? "text-yellow-400" : ""}`}
                            />
                            <span className="text-[10px] font-black uppercase text-center">
                              {config.label}
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>
                <div className="mt-8 flex gap-4">
                  <button
                    onClick={handleGenerate}
                    disabled={
                      isGenerating || isRecording || !settings.text.trim()
                    }
                    className="flex-1 bg-gradient-to-br from-emerald-500 to-emerald-800 hover:from-emerald-400 hover:to-emerald-700 disabled:opacity-50 text-white font-black py-5 px-8 rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-4 group uppercase tracking-[0.2em] text-sm relative overflow-hidden"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" /> Generating
                        Assets...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-6 h-6 group-hover:scale-110 transition-transform" />{" "}
                        Generate & Sync
                      </>
                    )}
                  </button>
                </div>
              </section>

              {currentResult?.seo && (
                <>
                  <section className="animate-fade-in space-y-6">
                    <div className="glass-card rounded-3xl p-8 border-emerald-900/20">
                      <h3 className="text-xl font-bold text-yellow-500 flex items-center gap-2 mb-6 uppercase tracking-wider">
                        <Sparkles className="w-5 h-5" /> Viral SEO Metadata
                      </h3>
                      <div className="space-y-6">
                        <div className="relative group">
                          <label className="text-[10px] font-black text-emerald-600 uppercase mb-2 block tracking-widest">
                            Optimized Titles
                          </label>
                          <div className="bg-black/40 border border-emerald-900/20 rounded-xl p-4 flex flex-col gap-3">
                            {(currentResult.seo?.titleOptions || []).map(
                              (t, i) => (
                                <div
                                  key={i}
                                  className="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-emerald-900/20"
                                >
                                  <span className="text-emerald-50 text-sm font-bold block">
                                    {t}
                                  </span>
                                  <button
                                    onClick={() =>
                                      copyToClipboard(t, `title-${i}`)
                                    }
                                    className="p-2 hover:bg-emerald-500/20 rounded-lg transition-colors shrink-0"
                                  >
                                    {copiedField === `title-${i}` ? (
                                      <Check className="w-4 h-4 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-4 h-4 text-slate-400" />
                                    )}
                                  </button>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                        <div className="relative group">
                          <label className="text-[10px] font-black text-emerald-600 uppercase mb-2 block tracking-widest">
                            Description
                          </label>
                          <div className="bg-black/40 border border-emerald-900/20 rounded-xl p-4 flex flex-col gap-3">
                            <span className="text-emerald-50/80 text-xs leading-relaxed">
                              {currentResult.seo.description}
                            </span>
                            <button
                              onClick={() =>
                                copyToClipboard(
                                  currentResult.seo?.description || "",
                                  "desc",
                                )
                              }
                              className="self-end px-3 py-1.5 bg-emerald-900/20 hover:bg-emerald-900/40 rounded-lg text-[10px] font-black uppercase text-emerald-400 flex items-center gap-2 transition-colors"
                            >
                              {copiedField === "desc" ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}{" "}
                              {copiedField === "desc" ? "Copied" : "Copy Desc"}
                            </button>
                          </div>
                        </div>
                        <div className="relative group">
                          <label className="text-[10px] font-black text-emerald-600 uppercase mb-2 block tracking-widest">
                            YouTube Tags (Comma Separated)
                          </label>
                          <div className="bg-black/40 border border-emerald-900/20 rounded-xl p-4 flex flex-col gap-3">
                            <span className="text-emerald-50/80 text-xs leading-relaxed">
                              {currentResult.seo.keywords.join(", ")}
                            </span>
                            <button
                              onClick={() =>
                                copyToClipboard(
                                  currentResult.seo?.keywords.join(", ") || "",
                                  "tags",
                                )
                              }
                              className="self-end px-3 py-1.5 bg-emerald-900/20 hover:bg-emerald-900/40 rounded-lg text-[10px] font-black uppercase text-emerald-400 flex items-center gap-2 transition-colors"
                            >
                              {copiedField === "tags" ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}{" "}
                              {copiedField === "tags" ? "Copied" : "Copy Tags"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {currentResult.thumbnailUrl && (
                    <section className="animate-fade-in space-y-6">
                      <div className="glass-card rounded-3xl p-8 border-emerald-900/20">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-xl font-bold text-yellow-500 flex items-center gap-2 uppercase tracking-wider">
                            <ImageIcon className="w-5 h-5" /> AI Generated
                            Thumbnail
                          </h3>
                          <button
                            onClick={handleRegenerateThumbnail}
                            disabled={isGeneratingThumb}
                            className="p-2 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 rounded-lg transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider border border-emerald-900/30"
                          >
                            {isGeneratingThumb ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                            Regenerate
                          </button>
                        </div>
                        <div className="relative group rounded-xl overflow-hidden border border-emerald-900/30">
                          <img
                            src={currentResult.thumbnailUrl}
                            className="w-full h-auto object-cover"
                            alt="Generated Thumbnail"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                            <a
                              href={currentResult.thumbnailUrl}
                              download={`thumbnail-${Date.now()}.png`}
                              className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-500 transition-all shadow-lg transform hover:scale-105"
                            >
                              <Download className="w-5 h-5" /> Download PNG
                            </a>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>

            <div className="lg:col-span-5 space-y-8 animate-fade-in">
              <section className="glass-card rounded-3xl p-6 shadow-2xl sticky top-8 border-emerald-900/10">
                <div
                  className="relative group w-full mx-auto rounded-3xl overflow-hidden shadow-2xl border-4 border-emerald-900/30 bg-slate-900 transition-all duration-700"
                  style={{
                    aspectRatio: settings.aspectRatio.replace(":", "/"),
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    className="w-full h-full object-contain cursor-move"
                  />
                  {isRecording && (
                    <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-8 text-center backdrop-blur-xl">
                      <div className="w-20 h-20 relative mb-8">
                        <div className="absolute inset-0 border-4 border-emerald-900/30 rounded-full"></div>
                        <div className="absolute inset-0 border-4 border-yellow-500 rounded-full border-t-transparent animate-spin"></div>
                      </div>
                      <h3 className="text-xl font-black text-white mb-2 uppercase tracking-[0.2em]">
                        Exporting High-Res
                      </h3>
                      <p className="text-emerald-500 text-sm font-black tracking-[0.3em]">
                        {Math.round(recordProgress)}%
                      </p>
                    </div>
                  )}
                  {currentResult && !isRecording && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                      <div className="flex gap-4">
                        <button
                          onClick={
                            playbackStatus === "playing"
                              ? pausePreview
                              : playPreview
                          }
                          className="p-4 bg-emerald-500 text-slate-950 rounded-full hover:scale-110 transition-transform"
                        >
                          <Play className="fill-current" />
                        </button>
                        <button
                          onClick={stopPreview}
                          className="p-4 bg-slate-800 text-emerald-500 rounded-full hover:scale-110 transition-transform"
                        >
                          <RotateCcw />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-8 space-y-4">
                  {currentResult && (
                    <div className="flex justify-between items-center px-2">
                      <span className="text-emerald-400 font-bold text-sm tracking-widest uppercase">
                        Video Length:{" "}
                        {Math.floor(duration / 60)
                          .toString()
                          .padStart(2, "0")}
                        :{(duration % 60).toFixed(1).padStart(4, "0")}
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                          Speed
                        </label>
                        <select
                          value={settings.videoSpeed || 1.0}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              videoSpeed: parseFloat(e.target.value),
                            })
                          }
                          className="bg-emerald-950/50 border border-emerald-900/40 rounded-lg p-1 text-xs text-emerald-100 focus:outline-none"
                        >
                          <option value={0.75}>0.75x</option>
                          <option value={1.0}>1x</option>
                          <option value={1.25}>1.25x</option>
                          <option value={1.5}>1.5x</option>
                          <option value={1.75}>1.75x</option>
                          <option value={2.0}>2x</option>
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setIsEditing(true)}
                      disabled={!currentResult || isRecording}
                      className="flex-1 flex items-center justify-center gap-3 p-4 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded-2xl hover:bg-yellow-500/20 transition-all font-black uppercase text-xs tracking-widest"
                    >
                      <Edit3 className="w-5 h-5" /> Edit Video Layers
                    </button>
                  </div>
                  <button
                    onClick={startExport}
                    disabled={!currentResult || isRecording}
                    className="w-full flex items-center justify-center gap-4 p-5 bg-gradient-to-r from-emerald-500 to-emerald-700 text-white rounded-2xl hover:brightness-110 transition-all font-black shadow-2xl disabled:opacity-50 uppercase tracking-[0.1em]"
                  >
                    <Download className="w-6 h-6" /> Download MP4 Social Video
                  </button>
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="col-span-12 animate-fade-in">
            <section className="glass-card rounded-[3rem] p-12 min-h-[70vh] border-emerald-900/10">
              <h2 className="text-3xl font-black text-white mb-10 flex items-center gap-4">
                <History className="w-10 h-10 text-emerald-500" /> History
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-900/50 p-6 rounded-3xl border border-emerald-900/20 hover:border-emerald-500/50 transition-all"
                  >
                    <div className="aspect-video bg-black rounded-xl mb-4 overflow-hidden">
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <p className="urdu-font text-sm text-emerald-100 line-clamp-2">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
