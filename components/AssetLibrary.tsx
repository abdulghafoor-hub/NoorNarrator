import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  Search,
  Video,
  Image as ImageIcon,
  Music,
  Plus,
} from "lucide-react";
import {
  searchPexelsVideo,
  searchPixabayVideo,
  searchPexelsImage,
  searchPixabayImage,
  searchPixabayAudio,
  MediaAsset,
} from "../services/mediaApiClient";

interface AssetLibraryProps {
  onAddAsset: (asset: MediaAsset) => void;
  aspectRatio: string;
}

export const AssetLibrary: React.FC<AssetLibraryProps> = ({
  onAddAsset,
  aspectRatio,
}) => {
  const [activeTab, setActiveTab] = useState<"video" | "image" | "audio">(
    "video",
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    fetchResults();
  }, [activeTab, debouncedQuery]);

  const fetchResults = async () => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    setResults([]);

    try {
      let isVertical = aspectRatio === "9:16" || aspectRatio === "4:5";
      let orientation: "portrait" | "landscape" | "square" = isVertical
        ? "portrait"
        : aspectRatio === "1:1"
          ? "square"
          : "landscape";

      let fetched: MediaAsset[] = [];
      if (activeTab === "video") {
        try {
          fetched = await searchPexelsVideo(debouncedQuery, orientation);
        } catch {
          fetched = await searchPixabayVideo(debouncedQuery);
        }
      } else if (activeTab === "image") {
        try {
          fetched = await searchPexelsImage(debouncedQuery, orientation);
        } catch {
          fetched = await searchPixabayImage(debouncedQuery);
        }
      } else if (activeTab === "audio") {
        fetched = await searchPixabayAudio(debouncedQuery);
      }
      setResults(fetched);
    } catch (e) {
      console.error("Asset fetch failed", e);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayAudio = (asset: MediaAsset) => {
    if (playingAudioId === asset.id) {
      audioRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const newAudio = new Audio(asset.srcUrl);
      newAudio.play().catch(console.error);
      audioRef.current = newAudio;
      setPlayingAudioId(asset.id);

      newAudio.onended = () => {
        setPlayingAudioId(null);
      };
    }
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-700/50 rounded-2xl overflow-hidden">
      {/* Tabs */}
      <div className="flex p-2 gap-2 bg-slate-950">
        <button
          onClick={() => setActiveTab("video")}
          className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-lg transition-colors text-sm font-semibold
             ${activeTab === "video" ? "bg-emerald-600 text-white" : "bg-transparent text-slate-400 hover:text-white"}`}
        >
          <Video className="w-4 h-4" /> Videos
        </button>
        <button
          onClick={() => setActiveTab("image")}
          className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-lg transition-colors text-sm font-semibold
             ${activeTab === "image" ? "bg-emerald-600 text-white" : "bg-transparent text-slate-400 hover:text-white"}`}
        >
          <ImageIcon className="w-4 h-4" /> Images
        </button>
        <button
          onClick={() => setActiveTab("audio")}
          className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-lg transition-colors text-sm font-semibold
             ${activeTab === "audio" ? "bg-emerald-600 text-white" : "bg-transparent text-slate-400 hover:text-white"}`}
        >
          <Music className="w-4 h-4" /> Audio
        </button>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-slate-800">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search stock library..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : results.length > 0 ? (
          <div
            className={
              activeTab === "audio"
                ? "flex flex-col gap-2"
                : "grid grid-cols-2 gap-3"
            }
          >
            {results.map((asset) => (
              <div
                key={asset.id}
                className="group relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 hover:border-emerald-500/50 transition-colors"
              >
                {activeTab !== "audio" ? (
                  <>
                    <div className="aspect-video bg-black relative">
                      {asset.type === "video" ? (
                        <video
                          src={asset.srcUrl}
                          poster={asset.thumbnailUrl}
                          muted
                          loop
                          onMouseEnter={(e) =>
                            e.currentTarget.play().catch(() => {})
                          }
                          onMouseLeave={(e) => {
                            e.currentTarget.pause();
                            e.currentTarget.currentTime = 0;
                          }}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img
                          src={asset.thumbnailUrl}
                          alt={asset.title}
                          className="w-full h-full object-cover"
                        />
                      )}

                      {/* Add overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          onClick={() => onAddAsset(asset)}
                          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 p-2 rounded-full absolute transition-transform transform scale-90 group-hover:scale-100"
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-2 text-xs text-slate-400 truncate">
                      {asset.author}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3 p-3">
                    <button
                      onClick={() => handlePlayAudio(asset)}
                      className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-emerald-400 hover:bg-slate-700 shrink-0"
                    >
                      {playingAudioId === asset.id ? (
                        <Pause className="w-4 h-4 fill-current" />
                      ) : (
                        <Play className="w-4 h-4 fill-current" />
                      )}
                    </button>
                    <div className="flex-1 truncate">
                      <div className="text-sm text-white truncate">
                        {asset.title}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {asset.author}
                      </div>
                    </div>
                    <button
                      onClick={() => onAddAsset(asset)}
                      className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : debouncedQuery ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            No results found.
          </div>
        ) : (
          <div className="text-center py-8 text-slate-600 text-sm italic">
            Type keywords to search {activeTab}
          </div>
        )}
      </div>
    </div>
  );
};
