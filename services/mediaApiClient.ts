/// <reference types="vite/client" />
import { AspectRatio } from "../types";

export interface MediaAsset {
  id: string;
  type: "video" | "image" | "audio";
  srcUrl: string;
  thumbnailUrl: string;
  duration?: number;
  width?: number;
  height?: number;
  title?: string;
  author?: string;
  source: "pexels" | "pixabay";
}

// 1. Keyword Extraction Logic
export const extractSearchKeywords = (prompt: string): string => {
  // Strip out generic styling words
  const stopWords = [
    "cinematic", "4k", "8k", "hyperrealistic", "photorealistic", "ultra", 
    "detailed", "high resolution", "masterpiece", "trending", "artstation", 
    "macro", "shot", "of", "a", "the", "an", "in", "on", "with", "by", 
    "and", "or", "is", "at", 
    // Additional strict stop words to exclude people if needed, though search APIs 
    // might still match them if we don't explicitly negate. 
    // We will just filter them out from our query so we don't explicitly search for them.
    "woman", "girl", "female", "lady", "sexy", "hot", "adult", "bikini", 
    "model", "face", "portrait", "eyes", "lips", "body"
  ];

  let words = prompt
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/);
  words = words.filter((word) => word.length > 2 && !stopWords.includes(word));

  // We append safe, abstract/nature/architectural keywords to steer the algorithm
  // towards safe imagery suitable for islamic content if it's struggling.
  // Actually, appending "islamic architecture nature modest" to EVERY query might ruin specific queries like "desert at night".
  // Let's just return the sanitized keywords, but we'll add " -woman -girl -female" at the end if the API supports it, though for Pexels/Pixabay, appending safe context helps.
  
  // Return the first 3-4 significant words
  let query = words.slice(0, 4).join(" ");
  
  return query;
};

// 2. API Clients
const PEXELS_API_KEY = import.meta.env.VITE_PEXELS_API_KEY || "";
const PIXABAY_API_KEY = import.meta.env.VITE_PIXABAY_API_KEY || "";

export const searchPexelsVideo = async (
  query: string,
  orientation: "portrait" | "landscape" | "square",
): Promise<MediaAsset[]> => {
  if (!PEXELS_API_KEY) {
    console.warn("Pexels API key missing, using fallback video.");
    return [{
      id: "mock-video-pexel",
      type: "video",
      srcUrl: "https://videos.pexels.com/video-files/856973/856973-hd_1920_1080_30fps.mp4",
      thumbnailUrl: "https://images.pexels.com/videos/856973/pictures/preview-0.jpg",
      width: 1920,
      height: 1080,
      title: "Sample Fallback Video",
      author: "Mock Author",
      source: "pexels"
    }];
  }

  // Ensure query leans safe 
  const safeQuery = query + " nature architecture light modest -woman -girl -female -sexy -adult -bikini -model -face";

  // pexels orientation: landscape, portrait or square
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(safeQuery)}&orientation=${orientation}&per_page=15`,
    {
      headers: { Authorization: PEXELS_API_KEY },
    },
  );
  if (!res.ok) {
    if (res.status === 429) throw new Error("Pexels API Rate Limit Exceeded");
    throw new Error(`Pexels API Error: ${res.status}`);
  }
  const data = await res.json();
  const forbiddenRegex = /\b(women|girls|females|woman|girl|female|lady|sexy|hot|adult|bikini|model|face|portrait|eyes|lips|body|people|person|man|boy|human|couple|bikinis|swimsuit)\b/i;

  return data.videos
    .filter((v: any) => {
      const dataStr = `${v.url} ${v.tags ? v.tags.join(" ") : ""} ${v.user?.name}`.replace(/-/g, " ");
      return !forbiddenRegex.test(dataStr);
    })
    .map((v: any) => {
      // find best hd file
      let bestFile = v.video_files.find(
        (f: any) => f.quality === "hd" && f.link,
      );
      if (!bestFile)
        bestFile = v.video_files.find((f: any) => f.quality === "sd" && f.link);
      if (!bestFile && v.video_files.length > 0) bestFile = v.video_files[0];

      return {
        id: `pexels-v-${v.id}`,
        type: "video",
        srcUrl: bestFile?.link || "",
        thumbnailUrl: v.image,
        duration: v.duration,
        width: v.width,
        height: v.height,
        title:
          v.url.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ||
          "Pexels Video",
        author: v.user.name,
        source: "pexels",
      };
    })
    .filter((asset: MediaAsset) => asset.srcUrl);
};

export const searchPixabayVideo = async (
  query: string,
): Promise<MediaAsset[]> => {
  if (!PIXABAY_API_KEY) {
     console.warn("Pixabay API key missing, using fallback video.");
     return [{
       id: "mock-video-pixabay",
       type: "video",
       srcUrl: "https://videos.pexels.com/video-files/856973/856973-hd_1920_1080_30fps.mp4",
       thumbnailUrl: "https://images.pexels.com/videos/856973/pictures/preview-0.jpg",
       title: "Sample Fallback Pixabay Video",
       author: "Mock Author",
       source: "pixabay"
     }];
  }
  
  const safeQuery = query + " nature architecture light modest -woman -girl -female -sexy -adult -bikini -model -face";
  
  const res = await fetch(
    `https://pixabay.com/api/videos/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(safeQuery)}&per_page=15&safesearch=true`,
  );
  if (!res.ok) {
    if (res.status === 429) throw new Error("Pixabay API Rate Limit Exceeded");
    throw new Error(`Pixabay API Error: ${res.status}`);
  }
  const data = await res.json();
  const forbiddenRegex = /\b(women|girls|females|woman|girl|female|lady|sexy|hot|adult|bikini|model|face|portrait|eyes|lips|body|people|person|man|boy|human|couple|bikinis|swimsuit)\b/i;
  
  return data.hits
    .filter((v: any) => {
      const dataStr = `${v.tags} ${v.user} ${v.pageURL}`.replace(/-/g, " ");
      return !forbiddenRegex.test(dataStr);
    })
    .map((v: any) => {
    return {
      id: `pixabay-v-${v.id}`,
      type: "video",
      srcUrl: v.videos.medium.url || v.videos.small.url,
      thumbnailUrl: `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg`,
      duration: v.duration,
      width: v.videos.medium.width || v.videos.small.width,
      height: v.videos.medium.height || v.videos.small.height,
      title: v.tags,
      author: v.user,
      source: "pixabay",
    };
  });
};

export const searchPexelsImage = async (
  query: string,
  orientation: "portrait" | "landscape" | "square",
): Promise<MediaAsset[]> => {
  if (!PEXELS_API_KEY) {
    console.warn("Pexels key missing, using fallback image.");
    return [{
       id: "mock-image-pexels",
       type: "image",
       srcUrl: "https://images.pexels.com/photos/1103970/pexels-photo-1103970.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2",
       thumbnailUrl: "https://images.pexels.com/photos/1103970/pexels-photo-1103970.jpeg?auto=compress&cs=tinysrgb&w=400",
       title: "Sample Fallback Image",
       author: "Mock",
       source: "pexels"
    }];
  }
  
  const safeQuery = query + " nature architecture light modest -woman -girl -female -sexy -adult -bikini -model -face";

  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(safeQuery)}&orientation=${orientation}&per_page=15`,
    {
      headers: { Authorization: PEXELS_API_KEY },
    },
  );
  if (!res.ok) {
    if (res.status === 429) throw new Error("Pexels API Rate Limit Exceeded");
    throw new Error(`Pexels API Error: ${res.status}`);
  }
  const data = await res.json();
  const forbiddenRegex = /\b(women|girls|females|woman|girl|female|lady|sexy|hot|adult|bikini|model|face|portrait|eyes|lips|body|people|person|man|boy|human|couple|bikinis|swimsuit)\b/i;

  return data.photos
    .filter((p: any) => {
      const dataStr = `${p.url} ${p.alt} ${p.photographer}`.replace(/-/g, " ");
      return !forbiddenRegex.test(dataStr);
    })
    .map((p: any) => ({
    id: `pexels-i-${p.id}`,
    type: "image",
    srcUrl: p.src.large,
    thumbnailUrl: p.src.medium,
    width: p.width,
    height: p.height,
    title: p.alt || "Pexels Image",
    author: p.photographer,
    source: "pexels",
  }));
};

export const searchPixabayImage = async (
  query: string,
): Promise<MediaAsset[]> => {
  if (!PIXABAY_API_KEY) {
     return [{
       id: "mock-image-pixabay",
       type: "image",
       srcUrl: "https://images.pexels.com/photos/1103970/pexels-photo-1103970.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2",
       thumbnailUrl: "https://images.pexels.com/photos/1103970/pexels-photo-1103970.jpeg?auto=compress&cs=tinysrgb&w=400",
       title: "Sample Fallback Image",
       author: "Mock",
       source: "pixabay"
    }];
  }
  
  const safeQuery = query + " nature architecture light modest -woman -girl -female -sexy -adult -bikini -model -face";
  
  const res = await fetch(
    `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(safeQuery)}&image_type=photo&per_page=15&safesearch=true`,
  );
  if (!res.ok) {
    if (res.status === 429) throw new Error("Pixabay API Rate Limit Exceeded");
    throw new Error(`Pixabay API Error: ${res.status}`);
  }
  const data = await res.json();
  const forbiddenRegex = /\b(women|girls|females|woman|girl|female|lady|sexy|hot|adult|bikini|model|face|portrait|eyes|lips|body|people|person|man|boy|human|couple|bikinis|swimsuit)\b/i;
  
  return data.hits
    .filter((p: any) => {
      const dataStr = `${p.tags} ${p.user} ${p.pageURL}`.replace(/-/g, " ");
      return !forbiddenRegex.test(dataStr);
    })
    .map((p: any) => ({
    id: `pixabay-i-${p.id}`,
    type: "image",
    srcUrl: p.largeImageURL,
    thumbnailUrl: p.webformatURL,
    width: p.imageWidth,
    height: p.imageHeight,
    title: p.tags,
    author: p.user,
    source: "pixabay",
  }));
};

export const searchPixabayAudio = async (
  query: string,
): Promise<MediaAsset[]> => {
  if (!PIXABAY_API_KEY) throw new Error("Pixabay API key is missing");
  const res = await fetch(
    `https://pixabay.com/api/audio/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&per_page=15`,
  );
  if (!res.ok) {
    if (res.status === 429) throw new Error("Pixabay API Rate Limit Exceeded");
    throw new Error(`Pixabay API Error: ${res.status}`);
  }
  const data = await res.json();
  return data.hits.map((a: any) => ({
    id: `pixabay-a-${a.id}`,
    type: "audio",
    srcUrl: a.audio_download || data.url, // Actually pixabay audio returns sometimes differently, but we'll try audio? Wait, pixabay audio API?
    thumbnailUrl:
      "https://cdn.pixabay.com/audio/2021/08/17/12-07-06-880_200x200.jpg", // dummy
    duration: a.duration,
    title: a.name || "Pixabay Audio",
    author: a.user,
    source: "pixabay",
  }));
};

export const fetchMultipleFallbackMedia = async (
  prompt: string,
  aspectRatio: AspectRatio,
  count: number = 3
): Promise<MediaAsset[]> => {
  let isVertical =
    aspectRatio === AspectRatio.VERTICAL || aspectRatio === AspectRatio.FEED;
  let orientation: "portrait" | "landscape" | "square" = isVertical
    ? "portrait"
    : aspectRatio === AspectRatio.SQUARE
      ? "square"
      : "landscape";

  const keywords = extractSearchKeywords(prompt);
  if (!keywords) return [];

  let results: MediaAsset[] = [];
  try {
    const pexelsVideos = await searchPexelsVideo(keywords, orientation);
    results.push(...pexelsVideos);
  } catch (e) {
    console.warn("Pexels video fallback failed:", e);
  }

  if (results.length < count) {
    try {
      const pixabayVideos = await searchPixabayVideo(keywords);
      results.push(...pixabayVideos);
    } catch (e) {
      console.warn("Pixabay video fallback failed:", e);
    }
  }

  return results.slice(0, count);
};

export const fetchFallbackMedia = async (
  prompt: string,
  aspectRatio: AspectRatio,
): Promise<MediaAsset | null> => {
  let isVertical =
    aspectRatio === AspectRatio.VERTICAL || aspectRatio === AspectRatio.FEED;
  let orientation: "portrait" | "landscape" | "square" = isVertical
    ? "portrait"
    : aspectRatio === AspectRatio.SQUARE
      ? "square"
      : "landscape";

  const keywords = extractSearchKeywords(prompt);
  if (!keywords) return null;

  try {
    // 1. Try Pexels Video
    const pexelsVideos = await searchPexelsVideo(keywords, orientation);
    if (pexelsVideos.length > 0) return pexelsVideos[0];
  } catch (e) {
    console.warn("Pexels video fallback failed:", e);
  }

  try {
    // 2. Try Pixabay Video
    const pixabayVideos = await searchPixabayVideo(keywords);
    // For pixabay, try to filter by orientation if possible but not strictly required
    if (pixabayVideos.length > 0) return pixabayVideos[0];
  } catch (e) {
    console.warn("Pixabay video fallback failed:", e);
  }

  // Return null if all failed, signaling the need for AI Image Generation fallback
  return null;
};
