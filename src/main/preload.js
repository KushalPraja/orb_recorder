// Preload script — securely exposes main-process APIs to the renderer
// via contextBridge. This is the ONLY bridge between the renderer and Node.js.
//
// IPC channel names come from shared/constants so there is exactly one
// definition of every channel string in the entire codebase.

const { contextBridge, ipcRenderer } = require("electron");
const { IPC } = require("../shared/constants");

contextBridge.exposeInMainWorld("electronAPI", {
  // ─── Recording lifecycle ───────────────────────────────────────────
  startRecording: () => ipcRenderer.invoke(IPC.START_RECORDING),
  stopRecording: () => ipcRenderer.invoke(IPC.STOP_RECORDING),
  setCaptureSource: (sourceId) =>
    ipcRenderer.invoke(IPC.SET_CAPTURE_SOURCE, sourceId),
  prepareRecordingUi: () => ipcRenderer.invoke(IPC.PREPARE_RECORDING_UI),
  finishRecordingUi: () => ipcRenderer.invoke(IPC.FINISH_RECORDING_UI),
  saveRecording: (buffer) => ipcRenderer.invoke(IPC.SAVE_RECORDING, buffer),
  onOverlayStopRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.OVERLAY_STOP_REQUEST, handler);
    return () => ipcRenderer.removeListener(IPC.OVERLAY_STOP_REQUEST, handler);
  },
  onOverlayPauseRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.OVERLAY_PAUSE_REQUEST, handler);
    return () => ipcRenderer.removeListener(IPC.OVERLAY_PAUSE_REQUEST, handler);
  },
  onOverlayResumeRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.OVERLAY_RESUME_REQUEST, handler);
    return () =>
      ipcRenderer.removeListener(IPC.OVERLAY_RESUME_REQUEST, handler);
  },
  onOverlayDiscardRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.OVERLAY_DISCARD_REQUEST, handler);
    return () =>
      ipcRenderer.removeListener(IPC.OVERLAY_DISCARD_REQUEST, handler);
  },

  // ─── Library management ────────────────────────────────────────────
  getRecordings: () => ipcRenderer.invoke(IPC.GET_RECORDINGS),
  deleteRecording: (sessionDir) =>
    ipcRenderer.invoke(IPC.DELETE_RECORDING, sessionDir),
  renameRecording: (sessionDir, newName) =>
    ipcRenderer.invoke(IPC.RENAME_RECORDING, sessionDir, newName),

  // ─── Screen sources ────────────────────────────────────────────────
  getSources: () => ipcRenderer.invoke(IPC.GET_SOURCES),

  // ─── Post-processing ──────────────────────────────────────────────
  remuxVideo: (sessionDir) => ipcRenderer.invoke(IPC.REMUX_VIDEO, sessionDir),
  processVideo: (opts) => ipcRenderer.invoke(IPC.PROCESS_VIDEO, opts),
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(IPC.PROCESSING_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.PROCESSING_PROGRESS, handler);
  },
  onProcessingDone: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(IPC.PROCESSING_DONE, handler);
    return () => ipcRenderer.removeListener(IPC.PROCESSING_DONE, handler);
  },
  onProcessingError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(IPC.PROCESSING_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.PROCESSING_ERROR, handler);
  },

  // ─── Settings ──────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  setSettings: (settings) => ipcRenderer.invoke(IPC.SET_SETTINGS, settings),

  // ─── Dialogs & shell ──────────────────────────────────────────────
  pickOutputDir: () => ipcRenderer.invoke(IPC.PICK_OUTPUT_DIR),
  pickExportPath: (defaultName) =>
    ipcRenderer.invoke(IPC.PICK_EXPORT_PATH, defaultName),
  openOutput: (filePath) => ipcRenderer.invoke(IPC.OPEN_OUTPUT, filePath),
  openSettings: () => ipcRenderer.invoke(IPC.OPEN_SETTINGS),
});
