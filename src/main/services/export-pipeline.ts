// Export pipeline — orchestrates trim → zoom → background → finalize.

import fs from 'fs';
import path from 'path';
import {
  EVENTS_FILE,
  RAW_RECORDING_FILE,
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
} from './ffmpeg';
import { platform } from '../platform';
import { fromBin, fromRoot, isPackaged } from '../paths';
import type { ExportProgress } from '../../shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeUnlink(filePath: string): void {
  if (!filePath || !fs.existsSync(filePath)) return;
  try { fs.unlinkSync(filePath); } catch { /* */ }
}

function validNum(n: number | undefined, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// ─── Processor binary resolution ──────────────────────────────────────────────

export function getProcessorBinaryPath(): string | null {
  const exeName = platform.executableName('screen_processor');
  const binPath = fromBin(exeName);
  if (fs.existsSync(binPath)) return binPath;

  // Also check extraResource path for packaged builds
  if (isPackaged() && process.resourcesPath) {
    const packagedBin = path.join(process.resourcesPath, 'bin', exeName);
    if (fs.existsSync(packagedBin)) return packagedBin;
  }

  return null;
}

function getScriptPath(): string | null {
  if (isPackaged()) {
    if (process.resourcesPath) {
      const packagedPath = path.join(process.resourcesPath, 'scripts', 'process.py');
      if (fs.existsSync(packagedPath)) return packagedPath;
    }
    return null;
  }

  const devPath = fromRoot('scripts', 'process.py');
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

function getPythonPath(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

// ─── Python/binary auto-zoom processor ────────────────────────────────────────

interface PythonProcessorOptions {
  zoom?: number;
  hold?: number;
  encoder?: string;
  onProgress?: (pct: number) => void;
  withBackground?: boolean;
  padding?: number;
  cornerRadius?: number;
  shadowBlur?: number;
  backgroundType?: string;
  backgroundColor?: string;
  gradientStart?: string;
  gradientEnd?: string;
  wallpaperPath?: string | null;
  imageBlur?: string;
}

function runPythonProcessor(
  inputPath: string,
  eventsPath: string,
  metaPath: string,
  outputPath: string,
  opts: PythonProcessorOptions = {},
): Promise<string> {
  const {
    zoom = 2.0,
    hold = 1.5,
    encoder = 'libx264',
    onProgress,
    withBackground = false,
    padding = 48,
    cornerRadius = 12,
    shadowBlur = 0,
    backgroundType = 'solid',
    backgroundColor = '#6366f1',
    gradientStart = '#667eea',
    gradientEnd = '#764ba2',
    wallpaperPath = null,
    imageBlur = 'none',
  } = opts;

  const ffmpegBin = getFfmpegPath();
  const processorBinPath = getProcessorBinaryPath();
  const scriptPath = processorBinPath ? null : getScriptPath();
  const pythonBin = processorBinPath ? null : getPythonPath();

  if (!processorBinPath && !scriptPath) {
    return Promise.reject(
      new Error('Auto-zoom processor not found (checked binary and script).'),
    );
  }

  const metaArgs = metaPath && fs.existsSync(metaPath)
    ? ['--meta', metaPath] : [];
  const encoderArgs = ['--encoder', encoder];

  const bgArgs = withBackground
    ? [
        '--background',
        '--padding', String(padding),
        '--corner-radius', String(cornerRadius),
        ...(shadowBlur > 0 ? ['--shadow-blur', String(shadowBlur)] : []),
        '--bg-type', backgroundType,
        '--bg-color', backgroundColor,
        '--gradient-start', gradientStart,
        '--gradient-end', gradientEnd,
        '--image-blur', imageBlur,
        ...(wallpaperPath ? ['--wallpaper', wallpaperPath] : []),
      ]
    : [];

  const command = processorBinPath || pythonBin!;
  const args = processorBinPath
    ? [
        inputPath, eventsPath, outputPath,
        '--zoom', String(zoom), '--hold', String(hold),
        '--ffmpeg', ffmpegBin, ...encoderArgs, ...metaArgs, ...bgArgs,
      ]
    : [
        scriptPath!, inputPath, eventsPath, outputPath,
        '--zoom', String(zoom), '--hold', String(hold),
        '--ffmpeg', ffmpegBin, ...encoderArgs, ...metaArgs, ...bgArgs,
      ];

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('PROGRESS:') && onProgress) {
          const pct = parseInt(trimmed.slice(9), 10);
          if (Number.isFinite(pct)) onProgress(pct);
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split('\n')) {
        if (line.trim()) console.log(`[Python] ${line.trim()}`);
      }
    });

    proc.on('close', (code: number) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`Python processor exited ${code}\n${stderr.slice(-500)}`));
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          processorBinPath
            ? `Bundled processor not found ("${command}").`
            : `Python not found ("${pythonBin}"). Install Python 3 and run: pip install opencv-python numpy`,
        ));
      } else {
        reject(err);
      }
    });
  });
}

// ─── Main export entry ───────────────────────────────────────────────────────

export interface ProcessVideoOptions {
  recordingDir: string;
  outputPath?: string;
  onProgress?: (progress: ExportProgress) => void;

  // Auto-zoom
  autoZoom?: boolean;
  zoomFactor?: number;
  zoomDuration?: number;
  fps?: number;

  // Visual
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

  // Trim
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

  const inputPath = path.join(recordingDir, RAW_RECORDING_FILE);
  const eventsPath = path.join(recordingDir, EVENTS_FILE);
  const metaPath = path.join(recordingDir, META_FILE);
  const outPath = outputPath ?? path.join(recordingDir, OUTPUT_FILE);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Recording not found: ${inputPath}`);
  }

  const targetFps = validNum(fps, DEFAULT_SETTINGS.fps);
  const encoder = await getBestH264Encoder();

  // ── Phase 1: Locate preview MP4 ──────────────────────────────────
  const previewPath = path.join(recordingDir, CLEAN_MP4_FILE);
  const intermediates: string[] = [];

  if (!fs.existsSync(previewPath)) {
    throw new Error(
      `preview.mp4 not found at ${previewPath}. Open the recording in the editor first.`,
    );
  }

  if (onProgress) onProgress({ percent: 0, phase: 'Loading recording…' });
  let currentInput = previewPath;

  // ── Phase 1.5: Trim ──────────────────────────────────────────────
  const isTrimmed = Number.isFinite(trimStart) && Number.isFinite(trimEnd)
    && trimStart! < trimEnd!
    && (trimStart! > 0.1 || trimEnd! < Infinity);

  if (isTrimmed) {
    const trimmedPath = path.join(recordingDir, '__intermediate_trimmed.mp4');
    intermediates.push(trimmedPath);
    if (onProgress) onProgress({ percent: 0, phase: 'Trimming…' });

    try {
      await trimVideo(currentInput, trimmedPath, trimStart!, trimEnd!, (p) => {
        if (onProgress && Number.isFinite(p.percent)) {
          onProgress({ percent: Math.min(15, Math.round(p.percent * 0.15)), phase: 'Trimming…' });
        }
      });
      currentInput = trimmedPath;
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Phase 2: Auto-zoom ───────────────────────────────────────────
  if (autoZoom) {
    const zoomOut = path.join(recordingDir, '__intermediate_zoom.mp4');
    intermediates.push(zoomOut);
    const audioSourceBeforePython = currentInput;

    const phaseLabel = background ? 'Applying zoom + background…' : 'Applying auto-zoom…';
    if (onProgress) onProgress({ percent: 15, phase: phaseLabel });

    try {
      await runPythonProcessor(currentInput, eventsPath, metaPath, zoomOut, {
        zoom: validNum(zoomFactor, DEFAULT_SETTINGS.zoomFactor),
        hold: validNum(zoomDuration, DEFAULT_SETTINGS.zoomDuration),
        encoder,
        onProgress: (pct) => {
          if (onProgress) {
            onProgress({ percent: Math.min(95, 15 + Math.round(pct * 0.8)), phase: phaseLabel });
          }
        },
        withBackground: background,
        padding, cornerRadius, shadowBlur, backgroundType,
        backgroundColor, gradientStart, gradientEnd,
        wallpaperPath, imageBlur,
      });
      currentInput = zoomOut;

      // Python is video-only; merge audio back
      const zoomAudio = path.join(recordingDir, '__intermediate_zoom_audio.mp4');
      intermediates.push(zoomAudio);
      try {
        await muxAudioInto(zoomOut, audioSourceBeforePython, zoomAudio);
        currentInput = zoomAudio;
      } catch (audioErr: any) {
        console.warn('[Export] Audio merge after zoom failed:', audioErr.message);
      }
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Phase 3: Visual polish (only without auto-zoom) ──────────────
  if (background && !autoZoom) {
    const visualOut = outPath;
    if (onProgress) onProgress({ percent: 15, phase: 'Applying background…' });

    try {
      await applyVisualExport(currentInput, visualOut, {
        cornerRadius, padding, shadowBlur, backgroundType,
        backgroundColor, gradientStart, gradientEnd,
        wallpaperPath, imageBlur,
      }, (p) => {
        if (onProgress && Number.isFinite(p.percent)) {
          onProgress({
            percent: Math.min(95, 15 + Math.round((p.percent * 80) / 100)),
            phase: 'Applying background…',
          });
        }
      }, encoder);
      currentInput = visualOut;
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Phase 4: Finalize ────────────────────────────────────────────
  if (currentInput !== outPath) {
    try {
      fs.copyFileSync(currentInput, outPath);
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  intermediates.forEach(safeUnlink);
  if (onProgress) onProgress({ percent: 100, phase: 'Done' });
  console.log(`[Export] Done → ${outPath}`);
  return outPath;
}
