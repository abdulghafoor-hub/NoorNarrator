
export enum VoiceName {
  KORE = 'Kore',
  PUCK = 'Puck',
  CHARON = 'Charon',
  FENRIR = 'Fenrir',
  ZEPHYR = 'Zephyr'
}

export enum AnimationType {
  VERTICAL_SCROLL = 'Vertical Scroll',
  LEFT_TO_RIGHT = 'Left to Right',
  RIGHT_TO_LEFT = 'Right to Left',
}

export enum BackgroundAnimation {
  NONE = 'None',
  ZOOM_IN = 'Zoom In',
  ZOOM_OUT = 'Zoom Out',
  PAN_LEFT = 'Pan Left',
  PAN_RIGHT = 'Pan Right',
  PAN_UP = 'Pan Up',
  PAN_DOWN = 'Pan Down',
  WATER_FLOW = 'Water Flow',
  CINEMATIC_3D = 'Cinematic 3D Parallax',
  RANDOM = 'Random Dynamic'
}

export enum TextPosition {
  CENTER = 'Center',
  TOP = 'Top',
  BOTTOM = 'Bottom',
  LEFT = 'Left',
  RIGHT = 'Right',
  TOP_LEFT = 'Top-Left',
  TOP_RIGHT = 'Top-Right',
  BOTTOM_LEFT = 'Bottom-Left',
  BOTTOM_RIGHT = 'Bottom-Right'
}

export enum AspectRatio {

  VERTICAL = '9:16',
  LANDSCAPE = '16:9',
  SQUARE = '1:1',
  FEED = '4:5'
}

export enum BackgroundSource {
  AI = 'AI Generated',
  CUSTOM = 'Custom Upload'
}

export enum LayerType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  NARRATION = 'narration',
}

export type TextEffect = 'fade' | 'slide' | 'typewriter' | 'bounce' | 'none';
export type ImageEffect = 'zoom' | 'pan' | 'fade' | 'none';

export interface BaseLayer {
  id: string;
  type: LayerType;
  startTime: number; // in seconds, mapped to startOnTimeline
  endTime: number;   // in seconds
  visible: boolean;
  zIndex: number;
}

export interface MediaLayer extends BaseLayer {
  type: LayerType.IMAGE | LayerType.VIDEO;
  srcUrl: string;
  duration: number; // For trimStart logic
  trimStart: number;
}

export interface TextLayer extends BaseLayer {
  type: LayerType.TEXT;
  text: string;
  fontSize: number;
  color: string;
  animation: TextEffect;
  x: number; // 0-1
  y: number; // 0-1
}

export interface ImageLayer extends BaseLayer {
  type: LayerType.IMAGE;
  url: string;
  animation: ImageEffect;
  x: number;
  y: number;
  scale: number;
}

export interface NarrationLayer extends BaseLayer {
  type: LayerType.NARRATION;
  text: string;
  animationType: AnimationType;
  positionPreference?: TextPosition;
  customX?: number;
  customY?: number;
  audioMetadata?: {
    startSilence: number;
    endSilence: number;
    activeDuration: number;
    totalDuration: number;
  };
}

export type EditorLayer = TextLayer | ImageLayer | MediaLayer | NarrationLayer;

export interface SEOMetadata {
  titleOptions: string[];
  description: string;
  keywords: string[];
  thumbnailText?: string;
}

export interface BackgroundAsset {
  id: string;
  url: string;
  source: BackgroundSource;
  type: 'image' | 'video';
}

export interface NarrationHistoryItem {
  id: string;
  text: string;
  voice: VoiceName;
  timestamp: number;
  audioUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  seo?: SEOMetadata;
  aspectRatio?: AspectRatio;
}

export interface GenerationSettings {
  text: string;
  voice: VoiceName;
  generateImage: boolean;
  style: string;
  animationType: AnimationType;
  backgroundAnimation: BackgroundAnimation;
  textPosition: TextPosition;
  customX?: number;
  customY?: number;
  aspectRatio: AspectRatio;
  backgroundSource: BackgroundSource;
  selectedBackgroundIds: string[]; // Changed from optional single ID to array
  bgmEnabled: boolean;
  bgmVolume: number;
  bgmUrl?: string;
  videoSpeed?: number;
}
