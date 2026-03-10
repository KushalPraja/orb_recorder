// Export / post-processing handlers

import { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'crypto';
import fs from 'fs';
import type { FileHandle } from 'fs/promises';
import path from 'path';
import { RAW_RECORDING_FILE, CLEAN_MP4_FILE, EVENTS_FILE, META_FILE } from '../../shared/constants';
import type { ExportFileReaderHandle } from '../../shared/types';
import { remuxToCleanMp4 } from '../services/ffmpeg';
import { processVideo } from '../services/export-pipeline';
import { getSettings } from '../services/settings';
import { getMainWindow } from '../windows/main-window';
import { getRecordingSession } from './recording';
import { IPC } from '../../shared/constants';
import type { ExportOptions, LoadedEvents } from '../../shared/types';

interface ExportFileSession {
  filePath: string;
  handle: FileHandle;
}

const exportReaders = new Map<string, ExportFileSession>();
const exportWriters = new Map<string, ExportFileSession>();

async function closeExportSession(
  store: Map<string, ExportFileSession>,
  id: string,
): Promise<ExportFileSession | null> {
  const session = store.get(id) ?? null;
  if (!session) return null;

  store.delete(id);
  await session.handle.close();
  return session;
}

export async function handleRemuxVideo(
  _event: IpcMainInvokeEvent,
  sessionDir: string,
): Promise<string> {
  const settings = getSettings();
  const rawPath = path.join(sessionDir, RAW_RECORDING_FILE);
  const cleanPath = path.join(sessionDir, CLEAN_MP4_FILE);

  if (fs.existsSync(cleanPath)) {
    console.log(`[Export] Reusing cached preview: ${cleanPath}`);
    return cleanPath;
  }

  if (!fs.existsSync(rawPath)) {
    throw new Error(`Recording not found: ${rawPath}`);
  }

  console.log(`[Export] Remuxing: ${rawPath} → ${cleanPath}`);
  await remuxToCleanMp4(rawPath, cleanPath, null, settings.fps);
  return cleanPath;
}

export async function handleProcessVideo(
  _event: IpcMainInvokeEvent,
  opts: ExportOptions = {},
): Promise<string> {
  const session = getRecordingSession();
  const sessionDir = opts.sessionDir ?? session?.sessionDir;
  if (!sessionDir) {
    throw new Error('No session directory provided and no active recording session');
  }

  const settings = getSettings();
  const mainWindow = getMainWindow();

  // Resolve wallpaper path
  let wallpaperPath: string | null = null;
  if (opts.wallpaperFile) {
    const { app } = require('electron');
    const base = app.getAppPath();
    const baseUnpacked = base.replace(/app\.asar$/, 'app.asar.unpacked');
    const candidates = [
      path.join(base, 'dist', 'Wallpapers', opts.wallpaperFile),
      path.join(baseUnpacked, 'dist', 'Wallpapers', opts.wallpaperFile),
      path.join(base, 'src', 'renderer', 'public', 'Wallpapers', opts.wallpaperFile),  // dev fallback
    ];
    wallpaperPath =
      candidates.find((p) => fs.existsSync(p) && !p.includes('app.asar\\') && !p.includes('app.asar/'))
      || candidates.find((p) => fs.existsSync(p))
      || null;
    if (wallpaperPath) console.log(`[Export] Resolved wallpaper: ${wallpaperPath}`);
    else console.warn(`[Export] Wallpaper not found: ${opts.wallpaperFile}`);
  }

  try {
    const outputPath = await processVideo({
      recordingDir: sessionDir,
      outputPath: opts.exportPath || undefined,
      fps: settings.fps,

      autoZoom: !!opts.autoZoom,
      zoomFactor: settings.zoomFactor,
      zoomDuration: settings.zoomDuration,
      customZoomSegments: opts.customZoomSegments,

      background: !!opts.background,
      cornerRadius: opts.cornerRadius ?? 12,
      padding: opts.padding ?? 48,
      shadowBlur: opts.shadowBlur ?? 0,
      backgroundType: opts.backgroundType ?? 'solid',
      backgroundColor: opts.backgroundColor ?? '#6366f1',
      gradientStart: opts.gradientStart ?? '#667eea',
      gradientEnd: opts.gradientEnd ?? '#764ba2',
      wallpaperPath,
      imageBlur: opts.imageBlur ?? 'none',

      trimStart: opts.trimStart,
      trimEnd: opts.trimEnd,

      onProgress: (progress) => {
        mainWindow?.webContents.send(IPC.PROCESSING_PROGRESS, progress);
      },
    });

    mainWindow?.webContents.send(IPC.PROCESSING_DONE, { outputPath });
    return outputPath;
  } catch (err: any) {
    mainWindow?.webContents.send(IPC.PROCESSING_ERROR, { error: err.message });
    throw err;
  }
}

export async function handleLoadEvents(
  _event: IpcMainInvokeEvent,
  sessionDir: string,
): Promise<LoadedEvents> {
  const eventsPath = path.join(sessionDir, EVENTS_FILE);
  const metaPath = path.join(sessionDir, META_FILE);

  let events: any[] = [];
  if (fs.existsSync(eventsPath)) {
    try {
      const raw = fs.readFileSync(eventsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) events = parsed;
    } catch (err) {
      console.warn(`[Events] Failed to parse ${eventsPath}:`, err);
    }
  }

  let meta: any = null;
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (err) {
      console.warn(`[Events] Failed to parse ${metaPath}:`, err);
    }
  }

  return { events, meta };
}

export async function handleExportOpenReader(
  _event: IpcMainInvokeEvent,
  filePath: string,
): Promise<ExportFileReaderHandle> {
  const stat = await fs.promises.stat(filePath);
  const readerId = randomUUID();
  const handle = await fs.promises.open(filePath, 'r');
  exportReaders.set(readerId, { filePath, handle });
  return { readerId, size: stat.size };
}

export async function handleExportReadRange(
  _event: IpcMainInvokeEvent,
  readerId: string,
  start: number,
  end: number,
): Promise<ArrayBuffer> {
  const session = exportReaders.get(readerId);
  if (!session) throw new Error(`Unknown export reader: ${readerId}`);

  const safeStart = Math.max(0, Math.floor(start));
  const safeEnd = Math.max(safeStart, Math.floor(end));
  const length = safeEnd - safeStart;
  const bytes = new Uint8Array(length);

  if (length === 0) {
    return bytes.buffer;
  }

  const { bytesRead } = await session.handle.read(bytes, 0, length, safeStart);
  return bytes.buffer.slice(0, bytesRead);
}

export async function handleExportCloseReader(
  _event: IpcMainInvokeEvent,
  readerId: string,
): Promise<void> {
  await closeExportSession(exportReaders, readerId);
}

export async function handleExportOpenWriter(
  _event: IpcMainInvokeEvent,
  filePath: string,
): Promise<string> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const writerId = randomUUID();
  const handle = await fs.promises.open(filePath, 'w');
  exportWriters.set(writerId, { filePath, handle });
  return writerId;
}

export async function handleExportWriteChunk(
  _event: IpcMainInvokeEvent,
  writerId: string,
  position: number,
  data: Uint8Array | ArrayBuffer,
): Promise<void> {
  const session = exportWriters.get(writerId);
  if (!session) throw new Error(`Unknown export writer: ${writerId}`);

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  await session.handle.write(bytes, 0, bytes.byteLength, Math.max(0, Math.floor(position)));
}

export async function handleExportCloseWriter(
  _event: IpcMainInvokeEvent,
  writerId: string,
): Promise<void> {
  await closeExportSession(exportWriters, writerId);
}

export async function handleExportAbortWriter(
  _event: IpcMainInvokeEvent,
  writerId: string,
): Promise<void> {
  const session = await closeExportSession(exportWriters, writerId);
  if (!session) return;

  try {
    await fs.promises.unlink(session.filePath);
  } catch {
    // Ignore missing partial files.
  }
}
