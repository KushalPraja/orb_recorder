// zoom-engine/index.ts — Orchestrator with frame-level checkpointing.
//
// Provides computeFrameState() which returns the camera crop and active
// ripples for any frame number. Stores camera snapshots every N frames
// so seeking only replays at most N spring iterations.

import { SmoothCamera } from './spring';
import { ClickRipple, type RippleDrawParams } from './effects';
import {
  splitEvents,
  debounceClicks,
  toCanvasCoords,
  parseMeta,
  CursorInterpolator,
  scheduleCamera,
} from './events';
import { computeZoomSegments, type ZoomSegment } from './segments';
import type { InputEvent, ClickEvent, ScrollEvent, MoveEvent } from '../../../shared/types';

// ─── Config ────────────────────────────────────────────────────────────────

export interface ZoomEngineConfig {
  canvasW: number;
  canvasH: number;
  frameW: number;
  frameH: number;
  fps: number;
  zoomFactor: number;
  holdDuration: number;
  padding: number;
  meta?: { originX?: number; originY?: number; scaleFactor?: number; captureWidth?: number } | null;
}

export interface FrameState {
  crop: { x: number; y: number; w: number; h: number };
  zoom: number;
  activeRipples: RippleDrawParams[];
}

// ─── Checkpoint interval ───────────────────────────────────────────────────

const CHECKPOINT_INTERVAL = 30;

// ─── ZoomEngine ────────────────────────────────────────────────────────────

export class ZoomEngine {
  private config: ZoomEngineConfig;
  private camera: SmoothCamera;
  private clicks: ClickEvent[];
  private scrolls: ScrollEvent[];
  private cursor: CursorInterpolator;
  private ripples: ClickRipple[];
  private checkpoints: Map<number, SmoothCamera>;
  private lastComputedFrame: number;
  readonly segments: ZoomSegment[];

  constructor(config: ZoomEngineConfig, rawEvents: InputEvent[]) {
    this.config = config;
    this.checkpoints = new Map();
    this.lastComputedFrame = -1;

    // Parse meta for coordinate mapping
    const metaInfo = parseMeta(config.meta ?? null, config.frameW);
    const pad = config.padding;

    // Split and process events
    const { clicks, scrolls, moves } = splitEvents(rawEvents);
    const debouncedClicks = debounceClicks(clicks, 0.4);

    // Map to canvas coords
    this.clicks = toCanvasCoords(debouncedClicks, metaInfo.originX, metaInfo.originY, metaInfo.scaleFactor, pad, config.frameW, config.frameH);
    this.scrolls = toCanvasCoords(scrolls, metaInfo.originX, metaInfo.originY, metaInfo.scaleFactor, pad, config.frameW, config.frameH);
    const movesC = toCanvasCoords(moves, metaInfo.originX, metaInfo.originY, metaInfo.scaleFactor, pad, config.frameW, config.frameH);

    this.cursor = new CursorInterpolator(movesC);
    this.ripples = this.clicks.map((c) => new ClickRipple(c.x, c.y, c.timestamp));

    // Compute zoom segments for timeline
    this.segments = computeZoomSegments(this.clicks, config.holdDuration);

    // Initialize camera
    this.camera = new SmoothCamera(config.canvasW, config.canvasH, config.fps);

    // Store initial checkpoint
    this.checkpoints.set(0, this.camera.clone());
  }

  /**
   * Compute the camera state at a given frame number.
   * Uses checkpointing for fast random access.
   */
  computeFrameState(frame: number): FrameState {
    const { fps, zoomFactor, holdDuration, canvasW, canvasH } = this.config;

    // Find the nearest checkpoint at or before this frame
    let checkpointFrame = 0;
    for (const [f] of this.checkpoints) {
      if (f <= frame && f > checkpointFrame) {
        checkpointFrame = f;
      }
    }

    // Restore from checkpoint
    const checkpoint = this.checkpoints.get(checkpointFrame)!;
    this.camera.restoreFrom(checkpoint);

    // Simulate from checkpoint to target frame
    for (let f = checkpointFrame; f <= frame; f++) {
      const t = f / fps;

      scheduleCamera(
        this.camera,
        this.clicks,
        this.scrolls,
        this.cursor,
        t,
        zoomFactor,
        holdDuration,
      );
      this.camera.update();

      // Store checkpoint every N frames
      if (f > 0 && f % CHECKPOINT_INTERVAL === 0 && !this.checkpoints.has(f)) {
        this.checkpoints.set(f, this.camera.clone());
      }
    }

    // Store checkpoint for current frame if it's a boundary
    if (frame % CHECKPOINT_INTERVAL === 0 && !this.checkpoints.has(frame)) {
      this.checkpoints.set(frame, this.camera.clone());
    }

    this.lastComputedFrame = frame;

    // Get crop
    const crop = this.camera.getCrop();
    const t = frame / fps;

    // Collect active ripples
    const activeRipples: RippleDrawParams[] = [];
    for (const ripple of this.ripples) {
      const params = ripple.getDrawParams(t, crop, canvasW, canvasH);
      if (params) activeRipples.push(params);
    }

    return {
      crop,
      zoom: this.camera.zoom,
      activeRipples,
    };
  }

  /** Clear all checkpoints (useful when config changes). */
  reset(): void {
    this.checkpoints.clear();
    this.camera = new SmoothCamera(this.config.canvasW, this.config.canvasH, this.config.fps);
    this.checkpoints.set(0, this.camera.clone());
    this.lastComputedFrame = -1;
  }
}

// Re-export everything for convenient imports
export { SmoothCamera, Spring1D } from './spring';
export { ClickRipple, RIPPLE_DURATION, RIPPLE_MAX_RADIUS } from './effects';
export {
  splitEvents,
  debounceClicks,
  toCanvasCoords,
  parseMeta,
  CursorInterpolator,
  scheduleCamera,
} from './events';
export { computeZoomSegments } from './segments';
export type { ZoomSegment } from './segments';
export type { RippleDrawParams } from './effects';
