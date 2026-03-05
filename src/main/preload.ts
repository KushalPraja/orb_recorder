// Preload script — securely exposes main-process APIs to the renderer
// via contextBridge. This is the ONLY bridge between the renderer and Node.js.
//
// IPC channel names come from shared/constants so there is exactly one
// definition of every channel string in the entire codebase.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Register an IPC listener with a typed data payload; returns a cleanup fn. */
function onIpc<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/** Register a signal-style (no payload) IPC listener; returns a cleanup fn. */
function onSignal(channel: string, callback: () => void): () => void {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// ─── Exposed API ─────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Recording lifecycle ───────────────────────────────────────────
  startRecording: () => ipcRenderer.invoke(IPC.START_RECORDING),
  stopRecording: (videoStartTime: number) =>
    ipcRenderer.invoke(IPC.STOP_RECORDING, videoStartTime),
  setCaptureSource: (sourceId: string) =>
    ipcRenderer.invoke(IPC.SET_CAPTURE_SOURCE, sourceId),
  prepareRecordingUi: () => ipcRenderer.invoke(IPC.PREPARE_RECORDING_UI),
  finishRecordingUi: () => ipcRenderer.invoke(IPC.FINISH_RECORDING_UI),
  saveRecording: (buffer: ArrayBuffer) =>
    ipcRenderer.invoke(IPC.SAVE_RECORDING, buffer),

  onOverlayStopRequest: (cb: () => void) =>
    onSignal(IPC.OVERLAY_STOP_REQUEST, cb),
  onOverlayPauseRequest: (cb: () => void) =>
    onSignal(IPC.OVERLAY_PAUSE_REQUEST, cb),
  onOverlayResumeRequest: (cb: () => void) =>
    onSignal(IPC.OVERLAY_RESUME_REQUEST, cb),
  onOverlayDiscardRequest: (cb: () => void) =>
    onSignal(IPC.OVERLAY_DISCARD_REQUEST, cb),

  // ─── Library management ────────────────────────────────────────────
  getRecordings: () => ipcRenderer.invoke(IPC.GET_RECORDINGS),
  deleteRecording: (sessionDir: string) =>
    ipcRenderer.invoke(IPC.DELETE_RECORDING, sessionDir),
  renameRecording: (sessionDir: string, newName: string) =>
    ipcRenderer.invoke(IPC.RENAME_RECORDING, sessionDir, newName),

  // ─── Screen sources ────────────────────────────────────────────────
  getSources: () => ipcRenderer.invoke(IPC.GET_SOURCES),

  // ─── Post-processing ──────────────────────────────────────────────
  remuxVideo: (sessionDir: string) =>
    ipcRenderer.invoke(IPC.REMUX_VIDEO, sessionDir),
  processVideo: (opts: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.PROCESS_VIDEO, opts),
  onProgress: (cb: (data: { percent: number; phase?: string }) => void) =>
    onIpc(IPC.PROCESSING_PROGRESS, cb),
  onProcessingDone: (cb: (data: { outputPath: string }) => void) =>
    onIpc(IPC.PROCESSING_DONE, cb),
  onProcessingError: (cb: (data: { error: string }) => void) =>
    onIpc(IPC.PROCESSING_ERROR, cb),

  // ─── Settings ──────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  setSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.SET_SETTINGS, settings),

  // ─── Dialogs & shell ──────────────────────────────────────────────
  pickOutputDir: () => ipcRenderer.invoke(IPC.PICK_OUTPUT_DIR),
  pickExportPath: (defaultName: string) =>
    ipcRenderer.invoke(IPC.PICK_EXPORT_PATH, defaultName),
  openOutput: (filePath: string) =>
    ipcRenderer.invoke(IPC.OPEN_OUTPUT, filePath),
  openSettings: () => ipcRenderer.invoke(IPC.OPEN_SETTINGS),
});
