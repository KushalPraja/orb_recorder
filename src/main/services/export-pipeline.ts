// Export pipeline — delegates final rendering to a hidden renderer window that
// uses WebCodecs + canvas composition instead of FFmpeg.

import fs from 'fs';
import path from 'path';
import {
  CLEAN_MP4_FILE,
  DEFAULT_SETTINGS,
  EVENTS_FILE,
  META_FILE,
  OUTPUT_FILE,
  RAW_RECORDING_FILE,
} from '../../shared/constants';
import type {
  ExportProgress,
  ExportQuality,
  ImageBlur,
  InputEvent,
  RecordingMeta,
  RendererExportRequest,
  ZoomSegment,
} from '../../shared/types';
import { runRendererExport } from './renderer-export-host';

function validNum(n: number | undefined, fallback: number): number {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function loadJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    console.warn(`[Export] Failed to parse ${filePath}:`, error);
    return fallback;
  }
}

function pickExportInput(recordingDir: string): string {
  const rawPath = path.join(recordingDir, RAW_RECORDING_FILE);
  if (fs.existsSync(rawPath)) return rawPath;

  const previewPath = path.join(recordingDir, CLEAN_MP4_FILE);
  if (fs.existsSync(previewPath)) return previewPath;

  throw new Error(
    `No exportable recording found in ${recordingDir}. Expected ${RAW_RECORDING_FILE} or ${CLEAN_MP4_FILE}.`,
  );
}

function normalizeTrimRange(
  trimStart: number | undefined,
  trimEnd: number | undefined,
): { trimStart?: number; trimEnd?: number } {
  const start = Number(trimStart);
  const end = Number(trimEnd);

  const hasStart = Number.isFinite(start) && start > 0;
  const hasEnd = Number.isFinite(end) && end > 0;

  if (!hasStart && !hasEnd) return {};
  if (!hasEnd) return { trimStart: Math.max(0, start) };
  if (!hasStart) return { trimEnd: end };
  if (end <= start) throw new Error('Trim end must be greater than trim start.');

  return { trimStart: Math.max(0, start), trimEnd: end };
}

export interface ProcessVideoOptions {
  recordingDir: string;
  outputPath?: string;
  onProgress?: (progress: ExportProgress) => void;
  autoZoom?: boolean;
  zoomFactor?: number;
  zoomDuration?: number;
  customZoomSegments?: ZoomSegment[];
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
  imageBlur?: ImageBlur;
  exportQuality?: ExportQuality;
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
    customZoomSegments,
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
    exportQuality = 'balanced',
    trimStart,
    trimEnd,
  } = opts;

  console.log(`[Export] Starting export with options:`, {
    recordingDir,
    outputPath,
    autoZoom,
    zoomFactor,
    zoomDuration,
    customZoomSegments,
    fps,
    background,
    cornerRadius,
    padding,
    shadowBlur,
    backgroundType,
    backgroundColor,
    gradientStart,
    gradientEnd,
    wallpaperPath,
    imageBlur,
    exportQuality,
    trimStart,
    trimEnd,
  });

  const outPath = outputPath ?? path.join(recordingDir, OUTPUT_FILE);
  const inputPath = pickExportInput(recordingDir);
  const eventsPath = path.join(recordingDir, EVENTS_FILE);
  const metaPath = path.join(recordingDir, META_FILE);

  const rawEvents = loadJsonFile<InputEvent[]>(eventsPath, []);
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  const meta = loadJsonFile<RecordingMeta | null>(metaPath, null);
  const trim = normalizeTrimRange(trimStart, trimEnd);

  const request: RendererExportRequest = {
    jobId: `export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    inputPath,
    outputPath: outPath,
    events,
    meta,
    fps: Math.round(validNum(fps, DEFAULT_SETTINGS.fps)),
    autoZoom,
    zoomFactor: Math.min(validNum(zoomFactor, DEFAULT_SETTINGS.zoomFactor), 2.5),
    zoomDuration: validNum(zoomDuration, DEFAULT_SETTINGS.zoomDuration),
    customZoomSegments,
    background,
    cornerRadius: background ? cornerRadius : 0,
    padding: background ? padding : 0,
    shadowBlur: background ? shadowBlur : 0,
    backgroundType,
    backgroundColor,
    gradientStart,
    gradientEnd,
    wallpaperPath,
    imageBlur,
    exportQuality,
    ...trim,
  };

  onProgress?.({ percent: 0, phase: 'Preparing export…' });
  const exportedPath = await runRendererExport(request, onProgress);
  onProgress?.({ percent: 100, phase: 'Done' });
  console.log(`[Export] Done -> ${exportedPath}`);
  return exportedPath;
}
