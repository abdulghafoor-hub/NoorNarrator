import React, { useRef, useState, useEffect } from "react";
import { EditorLayer } from "../types";
import { Scissors, Trash2 } from "lucide-react";

interface TimelineProps {
  layers: EditorLayer[];
  duration: number;
  currentTimeRef: React.MutableRefObject<number>;
  playbackStatus: string;
  onScrub: (time: number) => void;
  onUpdateLayer: (id: string, updates: Partial<EditorLayer>) => void;
  onSelectLayer: (id: string) => void;
  selectedLayerId: string | null;
  onDeleteLayer: (id: string) => void;
  onSplitLayer?: (id: string, time: number) => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  layers,
  duration,
  currentTimeRef,
  playbackStatus,
  onScrub,
  onUpdateLayer,
  onSelectLayer,
  selectedLayerId,
  onDeleteLayer,
  onSplitLayer,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Time to pixels
  const pixelsPerSecond = 50 * zoom;
  const timelineWidth = duration * pixelsPerSecond;

  useEffect(() => {
    let animationFrameId: number;
    const renderLoop = () => {
      if (playheadLineRef.current && duration > 0) {
        playheadLineRef.current.style.left = `${(currentTimeRef.current / duration) * 100}%`;
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };
    renderLoop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [duration, currentTimeRef]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    setIsScrubbing(true);
    updatePlayhead(e);
  };

  const handlePointerMove = (e: WindowEventMap["pointermove"]) => {
    if (!isScrubbing || !containerRef.current) return;
    updatePlayhead(e as any);
  };

  const handlePointerUp = () => {
    setIsScrubbing(false);
  };

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isScrubbing]);

  const updatePlayhead = (e: React.PointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const time = (x / rect.width) * duration;
    onScrub(time);
    // We don't need to manually update playheadLineRef.current.style.left here because the renderLoop runs at 60fps
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 bg-slate-950 border-b border-slate-800">
        <div className="flex gap-2">
          <button
            onClick={() =>
              selectedLayerId &&
              onSplitLayer &&
              onSplitLayer(selectedLayerId, currentTimeRef.current)
            }
            className="p-1.5 hover:bg-slate-800 text-slate-400 rounded"
            title="Split Clip at Playhead"
          >
            <Scissors className="w-4 h-4" />
          </button>
          <button
            onClick={() => selectedLayerId && onDeleteLayer(selectedLayerId)}
            className="p-1.5 hover:bg-slate-800 text-red-400 rounded"
            title="Delete Clip"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Zoom:</span>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
          />
        </div>
      </div>

      {/* Tracks Container */}
      <div
        className="relative flex-1 overflow-auto bg-slate-900/50"
        ref={containerRef}
        onPointerDown={handlePointerDown}
      >
        {/* Playhead Line */}
        <div
          ref={playheadLineRef}
          className="absolute top-0 bottom-0 w-px bg-red-500 z-50 pointer-events-none"
          style={{ left: `0%` }}
        >
          <div className="absolute top-0 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
        </div>

        {/* Tracks area */}
        <div
          className="relative min-h-full"
          style={{
            width: Math.max(
              timelineWidth,
              containerRef.current?.offsetWidth || 0,
            ),
          }}
        >
          {layers.map((layer, idx) => {
            const left = (layer.startTime / duration) * 100;
            const width = ((layer.endTime - layer.startTime) / duration) * 100;

            return (
              <div
                key={layer.id}
                className="absolute h-10 bg-slate-800/80 border border-slate-700/50 rounded-md cursor-pointer hover:bg-slate-700/80 transition-colors"
                style={{
                  top: `${idx * 48 + 16}px`,
                  left: `${left}%`,
                  width: `${width}%`,
                  borderColor:
                    selectedLayerId === layer.id ? "#10b981" : undefined,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectLayer(layer.id);
                }}
              >
                <div className="px-2 py-1 text-xs text-white absolute inset-0 truncate pointer-events-none">
                  {layer.type}
                </div>
                {/* Drag Handle Left */}
                {/* Drag Handle Right */}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
