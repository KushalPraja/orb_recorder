// Export pipeline — orchestrates trim → background → zoom → finalize.
// Background is applied first so the zoom crops into the composed canvas
// (background zooms with the video, Screen Studio style).

import fs from 'fs';
import path from 'path';
import {
  EVENTS_FILE,
  CLEAN_MP4_FILE,
  OUTPUT_FILE,
  META_FILE,
  DEFAULT_SETTINGS,
} from '../../shared/constants';
import {
  applyVisualExport,
  trimVideo,
  muxAudioInto,
  getBestH264Encoder,
  probeVideo,
  spawnFfmpeg,
} from './ffmpeg';
import type { ExportProgress, InputEvent } from '../../shared/types';

// Zoom engine (pure TS, no DOM deps — works in Node)
import { SmoothCamera } from '../../renderer/lib/zoom-engine/spring';
import {
  splitEvents,
  debounceClicks,
  toCanvasCoords,
  parseMeta,
  CursorInterpolator,
  scheduleCamera,
} from '../../renderer/lib/zoom-engine/events';
import { computeZoomSegments } from '../../renderer/lib/zoom-engine/segments';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeUnlink(p: string): void {
  if (!p || !fs.existsSync(p)) return;
  try { fs.unlinkSync(p); } catch { /* */ }
}

function validNum(n: number | undefined, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function qualityFlags(encoder: string): string[] {
  if (encoder === 'h264_nvenc') return ['-rc', 'vbr', '-cq', '18', '-preset', 'p4'];
  if (['h264_amf', 'h264_videotoolbox', 'hevc_nvenc'].includes(encoder))
    return ['-qp', '18'];
  return ['-crf', '18', '-preset', 'medium'];
}

// ─── Crop trajectory types ────────────────────────────────────────────────

interface CropRect { x: number; y: number; w: number; h: number }

interface ZoomOpts {
  zoom: number;
  hold: number;
  encoder: string;
  fps: number;
  padding: number;
  originalW: number;
  originalH: number;
  onProgress?: (pct: number) => void;
}

// ─── Step 1: Pre-compute crop trajectory ──────────────────────────────────

function precomputeCropTrajectory(
  segments: import('../../renderer/lib/zoom-engine/segments').ZoomSegment[],
  clicksC: InputEvent[],
  scrollsC: InputEvent[],
  cursor: CursorInterpolator,
  camera: SmoothCamera,
  fps: number,
  totalFrames: number,
  zoom: number,
  outW: number,
  outH: number,
): { crops: CropRect[]; allPassthrough: boolean } {
  const crops: CropRect[] = [];
  let allPassthrough = true;

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    scheduleCamera(camera, segments, clicksC as any, scrollsC as any, cursor, t, zoom);
    camera.update();
    const raw = camera.getCrop();

    // Keep sub-pixel precision — rounding creates stair-stepping that looks like shaking.
    // The zoompan filter handles sub-pixel interpolation natively.
    const x = Math.max(0, Math.min(outW - raw.w, raw.x));
    const y = Math.max(0, Math.min(outH - raw.h, raw.y));
    const w = Math.max(1, Math.min(outW, raw.w));
    const h = Math.max(1, Math.min(outH, raw.h));

    crops.push({ x, y, w, h });

    if (allPassthrough && !(Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(w - outW) < 0.5 && Math.abs(h - outH) < 0.5)) {
      allPassthrough = false;
    }
  }

  return { crops, allPassthrough };
}

// ─── Step 2: Generate FFmpeg zoompan expression ──────────────────────────
// Converts pre-computed crops to per-frame exact zoompan values using a binary
// search if-tree. Every frame gets its exact spring-physics value — no keyframe
// reduction or linear interpolation, so zoom transitions are perfectly smooth.

interface ZoompanFrame { z: number; x: number; y: number }

function cropsToZoompan(crops: CropRect[], outW: number): ZoompanFrame[] {
  return crops.map(c => {
    const z = outW / Math.max(1, c.w);
    // Quantize to precision zoompan can actually resolve.
    // Too many decimal places → every frame is unique → massive expressions
    // AND prevents near-identical values from deduplicating (= jitter).
    return {
      z: Math.round(z * 1000) / 1000,     // 0.001 precision — sub-pixel at any resolution
      x: Math.round(c.x * z * 10) / 10,   // 0.1px precision in zoomed space
      y: Math.round(c.y * z * 10) / 10,
    };
  });
}

/**
 * Build a binary-search if() tree that maps frame number `on` to exact values.
 * Depth is O(log n) — ~10 levels for 1000 frames. No interpolation.
 */
function buildExactIfTree(vals: { frame: number; val: number }[], lo: number, hi: number): string {
  if (lo === hi) return String(vals[lo].val);
  if (hi - lo === 1) {
    return `if(lt(on,${vals[hi].frame}),${vals[lo].val},${vals[hi].val})`;
  }
  const mid = (lo + hi) >>> 1;
  return `if(lt(on,${vals[mid].frame}),${buildExactIfTree(vals, lo, mid - 1)},${buildExactIfTree(vals, mid, hi)})`;
}

/**
 * Deduplicate consecutive identical values to shrink the expression, then build
 * the binary tree. This preserves exact values at every transition point while
 * collapsing runs of identical frames into single entries.
 */
function buildExpression(zpFrames: ZoompanFrame[], key: 'z' | 'x' | 'y'): string {
  // Deduplicate: keep only frames where the value changes
  const entries: { frame: number; val: number }[] = [];
  let prev: number | null = null;
  for (let i = 0; i < zpFrames.length; i++) {
    const val = zpFrames[i][key];
    if (val !== prev) {
      entries.push({ frame: i, val });
      prev = val;
    }
  }
  if (entries.length === 0) return '1';
  if (entries.length === 1) return String(entries[0].val);
  return buildExactIfTree(entries, 0, entries.length - 1);
}

// ─── FFmpeg zoompan zoom processor ───────────────────────────────────────
// Single FFmpeg command with zoompan filter — SIMD-optimized, no Node.js
// in the pixel path. Uses -filter_script:v to avoid ENAMETOOLONG on Windows.

async function runZoomProcessor(
  inputPath: string,
  eventsPath: string,
  metaPath: string,
  outputPath: string,
  opts: ZoomOpts,
): Promise<string> {
  // ── Load events + meta ──────────────────────────────────────────
  let rawEvents: InputEvent[] = [];
  if (fs.existsSync(eventsPath)) {
    try {
      const d = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
      if (Array.isArray(d)) rawEvents = d;
    } catch { /* */ }
  }

  let metaData: any = null;
  if (metaPath && fs.existsSync(metaPath)) {
    try { metaData = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* */ }
  }

  // ── Probe video ─────────────────────────────────────────────────
  const info = await probeVideo(inputPath);
  const canvasW = info.width;
  const canvasH = info.height;
  const fps = info.fps > 0 && info.fps <= 240 ? info.fps : opts.fps;
  const totalFrames = info.nbFrames > 0 ? info.nbFrames : Math.ceil(info.duration * fps);
  const outW = canvasW + (canvasW % 2);
  const outH = canvasH + (canvasH % 2);

  // ── Map events to canvas space ──────────────────────────────────
  const pad = opts.padding;
  const mi = parseMeta(metaData, opts.originalW);
  const { clicks, scrolls, moves } = splitEvents(rawEvents);
  const dc = debounceClicks(clicks, 0.4);

  const clicksC  = toCanvasCoords(dc,     mi.originX, mi.originY, mi.scaleFactor, pad, opts.originalW, opts.originalH);
  const scrollsC = toCanvasCoords(scrolls, mi.originX, mi.originY, mi.scaleFactor, pad, opts.originalW, opts.originalH);
  const movesC   = toCanvasCoords(moves,   mi.originX, mi.originY, mi.scaleFactor, pad, opts.originalW, opts.originalH);

  const cursor = new CursorInterpolator(movesC);
  const camera = new SmoothCamera(outW, outH, fps);

  console.log(
    `[ZoomEngine] canvas ${canvasW}x${canvasH} (video ${opts.originalW}x${opts.originalH}, pad=${pad}) @ ${fps}fps, ~${totalFrames} frames`
  );
  console.log(
    `[ZoomEngine] ${clicksC.length} clicks, ${scrollsC.length} scrolls, ${movesC.length} moves`
  );

  // ── Pre-compute crop trajectory ─────────────────────────────────
  const t0 = Date.now();
  const segments = computeZoomSegments(clicksC as any, opts.hold);
  const { crops, allPassthrough } = precomputeCropTrajectory(
    segments, clicksC, scrollsC, cursor, camera, fps, totalFrames,
    opts.zoom, outW, outH,
  );
  console.log(`[ZoomEngine] Pre-computed ${crops.length} crop rects in ${Date.now() - t0}ms`);

  if (allPassthrough) {
    console.log('[ZoomEngine] All frames are passthrough (no zoom) -- skipping');
    return inputPath;
  }

  // ── Generate per-frame zoompan expressions ──────────────────────
  const zpFrames = cropsToZoompan(crops, outW);
  const exprZ = buildExpression(zpFrames, 'z');
  const exprX = buildExpression(zpFrames, 'x');
  const exprY = buildExpression(zpFrames, 'y');

  console.log(`[ZoomEngine] zoompan expression lengths: z=${exprZ.length}, x=${exprX.length}, y=${exprY.length}`);

  const { app } = require('electron');
  const tempDir = app.getPath('temp');
  const scriptFile = path.join(tempDir, `orb_zoom_filter_${Date.now()}.txt`);

  const vfFilter = `zoompan=z='${exprZ}':x='${exprX}':y='${exprY}':d=1:s=${outW}x${outH}:fps=${fps}`;
  fs.writeFileSync(scriptFile, vfFilter, 'utf-8');

  const args = [
    '-y',
    '-i', inputPath,
    '-filter_script:v', scriptFile,
    '-c:v', opts.encoder, ...qualityFlags(opts.encoder),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-movflags', '+faststart',
    '-an',
    outputPath,
  ];

  const { promise } = spawnFfmpeg(args, (p) => {
    opts.onProgress?.(p.percent);
  }, info.duration);

  try {
    await promise;
    console.log(`[ZoomEngine] Done -> ${outputPath} (${totalFrames} frames)`);
    return outputPath;
  } finally {
    safeUnlink(scriptFile);
  }
}

// ─── Main export entry ───────────────────────────────────────────────────────

export interface ProcessVideoOptions {
  recordingDir: string;
  outputPath?: string;
  onProgress?: (progress: ExportProgress) => void;
  autoZoom?: boolean;
  zoomFactor?: number;
  zoomDuration?: number;
  fps?: number;
  background?: boolean;
  cornerRadius?: number;
  padding?: number;
  shadowBlur?: number;
  backgroundType?: 'solid' | 'gradient' | 'image';
  backgroundColor?: string;
  gradientStart?: string;
  gradientEnd?: string;
  wallpaperPath?: string | null;
  imageBlur?: 'none' | 'moderate' | 'strong';
  trimStart?: number;
  trimEnd?: number;
}

export async function processVideo(opts: ProcessVideoOptions): Promise<string> {
  const {
    recordingDir,
    outputPath,
    onProgress,
    autoZoom = false,
    zoomFactor,
    zoomDuration,
    fps,
    background = false,
    cornerRadius = 12,
    padding = 48,
    shadowBlur = 0,
    backgroundType = 'solid',
    backgroundColor = '#6366f1',
    gradientStart = '#667eea',
    gradientEnd = '#764ba2',
    wallpaperPath = null,
    imageBlur = 'none',
    trimStart,
    trimEnd,
  } = opts;

  const eventsPath = path.join(recordingDir, EVENTS_FILE);
  const metaPath   = path.join(recordingDir, META_FILE);
  const outPath    = outputPath ?? path.join(recordingDir, OUTPUT_FILE);

  const previewPath = path.join(recordingDir, CLEAN_MP4_FILE);
  if (!fs.existsSync(previewPath)) {
    throw new Error(`preview.mp4 not found at ${previewPath}. Open the recording in the editor first.`);
  }

  const targetFps = validNum(fps, DEFAULT_SETTINGS.fps);
  const encoder = await getBestH264Encoder();
  const intermediates: string[] = [];

  if (onProgress) onProgress({ percent: 0, phase: 'Loading recording\u2026' });
  let currentInput = previewPath;

  // ── Trim ──────────────────────────────────────────────────────────
  const isTrimmed = Number.isFinite(trimStart) && Number.isFinite(trimEnd)
    && trimStart! < trimEnd! && (trimStart! > 0.1 || trimEnd! < Infinity);

  if (isTrimmed) {
    const trimmedPath = path.join(recordingDir, '__intermediate_trimmed.mp4');
    intermediates.push(trimmedPath);
    if (onProgress) onProgress({ percent: 0, phase: 'Trimming\u2026' });

    try {
      await trimVideo(currentInput, trimmedPath, trimStart!, trimEnd!, (p) => {
        if (onProgress && Number.isFinite(p.percent))
          onProgress({ percent: Math.min(15, Math.round(p.percent * 0.15)), phase: 'Trimming\u2026' });
      });
      currentInput = trimmedPath;
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Background / visual effects (padding, corners, shadow) ──────
  if (background) {
    const visualOut = path.join(recordingDir, '__intermediate_visual.mp4');
    intermediates.push(visualOut);
    const bgPhase = 'Applying background\u2026';
    if (onProgress) onProgress({ percent: 15, phase: bgPhase });

    try {
      await applyVisualExport(currentInput, visualOut, {
        cornerRadius, padding, shadowBlur, backgroundType,
        backgroundColor, gradientStart, gradientEnd,
        wallpaperPath, imageBlur,
      }, (p) => {
        if (onProgress && Number.isFinite(p.percent)) {
          const weight = autoZoom ? 0.4 : 0.8;
          onProgress({ percent: Math.min(95, 15 + Math.round(p.percent * weight)), phase: bgPhase });
        }
      }, encoder);
      currentInput = visualOut;
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Auto-zoom (FFmpeg zoompan — fast, native SIMD) ────────────────
  if (autoZoom) {
    const origInfo = await probeVideo(previewPath);

    const zoomOut = path.join(recordingDir, '__intermediate_zoom.mp4');
    intermediates.push(zoomOut);
    const audioSource = currentInput;
    const basePercent = background ? 55 : 15;
    if (onProgress) onProgress({ percent: basePercent, phase: 'Applying auto-zoom\u2026' });

    try {
      await runZoomProcessor(currentInput, eventsPath, metaPath, zoomOut, {
        zoom: Math.min(validNum(zoomFactor, DEFAULT_SETTINGS.zoomFactor), 2.5),
        hold: validNum(zoomDuration, DEFAULT_SETTINGS.zoomDuration),
        encoder,
        fps: targetFps,
        padding: background ? padding : 0,
        originalW: origInfo.width,
        originalH: origInfo.height,
        onProgress: (pct) => {
          if (onProgress)
            onProgress({ percent: Math.min(95, basePercent + Math.round(pct * (95 - basePercent) / 100)), phase: 'Applying auto-zoom\u2026' });
        },
      });
      currentInput = zoomOut;

      // Merge audio back
      const zoomAudio = path.join(recordingDir, '__intermediate_zoom_audio.mp4');
      intermediates.push(zoomAudio);
      try {
        await muxAudioInto(zoomOut, audioSource, zoomAudio);
        currentInput = zoomAudio;
      } catch (audioErr: any) {
        console.warn('[Export] Audio merge after zoom failed:', audioErr.message);
      }
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Finalize ──────────────────────────────────────────────────────
  if (currentInput !== outPath) {
    try { fs.copyFileSync(currentInput, outPath); }
    catch (err) { intermediates.forEach(safeUnlink); throw err; }
  }

  intermediates.forEach(safeUnlink);
  if (onProgress) onProgress({ percent: 100, phase: 'Done' });
  console.log(`[Export] Done -> ${outPath}`);
  return outPath;
}
