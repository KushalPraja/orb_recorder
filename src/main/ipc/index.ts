// IPC Router — thin routing layer that maps channel names to handler functions.
// Each handler module exports named functions; this is the only file that
// touches ipcMain.handle / ipcMain.on.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/constants';
import { getMainWindow } from '../windows/main-window';

import * as appHandlers from '../handlers/app';
import * as recordingHandlers from '../handlers/recording';
import * as sourcesHandlers from '../handlers/sources';
import * as exportHandlers from '../handlers/export';
import * as settingsHandlers from '../handlers/settings';
import * as fsHandlers from '../handlers/file-system';
import * as shellHandlers from '../handlers/shell';
import * as recordingsHandlers from '../handlers/recordings';

export function registerIpcHandlers(): void {
  // ── Recording lifecycle ────────────────────────────────────────
  ipcMain.handle(IPC.SET_CAPTURE_SOURCE, recordingHandlers.handleSetCaptureSource);
  ipcMain.handle(IPC.START_RECORDING, recordingHandlers.handleStartRecording);
  ipcMain.handle(IPC.STOP_RECORDING, recordingHandlers.handleStopRecording);
  ipcMain.handle(IPC.PREPARE_RECORDING_UI, recordingHandlers.handlePrepareRecordingUI);
  ipcMain.handle(IPC.FINISH_RECORDING_UI, recordingHandlers.handleFinishRecordingUI);
  ipcMain.handle(IPC.SAVE_RECORDING, recordingHandlers.handleSaveRecording);

  // ── Overlay → main → renderer relay ───────────────────────────
  ipcMain.on('recording:overlay-stop-clicked', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.OVERLAY_STOP_REQUEST);
  });

  ipcMain.on('recording:overlay-pause-clicked', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.OVERLAY_PAUSE_REQUEST);
  });

  ipcMain.on('recording:overlay-resume-clicked', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.OVERLAY_RESUME_REQUEST);
  });

  ipcMain.on('recording:overlay-discard-clicked', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.OVERLAY_DISCARD_REQUEST);
  });

  // ── Overlay resize (currently just logs — overlay handles its own size) ──
  ipcMain.on(IPC.OVERLAY_RESIZE, (_event, { width, height }: { width: number; height: number }) => {
    console.log(`[IPC] Overlay resize requested: ${width}x${height}`);
    // TODO: Resize the overlay BrowserWindow if needed
  });

  // ── Screen sources ────────────────────────────────────────────
  ipcMain.handle(IPC.GET_SOURCES, sourcesHandlers.handleGetSources);

  // ── Post-processing / export ──────────────────────────────────
  ipcMain.handle(IPC.REMUX_VIDEO, exportHandlers.handleRemuxVideo);
  ipcMain.handle(IPC.PROCESS_VIDEO, exportHandlers.handleProcessVideo);

  // ── Events loading ──────────────────────────────────────────
  ipcMain.handle(IPC.LOAD_EVENTS, exportHandlers.handleLoadEvents);

  // ── Settings ──────────────────────────────────────────────────
  ipcMain.handle(IPC.GET_SETTINGS, settingsHandlers.handleGetSettings);
  ipcMain.handle(IPC.SET_SETTINGS, settingsHandlers.handleSetSettings);

  // ── Recordings library ────────────────────────────────────────
  ipcMain.handle(IPC.GET_RECORDINGS, recordingsHandlers.handleGetRecordings);
  ipcMain.handle(IPC.DELETE_RECORDING, recordingsHandlers.handleDeleteRecording);
  ipcMain.handle(IPC.RENAME_RECORDING, recordingsHandlers.handleRenameRecording);

  // ── File system & dialogs ─────────────────────────────────────
  ipcMain.handle(IPC.PICK_OUTPUT_DIR, fsHandlers.handlePickOutputDir);
  ipcMain.handle(IPC.PICK_EXPORT_PATH, fsHandlers.handlePickExportPath);

  // ── Shell ─────────────────────────────────────────────────────
  ipcMain.handle(IPC.OPEN_OUTPUT, shellHandlers.handleOpenOutput);
  ipcMain.handle(IPC.OPEN_SETTINGS, shellHandlers.handleOpenSettings);
}
