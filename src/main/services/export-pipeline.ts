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
  getFfmpegPath,
  applyVisualExport,
  trimVideo,
  muxAudioInto,
  getBestH264Encoder,
  probeVideo,
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

// ─── Pipe-based zoom processor ──────────────────────────────────────────────
// Decodes video to raw frames via FFmpeg, applies per-frame crop in Node.js
// using the TypeScript spring engine, and pipes cropped frames back to FFmpeg
// for encoding. This mirrors the Python pipeline's approach exactly.

interface ZoomOpts {
  zoom: number;
  hold: number;
  encoder: string;
  fps: number;
  padding: number; // padding that was already applied by background step
  originalW: number; // video dimensions before background was applied
  originalH: number;
  onProgress?: (pct: number) => void;
}

async function runZoomProcessor(
  inputPath: string,
  eventsPath: string,
  metaPath: string,
  outputPath: string,
  opts: ZoomOpts,
): Promise<string> {
  const { spawn } = require('child_process') as typeof import('child_process');
  const ffmpegBin = getFfmpegPath();

  // ── Load events + meta ────────────────────────────────────────────
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

  // ── Probe video ───────────────────────────────────────────────────
  // Input may already include background (padding/corners/shadow).
  // Its dimensions are the full canvas; opts.originalW/H are the raw video.
  const info = await probeVideo(inputPath);
  const canvasW = info.width;
  const canvasH = info.height;
  const fps = info.fps > 0 && info.fps <= 240 ? info.fps : opts.fps;
  const totalFrames = info.nbFrames > 0 ? info.nbFrames : Math.ceil(info.duration * fps);

  // Output is same size as input canvas
  const outW = canvasW + (canvasW % 2);
  const outH = canvasH + (canvasH % 2);

  // ── Map events to canvas space (with padding offset) ───────────
  // Events are in screen coords → map to canvas coords where video
  // sits at (padding, padding) inside the canvas.
  const pad = opts.padding;
  const mi = parseMeta(metaData, opts.originalW);
  const { clicks, scrolls, moves } = splitEvents(rawEvents);
  const dc = debounceClicks(clicks, 0.4);

  const clicksC  = toCanvasCoords(dc,      mi.originX, mi.originY, mi.scaleFactor, pad, opts.originalW, opts.originalH);
  const scrollsC = toCanvasCoords(scrolls,  mi.originX, mi.originY, mi.scaleFactor, pad, opts.originalW, opts.originalH);
  const movesC   = toCanvasCoords(moves,    mi.originX, mi.originY, mi.scaleFactor, pad, opts.originalW, opts.originalH);

  const cursor = new CursorInterpolator(movesC);
  const camera = new SmoothCamera(outW, outH, fps);

  console.log(
    `[ZoomEngine] canvas ${canvasW}x${canvasH} (video ${opts.originalW}x${opts.originalH}, pad=${pad}) @ ${fps}fps, ~${totalFrames} frames`
  );
  console.log(
    `[ZoomEngine] ${clicksC.length} clicks, ${scrollsC.length} scrolls, ${movesC.length} moves`
  );

  // ── FFmpeg decoder (video → raw RGB24 on stdout) ──────────────────
  const decoder = spawn(ffmpegBin, [
    '-i', inputPath,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-v', 'error',
    '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // ── FFmpeg encoder (raw RGB24 on stdin → H.264 file) ──────────────
  const encoder_proc = spawn(ffmpegBin, [
    '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-s', `${outW}x${outH}`,
    '-r', String(fps),
    '-i', '-',
    '-c:v', opts.encoder, ...qualityFlags(opts.encoder),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    outputPath,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  // Pipe stderr for debugging
  let encStderr = '';
  encoder_proc.stderr.on('data', (c: Buffer) => { encStderr += c.toString(); });
  decoder.stderr.on('data', (c: Buffer) => {
    const t = c.toString().trim();
    if (t) console.log(`[ZoomEngine/dec] ${t}`);
  });

  // ── Frame-by-frame processing (zoom crop on composed canvas) ─────
  return new Promise<string>((resolve, reject) => {
    const srcFrameSize = canvasW * canvasH * 3;  // RGB24 of full canvas
    let buf = Buffer.alloc(0);
    let frameIdx = 0;
    let lastPct = -1;

    decoder.stdout.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      while (buf.length >= srcFrameSize) {
        const srcFrame = buf.subarray(0, srcFrameSize);
        buf = buf.subarray(srcFrameSize);

        // ── Spring physics for this frame ───────────────────────
        const t = frameIdx / fps;
        scheduleCamera(camera, clicksC, scrollsC, cursor, t, opts.zoom, opts.hold);
        camera.update();
        const crop = camera.getCrop();

        // ── Crop + scale to output size ─────────────────────────
        const cx = Math.max(0, Math.min(outW - 1, Math.round(crop.x)));
        const cy = Math.max(0, Math.min(outH - 1, Math.round(crop.y)));
        const cw = Math.max(1, Math.min(outW - cx, Math.round(crop.w)));
        const ch = Math.max(1, Math.min(outH - cy, Math.round(crop.h)));

        let finalFrame: Buffer;

        if (cw === outW && ch === outH && cx === 0 && cy === 0) {
          // No crop needed (zoom = 1x), pass through
          finalFrame = srcFrame;
        } else {
          // Crop then scale with bilinear interpolation
          finalFrame = cropAndScale(srcFrame, canvasW, canvasH, cx, cy, cw, ch, outW, outH);
        }

        // Write to encoder
        try {
          encoder_proc.stdin.write(finalFrame);
        } catch {
          break;
        }

        // Progress
        frameIdx++;
        if (totalFrames > 0) {
          const pct = Math.min(100, Math.round((frameIdx / totalFrames) * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            opts.onProgress?.(pct);
          }
        }
      }
    });

    decoder.stdout.on('end', () => {
      encoder_proc.stdin.end();
    });

    decoder.on('error', (err: Error) => reject(err));

    encoder_proc.on('close', (code: number) => {
      if (code === 0) {
        console.log(`[ZoomEngine] Done \u2192 ${outputPath} (${frameIdx} frames)`);
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg encoder exited ${code}\n${encStderr.slice(-500)}`));
      }
    });

    encoder_proc.on('error', (err: Error) => reject(err));
  });
}

/**
 * Crop a region from an RGB24 buffer and scale it to target dimensions
 * using bilinear interpolation. Pure JS — no native deps.
 */
function cropAndScale(
  src: Buffer, srcW: number, _srcH: number,
  cx: number, cy: number, cw: number, ch: number,
  dstW: number, dstH: number,
): Buffer {
  const dst = Buffer.alloc(dstW * dstH * 3);
  const scaleX = cw / dstW;
  const scaleY = ch / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const srcYf = cy + dy * scaleY;
    const sy0 = Math.floor(srcYf);
    const sy1 = Math.min(sy0 + 1, cy + ch - 1);
    const fy = srcYf - sy0;

    for (let dx = 0; dx < dstW; dx++) {
      const srcXf = cx + dx * scaleX;
      const sx0 = Math.floor(srcXf);
      const sx1 = Math.min(sx0 + 1, cx + cw - 1);
      const fx = srcXf - sx0;

      const i00 = (sy0 * srcW + sx0) * 3;
      const i10 = (sy0 * srcW + sx1) * 3;
      const i01 = (sy1 * srcW + sx0) * 3;
      const i11 = (sy1 * srcW + sx1) * 3;

      const dstOff = (dy * dstW + dx) * 3;

      for (let c = 0; c < 3; c++) {
        const v00 = src[i00 + c];
        const v10 = src[i10 + c];
        const v01 = src[i01 + c];
        const v11 = src[i11 + c];

        // Bilinear interpolation
        const top = v00 + (v10 - v00) * fx;
        const bot = v01 + (v11 - v01) * fx;
        dst[dstOff + c] = Math.round(top + (bot - top) * fy);
      }
    }
  }

  return dst;
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
  // Applied BEFORE zoom so the background is part of the canvas that
  // gets zoomed — Screen Studio style where background zooms with video.
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

  // ── Auto-zoom (TS zoom engine + FFmpeg pipe) ──────────────────────
  // Runs on the composed canvas (with background if enabled), so the
  // zoom crops into the full canvas — background zooms with the video.
  if (autoZoom) {
    // Probe to get original video dimensions (before background)
    const origInfo = await probeVideo(previewPath);

    const zoomOut = path.join(recordingDir, '__intermediate_zoom.mp4');
    intermediates.push(zoomOut);
    const audioSource = currentInput;
    const basePercent = background ? 55 : 15;
    if (onProgress) onProgress({ percent: basePercent, phase: 'Applying auto-zoom\u2026' });

    try {
      await runZoomProcessor(currentInput, eventsPath, metaPath, zoomOut, {
        zoom: validNum(zoomFactor, DEFAULT_SETTINGS.zoomFactor),
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
  console.log(`[Export] Done \u2192 ${outPath}`);
  return outPath;
}
