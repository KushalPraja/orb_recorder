// Preload script — securely exposes main-process APIs to the renderer
// via contextBridge. This is the ONLY way the renderer can talk to Node.js.

const { contextBridge, ipcRenderer } = require('electron');

const IPC = {
  START_RECORDING: 'recording:start',
  STOP_RECORDING: 'recording:stop',
  PREPARE_RECORDING_UI: 'recording:prepare-ui',
  FINISH_RECORDING_UI: 'recording:finish-ui',
  SAVE_RECORDING: 'recording:save',
  PROCESS_VIDEO: 'video:process',
  PROCESSING_PROGRESS: 'video:progress',
  PROCESSING_DONE: 'video:done',
  PROCESSING_ERROR: 'video:error',
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',
  PICK_OUTPUT_DIR: 'dialog:pickOutputDir',
  OPEN_OUTPUT: 'shell:openOutput',
};

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Recording ─────────────────────────────────────────────────
  startRecording: () => ipcRenderer.invoke(IPC.START_RECORDING),
  stopRecording: () => ipcRenderer.invoke(IPC.STOP_RECORDING),
  prepareRecordingUi: () => ipcRenderer.invoke(IPC.PREPARE_RECORDING_UI),
  finishRecordingUi: () => ipcRenderer.invoke(IPC.FINISH_RECORDING_UI),
  saveRecording: (buffer) => ipcRenderer.invoke(IPC.SAVE_RECORDING, buffer),

  // ─── Post-Processing ──────────────────────────────────────────
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

  // ─── Settings ──────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  setSettings: (settings) => ipcRenderer.invoke(IPC.SET_SETTINGS, settings),

  // ─── Dialogs & Shell ──────────────────────────────────────────
  pickOutputDir: () => ipcRenderer.invoke(IPC.PICK_OUTPUT_DIR),
  openOutput: (filePath) => ipcRenderer.invoke(IPC.OPEN_OUTPUT, filePath),
});
