// FFmpeg / ffprobe helpers — binary path resolution, spawning, progress parsing,
// hardware encoder detection, and video operations.

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { platform } from '../platform';
import { fromBin } from '../paths';
import type { VideoInfo } from '../../shared/types';

// ─── Binary path resolution ────────────────────────────────────────────────────

export function getFfmpegPath(): string {
  const name = platform.executableName('ffmpeg');
  return fromBin(name);
}

export function getFfprobePath(): string {
  const name = platform.executableName('ffprobe');
  return fromBin(name);
}

// ─── Hardware encoder detection ────────────────────────────────────────────────

let cachedEncoder: string | null = null;

/**
 * 
 * Detect the best available H.264 encoder.
 * Priority: h264_nvenc (NVIDIA) → h264_amf (AMD) → h264_videotoolbox (macOS) → libx264
 * @returns optimal encoder option (to be passed on to a flag)
 */

export async function getBestH264Encoder(): Promise<string> {
  if (cachedEncoder !== null) return cachedEncoder;

  const ffmpeg = getFfmpegPath();
  const CANDIDATES = ['h264_nvenc', 'h264_amf', 'h264_videotoolbox'];

  try {
    const encoders = await new Promise<string>((resolve, reject) => {
      const proc = spawn(ffmpeg, ['-encoders', '-hide_banner']);
      let out = '';
      proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
      proc.on('close', () => resolve(out));
      proc.on('error', reject);
    });

    for (const encoder of CANDIDATES) {
      if (encoders.includes(encoder)) {
        try {
          await new Promise<void>((resolve, reject) => {
            const testProc = spawn(ffmpeg, [
              '-hide_banner', '-loglevel', 'error',
              '-f', 'lavfi', '-i', 'color=black:s=16x16',
              '-t', '0.1', '-c:v', encoder, '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
            ]);
            testProc.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`probe exit code ${code}`));
            });
            testProc.on('error', reject);
          });
          console.log(`[FFmpeg] Hardware encoder available: ${encoder}`);
          cachedEncoder = encoder;
          return encoder;
        } catch (err: any) {
          console.warn(`[FFmpeg] ${encoder} listed but failed test: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[FFmpeg] Could not probe encoders: ${err.message}`);
  }

  console.log('[FFmpeg] Falling back to software encoder: libx264');
  cachedEncoder = 'libx264';
  return 'libx264';
}

/**
 * Return quality flags for a given encoder.
 * @param encoder encoder option
 * @param quality crf option defaults to 18 (visually lossless)
 * @returns array of flags to be passed to ffmpeg for the specified encoder and quality
 */
export function getEncoderQualityFlags(encoder: string, quality = 18): string[] {
  switch (encoder) {
    case 'h264_nvenc':
      return ['-rc', 'vbr', '-cq', String(quality), '-preset', 'p4'];
    case 'h264_amf':
      return ['-qp_i', String(quality), '-qp_p', String(quality)];
    case 'h264_videotoolbox':
      return ['-q:v', String(quality)];
    default:
      return ['-crf', String(quality), '-preset', 'medium'];
  }
}

// ─── Video probing ──────────────────────────────────────────────────────────────

/**
 * @param filePath file path of video
 * @returns 
 */
export function probeVideo(filePath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const ffprobe = getFfprobePath();
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams', '-show_format',
      '-count_frames',
      filePath,
    ];
    const proc = spawn(ffprobe, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
      try {
        const data = JSON.parse(stdout);
        const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
        if (!videoStream) return reject(new Error('No video stream found'));

        let fps = 30;
        if (videoStream.avg_frame_rate && videoStream.avg_frame_rate !== '0/0') {
          const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
          if (den && num / den > 1 && num / den < 240) fps = num / den;
        } else if (videoStream.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
          const candidate = den ? num / den : num;
          if (candidate > 1 && candidate < 120) fps = candidate;
        }

        let duration = parseFloat(data.format?.duration || videoStream.duration || '0');

        if (!Number.isFinite(duration) || duration <= 0) {
          const taggedDuration = videoStream.tags?.DURATION || data.format?.tags?.DURATION;
          if (taggedDuration && /^\d+:\d+:\d+(\.\d+)?$/.test(taggedDuration)) {
            const [hh, mm, ss] = taggedDuration.split(':');
            duration = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
          }
        }

        const nbFrames = parseInt(
          videoStream.nb_read_frames || videoStream.nb_frames || '0', 10,
        );
        if ((!Number.isFinite(duration) || duration <= 0) && nbFrames > 0) {
          duration = nbFrames / fps;
        }
        if (!Number.isFinite(duration) || duration < 0) duration = 0;

        resolve({
          width: parseInt(videoStream.width, 10),
          height: parseInt(videoStream.height, 10),
          fps: Math.round(fps),
          duration,
          nbFrames,
        });
      } catch (err: any) {
        reject(new Error(`Failed to parse ffprobe output: ${err.message}`));
      }
    });
  });
}

// ─── FFmpeg process spawning ────────────────────────────────────────────────────

export interface FfmpegProgress {
  frame: number;
  time: number;
  percent: number;
}

export function spawnFfmpeg(
  args: string[],
  onProgress: ((p: FfmpegProgress) => void) | null = null,
  totalDuration = 0,
): { proc: ChildProcess; promise: Promise<void> } {
  const ffmpeg = getFfmpegPath();
  const proc = spawn(ffmpeg, args);
  let stderr = '';

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;

    if (onProgress && totalDuration > 0) {
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      const frameMatch = text.match(/frame=\s*(\d+)/);
      if (timeMatch) {
        const currentTime = parseInt(timeMatch[1], 10) * 3600
          + parseInt(timeMatch[2], 10) * 60
          + parseFloat(timeMatch[3]);
        const percent = Math.min(100, Math.round((currentTime / totalDuration) * 100));
        const frame = frameMatch ? parseInt(frameMatch[1], 10) : 0;
        onProgress({ frame, time: currentTime, percent });
      }
    }
  });

  const promise = new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });

  return { proc, promise };
}

// ─── Video operations ──────────────────────────────────────────────────────────

/**
 * Re-encode a WebM to a clean CFR MP4 with correct timestamps.
 */
export function remuxToCleanMp4(
  inputPath: string,
  outputPath: string,
  onProgress: ((p: FfmpegProgress) => void) | null = null,
  targetFps = 30,
): Promise<string> {
  console.log('[FFmpeg] Re-encoding to clean intermediate MP4…');
  const fps = Number.isFinite(Number(targetFps)) && Number(targetFps) > 0
    ? Math.round(Number(targetFps)) : 30;

  const args = [
    '-i', inputPath,
    '-vf', `fps=${fps}`,
    '-vsync', 'cfr', '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-y', outputPath,
  ];

  const { promise } = spawnFfmpeg(args, onProgress, 0);
  return promise.then(() => {
    console.log(`[FFmpeg] Intermediate MP4 ready: ${outputPath}`);
    return outputPath;
  });
}

/**
 * Trim a clean MP4 to a specific time range.
 */
export function trimVideo(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number,
  onProgress: ((p: FfmpegProgress) => void) | null = null,
): Promise<string> {
  const duration = endTime - startTime;
  console.log(`[FFmpeg] Trimming ${startTime.toFixed(2)}s → ${endTime.toFixed(2)}s`);

  const args = [
    '-i', inputPath,
    '-ss', String(startTime), '-to', String(endTime),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-y', outputPath,
  ];

  const { promise } = spawnFfmpeg(args, onProgress, duration);
  return promise.then(() => {
    console.log(`[FFmpeg] Trimmed video ready: ${outputPath}`);
    return outputPath;
  });
}

/**
 * Mux audio from audioSourcePath into a video-only file.
 */
export function muxAudioInto(
  videoPath: string,
  audioSourcePath: string,
  outputPath: string,
): Promise<string> {
  const args = [
    '-i', videoPath, '-i', audioSourcePath,
    '-map', '0:v:0', '-map', '1:a?',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    '-y', outputPath,
  ];
  const { promise } = spawnFfmpeg(args, null, 0);
  return promise.then(() => {
    console.log(`[FFmpeg] Audio muxed → ${outputPath}`);
    return outputPath;
  });
}

// ─── Hex-to-RGB helper ──────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

// ─── Visual export (background + rounded corners) ────────────────────────────

export interface VisualExportOptions {
  cornerRadius?: number;
  padding?: number;
  shadowBlur?: number;
  backgroundType?: 'solid' | 'gradient' | 'image';
  backgroundColor?: string;
  gradientStart?: string;
  gradientEnd?: string;
  wallpaperPath?: string | null;
  imageBlur?: 'none' | 'moderate' | 'strong';
}

export async function applyVisualExport(
  inputPath: string,
  outputPath: string,
  opts: VisualExportOptions = {},
  onProgress: ((p: FfmpegProgress) => void) | null = null,
  encoder: string | null = null,
): Promise<string> {
  const {
    cornerRadius = 12,
    padding = 48,
    shadowBlur = 0,
    backgroundType = 'solid',
    backgroundColor = '#6366f1',
    gradientStart = '#667eea',
    gradientEnd = '#764ba2',
    wallpaperPath = null,
    imageBlur = 'none',
  } = opts;

  const enc = encoder ?? await getBestH264Encoder();
  const qualityFlags = getEncoderQualityFlags(enc, 18);

  const info = await probeVideo(inputPath);
  const { width: srcW, height: srcH, duration, fps, nbFrames } = info;

  const rawW = srcW + padding * 2;
  const rawH = srcH + padding * 2;
  const finalW = rawW + (rawW % 2);
  const finalH = rawH + (rawH % 2);

  const R = Math.max(0, Math.min(cornerRadius, Math.floor(Math.min(srcW, srcH) / 4)));
  const outFps = Number.isFinite(Number(fps)) && Number(fps) > 0
    ? Math.round(Number(fps)) : 30;
  const frameCount = Number.isFinite(nbFrames) && nbFrames > 0
    ? Math.round(nbFrames) : 0;

  const { app } = require('electron');
  const tempDir = app.getPath('temp');
  const tempFiles: string[] = [];

  // Shadow parameters — subtle drop-shadow like Screen Studio
  const shadowSigma = Math.max(0, Math.round(shadowBlur));
  const shadowOy = shadowSigma > 0 ? Math.max(2, Math.round(shadowSigma * 0.3)) : 0;
  const shadowOx = 0;
  const SHADOW_OPACITY = 0.65;

  // ── Step 1: Generate rounded-corner mask PNG ────────────────────
  let maskPath: string | null = null;
  if (R > 0) {
    maskPath = path.join(tempDir, `orb_mask_${srcW}x${srcH}_r${R}.png`);
    tempFiles.push(maskPath);
    const alphaExpr = `if(gt(abs(W/2-X),W/2-${R})*gt(abs(H/2-Y),H/2-${R}),if(lte(hypot(${R}-(W/2-abs(W/2-X)),${R}-(H/2-abs(H/2-Y))),${R}),255,0),255)`;
    console.log(`[FFmpeg] Generating rounded-corner mask (${srcW}x${srcH} r=${R})…`);
    await spawnFfmpeg([
      '-f', 'lavfi', '-i', `color=white:s=${srcW}x${srcH}:d=0.04`,
      '-vf', `format=gray,geq=lum='${alphaExpr}'`,
      '-frames:v', '1', '-y', maskPath,
    ]).promise;
    console.log('[FFmpeg] Mask generated.');
  }

  // ── Step 2: Pre-generate shadow as a static RGBA PNG ────────────
  // we render it once as a transparent PNG and overlay it as a static image.
  let shadowPath: string | null = null;
  if (shadowSigma > 0) {
    shadowPath = path.join(tempDir, `orb_shadow_${finalW}x${finalH}_r${R}_s${shadowSigma}.png`);
    tempFiles.push(shadowPath);

    // Extra padding so the gaussian blur can spread beyond the canvas edges
    const extraPad = Math.ceil(shadowSigma * 3);
    const workW = finalW + extraPad * 2;
    const workH = finalH + extraPad * 2;

    console.log(`[FFmpeg] Generating shadow image (${finalW}x${finalH}, sigma=${shadowSigma}, opacity=${SHADOW_OPACITY})…`);

    // Shape source: rounded-corner mask or plain white rectangle
    const shapeInput = maskPath
      ? ['-i', maskPath]
      : ['-f', 'lavfi', '-i', `color=white:s=${srcW}x${srcH}:d=0.04`];

    // Pipeline: shape → pad to working size with offset → blur → crop to canvas → use as alpha of black
    const shadowFilter = [
      `[0]format=gray,pad=${workW}:${workH}:${padding + shadowOx + extraPad}:${padding + shadowOy + extraPad}:black,` +
        `gblur=sigma=${shadowSigma},crop=${finalW}:${finalH}:${extraPad}:${extraPad},format=gray[alpha]`,
      `[1]format=rgba[base]`,
      `[base][alpha]alphamerge,colorchannelmixer=aa=${SHADOW_OPACITY}`,
    ].join(';');

    try {
      await spawnFfmpeg([
        ...shapeInput,
        '-f', 'lavfi', '-i', `color=black:s=${finalW}x${finalH}:d=0.04`,
        '-filter_complex', shadowFilter,
        '-pix_fmt', 'rgba',
        '-frames:v', '1', '-y', shadowPath,
      ]).promise;
      console.log('[FFmpeg] Shadow image generated.');
    } catch (err: any) {
      console.warn(`[FFmpeg] Shadow generation failed (${err.message}), continuing without shadow.`);
      shadowPath = null;
    }
  }

  function cleanup(): void {
    for (const f of tempFiles) {
      if (f && fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch { /* */ }
      }
    }
  }

  try {
    // ── Build inputs ────────────────────────────────────────────────
    const inputArgs: string[] = ['-i', inputPath]; // index 0: video
    let nextIdx = 1;

    // Background source (index 1)
    const bgIdx = nextIdx;
    let bgSetup: string | null = null;
    if (backgroundType === 'image' && wallpaperPath) {
      inputArgs.push('-i', wallpaperPath);
      const blurSigma = imageBlur === 'moderate' ? 10 : imageBlur === 'strong' ? 25 : 0;
      const blurPart = blurSigma > 0 ? `,gblur=sigma=${blurSigma}` : '';
      bgSetup = `[${bgIdx}:v]scale=${finalW}:${finalH},setsar=1${blurPart}[bg]`;
    } else {
      let bgHex = backgroundColor;
      if (backgroundType === 'gradient') {
        const [r1, g1, b1] = hexToRgb(gradientStart);
        const [r2, g2, b2] = hexToRgb(gradientEnd);
        const rm = Math.round((r1 + r2) / 2).toString(16).padStart(2, '0');
        const gm = Math.round((g1 + g2) / 2).toString(16).padStart(2, '0');
        const bm = Math.round((b1 + b2) / 2).toString(16).padStart(2, '0');
        bgHex = `#${rm}${gm}${bm}`;
      }
      const bgColor = bgHex.replace('#', '0x');
      inputArgs.push('-f', 'lavfi', '-i', `color=${bgColor}:s=${finalW}x${finalH}:r=${outFps}`);
      // lavfi color source can be used directly as [N:v], no filter needed
    }
    nextIdx++;

    // Mask input (for rounded corners)
    let maskIdx: number | null = null;
    if (maskPath) {
      inputArgs.push('-loop', '1', '-i', maskPath);
      maskIdx = nextIdx++;
    }

    // Shadow input (pre-generated RGBA PNG)
    let shadowIdx: number | null = null;
    if (shadowPath) {
      inputArgs.push('-loop', '1', '-i', shadowPath);
      shadowIdx = nextIdx++;
    }

    // ── Build filter_complex ────────────────────────────────────────
    // Clean 3-layer compositing: background → shadow overlay → video overlay
    const filters: string[] = [];
    let currentBg: string;

    if (bgSetup) {
      filters.push(bgSetup);
      currentBg = 'bg';
    } else {
      currentBg = `${bgIdx}:v`;
    }

    // Overlay pre-rendered shadow PNG onto background (single static image — fast)
    if (shadowIdx !== null) {
      filters.push(`[${currentBg}][${shadowIdx}:v]overlay=0:0[bg_s]`);
      currentBg = 'bg_s';
    }

    // Apply rounded corners to video via alpha merge with mask
    let videoLabel: string;
    if (maskIdx !== null) {
      filters.push(`[0:v]format=yuva420p[vid]`);
      filters.push(`[${maskIdx}:v]format=gray[mask]`);
      filters.push(`[vid][mask]alphamerge[rounded]`);
      videoLabel = 'rounded';
    } else {
      videoLabel = '0:v';
    }

    // Overlay video (or rounded video) centered on background
    filters.push(`[${currentBg}][${videoLabel}]overlay=(W-w)/2:(H-h)/2,format=yuv420p[vout]`);
    const filterComplex = filters.join(';');

    // ── Final FFmpeg command ──────────────────────────────────────
    const args = [
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[vout]', '-map', '0:a?',
      '-c:v', enc, ...qualityFlags,
      '-c:a', 'aac', '-b:a', '192k',
      '-pix_fmt', 'yuv420p', '-r', String(outFps),
      ...(frameCount > 0 ? ['-frames:v', String(frameCount)] : []),
      '-shortest', '-movflags', '+faststart',
      '-y', outputPath,
    ];

    const { promise } = spawnFfmpeg(args, onProgress, duration);
    try {
      await promise;
      cleanup();
      return outputPath;
    } catch (err: any) {
      // Fallback: simple pad filter without rounded corners or shadow
      console.warn(`[FFmpeg] Visual export failed (${err.message}), pad fallback…`);
      const bgColor = backgroundColor.replace('#', '0x');
      const fallbackArgs = [
        '-i', inputPath,
        '-vf', `pad=${finalW}:${finalH}:(ow-iw)/2:(oh-ih)/2:color=${bgColor}`,
        '-map', '0:v:0', '-map', '0:a?',
        '-c:v', enc, ...qualityFlags,
        '-c:a', 'aac', '-b:a', '192k',
        '-pix_fmt', 'yuv420p', '-r', String(outFps),
        '-movflags', '+faststart',
        '-y', outputPath,
      ];
      await spawnFfmpeg(fallbackArgs, onProgress, duration).promise;
      cleanup();
      return outputPath;
    }
  } catch (err) {
    cleanup();
    throw err;
  }
}
