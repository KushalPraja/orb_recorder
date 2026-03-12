// Shared TypeScript interfaces used across main process and preload.
// All data structures that cross the IPC boundary are defined here.

// ─── Recording Metadata ──────────────────────────────────────────────────────

export interface RecordingMeta {
  name?: string;
  sourceType?: 'screen' | 'window';
  originX?: number;
  originY?: number;
  captureWidth?: number;
  captureHeight?: number;
  scaleFactor?: number;
}

// ─── Input Events ────────────────────────────────────────────────────────────

export interface ClickEvent {
  type: 'click';
  x: number;
  y: number;
  button: number;    // 1 = left, 2 = right, 3 = middle
  clicks: number;    // 1 = single, 2 = double
  timestamp: number; // seconds into recording
}

export interface MoveEvent {
  type: 'move';
  x: number;
  y: number;
  timestamp: number;
}

export interface ScrollEvent {
  type: 'scroll';
  x: number;
  y: number;
  rotation: number;  // positive = down, negative = up
  direction: 'vertical';
  timestamp: number;
}

export type InputEvent = ClickEvent | MoveEvent | ScrollEvent;

// ─── Zoom Keyframes ──────────────────────────────────────────────────────────

export type ZoomEasing = 'ease-in-out' | 'linear' | 'snap';
export type ZoomSource = 'auto' | 'manual';

export interface ZoomKeyframe {
  timestamp: number;
  x: number;
  y: number;
  zoom: number;
  easing: ZoomEasing;
  source: ZoomSource;
}

// ─── Recording Session ───────────────────────────────────────────────────────

export interface RecordingSession {
  startTime: number;
  sessionDir: string;
}

export interface RecordingInfo {
  sessionDir: string;
  name: string;
  timestamp: number;
  size: number;
  filePath: string;
  outputPath: string | null;
  duration: number | null;
}

// ─── Capture Sources ─────────────────────────────────────────────────────────

export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;   // data URL
  type: 'screen' | 'window';
  displayBounds: DisplayBounds | null;
}

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type OverlayPosition =
  | 'bottom-center' | 'bottom-left' | 'bottom-right'
  | 'top-center'    | 'top-left'    | 'top-right';

export type ThemeName = 'dark' | 'light' | 'onedark' | 'gruvbox' | 'everforest';

export interface AppSettings {
  fps: number;
  zoomFactor: number;
  zoomDuration: number;
  outputDir: string;
  overlayPosition: OverlayPosition;
  theme?: ThemeName;
}

// ─── Export Options ──────────────────────────────────────────────────────────

export type BackgroundType = 'solid' | 'gradient' | 'image';
export type ImageBlur = 'none' | 'moderate' | 'strong';
export type ExportQuality = 'balanced' | 'high' | 'maximum';

export interface ExportOptions {
  sessionDir?: string;
  exportPath?: string;
  autoZoom?: boolean;
  zoomKeyframes?: ZoomKeyframe[];
  customZoomSegments?: ZoomSegment[];

  // Visual
  background?: boolean;
  cornerRadius?: number;
  padding?: number;
  shadowBlur?: number;
  backgroundType?: BackgroundType;
  backgroundColor?: string;
  gradientStart?: string;
  gradientEnd?: string;
  wallpaperFile?: string;
  imageBlur?: ImageBlur;

  // Quality
  exportQuality?: ExportQuality;

  // Trim
  trimStart?: number;
  trimEnd?: number;
}

export interface ExportProgress {
  percent: number;
  phase: string;
}

export interface ExportFileReaderHandle {
  readerId: string;
  size: number;
}

export interface RendererExportRequest {
  jobId: string;
  inputPath: string;
  outputPath: string;
  events: InputEvent[];
  meta: RecordingMeta | null;
  fps: number;
  autoZoom: boolean;
  zoomFactor: number;
  zoomDuration: number;
  customZoomSegments?: ZoomSegment[];
  background: boolean;
  cornerRadius: number;
  padding: number;
  shadowBlur: number;
  backgroundType: BackgroundType;
  backgroundColor: string;
  gradientStart: string;
  gradientEnd: string;
  wallpaperPath: string | null;
  imageBlur: ImageBlur;
  exportQuality: ExportQuality;
  trimStart?: number;
  trimEnd?: number;
}

// ─── Video Probe ─────────────────────────────────────────────────────────────

export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
  nbFrames: number;
}

// ─── Platform ────────────────────────────────────────────────────────────────

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Zoom Segments (for timeline visualization) ──────────────────────────

export interface ZoomSegment {
  startTime: number;
  endTime: number;
  peakTime: number;
  clickX: number;
  clickY: number;
}

// ─── Events + Meta loading result ────────────────────────────────────────

export interface LoadedEvents {
  events: InputEvent[];
  meta: RecordingMeta | null;
}
