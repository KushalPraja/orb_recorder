// Export / post-processing handlers

import { IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import path from 'path';
import { RAW_RECORDING_FILE, CLEAN_MP4_FILE } from '../../shared/constants';
import { remuxToCleanMp4 } from '../services/ffmpeg';
import { processVideo } from '../services/export-pipeline';
import { getSettings } from '../services/settings';
import { getMainWindow } from '../windows/main-window';
import { getRecordingSession } from './recording';
import { IPC } from '../../shared/constants';
import type { ExportOptions } from '../../shared/types';

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
      path.join(baseUnpacked, 'dist', 'renderer', 'Wallpapers', opts.wallpaperFile),
      path.join(baseUnpacked, 'renderer', 'Wallpapers', opts.wallpaperFile),
      path.join(base, 'src', 'renderer', 'public', 'Wallpapers', opts.wallpaperFile),
      path.join(base, '.vite', 'renderer', 'main_window', 'Wallpapers', opts.wallpaperFile),
      path.join(base, 'dist', 'renderer', 'Wallpapers', opts.wallpaperFile),
      path.join(base, 'renderer', 'Wallpapers', opts.wallpaperFile),
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

      background: !!opts.background,
      cornerRadius: opts.cornerRadius ?? 12,
      padding: opts.padding ?? 48,
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
