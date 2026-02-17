// IPC Handlers — bridge between renderer UI and backend modules.
// Registered in the main process.

const { ipcMain, dialog, shell, BrowserWindow, screen, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const inputTracker = require('./input-tracker');
const { processVideo } = require('./post-processor');
const {
  IPC,
  DEFAULT_FPS,
  DEFAULT_ZOOM_FACTOR,
  DEFAULT_ZOOM_DURATION,
  DEFAULT_OUTPUT_DIR,
  RAW_RECORDING_FILE,
  EVENTS_FILE,
  OUTPUT_FILE,
  SETTINGS_FILE,
} = require('../shared/constants');

// ─── Persistent Settings ────────────────────────────────────────────

function getSettingsPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function loadSettings() {
  const defaults = {
    fps: DEFAULT_FPS,
    zoomFactor: DEFAULT_ZOOM_FACTOR,
    zoomDuration: DEFAULT_ZOOM_DURATION,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  try {
    const filePath = getSettingsPath();
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { ...defaults, ...data };
    }
  } catch (err) {
    console.error('[Settings] Failed to load settings:', err);
  }
  return defaults;
}

function saveSettings(settings) {
  try {
    const filePath = getSettingsPath();
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[Settings] Failed to save settings:', err);
  }
}

let settings = loadSettings();

// Current recording session state
let recordingSession = null;
let recordingOverlay = null;

function showCountdownOverlay(seconds = 3) {
  return new Promise((resolve) => {
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.bounds;

    const overlay = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      fullscreen: false,
      resizable: false,
      movable: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      },
    });

    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true);

    const html = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body{margin:0;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden;font-family:Inter,Segoe UI,Arial,sans-serif}
        .stack{display:flex;flex-direction:column;align-items:center;gap:14px}
        .circle{width:180px;height:180px;border-radius:999px;background:#101010;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.18);box-shadow:0 14px 40px rgba(0,0,0,0.45)}
        .n{font-size:88px;font-weight:700;color:#f5f5f5;line-height:1}
        .label{font-size:14px;letter-spacing:.4px;color:#b3b3b3}
      </style>
    </head>
    <body>
      <div class="stack">
        <div class="circle"><div id="n" class="n">${seconds}</div></div>
        <div class="label">Recording starts now</div>
      </div>
      <script>
        let remaining=${seconds};
        const el=document.getElementById('n');
        const interval=setInterval(()=>{
          remaining-=1;
          if(remaining<=0){
            clearInterval(interval);
            window.close();
            return;
          }
          el.textContent=String(remaining);
        },1000);
      </script>
    </body>
    </html>`;

    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    overlay.on('closed', () => resolve());
  });
}

function closeRecordingOverlay() {
  if (recordingOverlay && !recordingOverlay.isDestroyed()) {
    recordingOverlay.close();
  }
  recordingOverlay = null;
}

function showRecordingOverlay(mainWindow) {
  closeRecordingOverlay();

  recordingOverlay = new BrowserWindow({
    width: 280,
    height: 66,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    movable: true,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  recordingOverlay.setAlwaysOnTop(true, 'screen-saver');
  recordingOverlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const html = `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <style>
      *{box-sizing:border-box}
      body{margin:0;padding:10px;background:transparent;font-family:Inter,Segoe UI,Arial,sans-serif}
      .bar{height:46px;border-radius:12px;background:rgba(12,12,12,.95);border:1px solid rgba(255,255,255,.16);display:flex;align-items:center;gap:10px;padding:0 12px;-webkit-app-region:drag}
      .dot{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:pulse 1.6s ease-in-out infinite;flex:none}
      .timer{font-weight:700;font-size:14px;letter-spacing:.4px;color:#f5f5f5;min-width:54px}
      .label{font-size:12px;color:#b3b3b3;flex:1}
      .stop{border:1px solid rgba(239,68,68,.55);background:rgba(239,68,68,.16);color:#fca5a5;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;-webkit-app-region:no-drag}
      .stop:hover{background:rgba(239,68,68,.24)}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
    </style>
  </head>
  <body>
    <div class="bar">
      <span class="dot"></span>
      <span id="timer" class="timer">00:00</span>
      <span class="label">Recording</span>
      <button class="stop" id="stop">Stop</button>
    </div>
    <script>
      const { ipcRenderer } = require('electron');
      const timerEl = document.getElementById('timer');
      const stopBtn = document.getElementById('stop');
      const start = Date.now();
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        timerEl.textContent = mins + ':' + secs;
      }, 1000);
      stopBtn.addEventListener('click', () => ipcRenderer.send('recording:overlay-stop-clicked'));
      window.addEventListener('beforeunload', () => clearInterval(interval));
    </script>
  </body>
  </html>`;

  recordingOverlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  recordingOverlay.on('closed', () => {
    recordingOverlay = null;
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    const [mainX, mainY] = mainWindow.getPosition();
    const [mainWidth] = mainWindow.getSize();
    recordingOverlay.setPosition(mainX + mainWidth - 320, mainY + 60, false);
  }
}

/**
 * Register all IPC handlers.
 * @param {BrowserWindow} mainWindow  The main app window
 */
function registerIpcHandlers(mainWindow, setSelectedCaptureSource) {
  // ─── Recording Control ────────────────────────────────────────────

  ipcMain.handle(IPC.SET_CAPTURE_SOURCE, async (_event, sourceId) => {
    if (typeof setSelectedCaptureSource === 'function') {
      setSelectedCaptureSource(sourceId);
    }
    return true;
  });

  ipcMain.handle(IPC.START_RECORDING, async () => {
    const timestamp = Date.now();

    // Create a session directory for this recording
    const sessionId = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
    const sessionDir = path.join(settings.outputDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Start input tracking
    inputTracker.start(timestamp);

    recordingSession = {
      startTime: timestamp,
      sessionDir,
    };

    showRecordingOverlay(mainWindow);

    console.log(`[IPC] Recording started — session: ${sessionDir}`);
    return { sessionDir, startTime: timestamp };
  });

  ipcMain.handle(IPC.STOP_RECORDING, async () => {
    if (!recordingSession) {
      throw new Error('No active recording session');
    }

    // Stop input tracking and get events
    const events = inputTracker.stop();

    // Save events to JSON
    const eventsPath = path.join(recordingSession.sessionDir, EVENTS_FILE);
    fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2));

    const result = {
      sessionDir: recordingSession.sessionDir,
      eventCount: events.length,
      events,
    };

    closeRecordingOverlay();

    console.log(`[IPC] Recording stopped — ${events.length} events captured`);
    return result;
  });

  ipcMain.handle(IPC.PREPARE_RECORDING_UI, async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
    await showCountdownOverlay(3);
    return true;
  });

  ipcMain.handle(IPC.FINISH_RECORDING_UI, async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return true;
  });

  ipcMain.removeAllListeners('recording:overlay-stop-clicked');
  ipcMain.on('recording:overlay-stop-clicked', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.OVERLAY_STOP_REQUEST);
    }
  });

  // ─── Save Recording Blob ──────────────────────────────────────────

  ipcMain.handle(IPC.SAVE_RECORDING, async (_event, buffer) => {
    if (!recordingSession) {
      throw new Error('No active recording session');
    }

    const filePath = path.join(recordingSession.sessionDir, RAW_RECORDING_FILE);
    fs.writeFileSync(filePath, Buffer.from(buffer));

    console.log(`[IPC] Recording saved: ${filePath} (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
    return filePath;
  });

  // ─── Post-Processing ──────────────────────────────────────────────

  ipcMain.handle(IPC.PROCESS_VIDEO, async (_event, opts = {}) => {
    const sessionDir = opts.sessionDir || (recordingSession && recordingSession.sessionDir);
    if (!sessionDir) {
      throw new Error('No recording session to process');
    }

    try {
      const outputPath = await processVideo({
        recordingDir: sessionDir,
        zoomFactor: opts.zoomFactor || settings.zoomFactor,
        zoomDuration: opts.zoomDuration || settings.zoomDuration,
        onProgress: (progress) => {
          mainWindow.webContents.send(IPC.PROCESSING_PROGRESS, progress);
        },
      });

      mainWindow.webContents.send(IPC.PROCESSING_DONE, { outputPath });
      return outputPath;
    } catch (err) {
      mainWindow.webContents.send(IPC.PROCESSING_ERROR, { error: err.message });
      throw err;
    }
  });

  // ─── Settings ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    return { ...settings };
  });

  ipcMain.handle(IPC.SET_SETTINGS, async (_event, newSettings) => {
    settings = { ...settings, ...newSettings };
    saveSettings(settings);
    console.log('[IPC] Settings updated:', settings);
    return settings;
  });

  // ─── Dialogs & Shell ──────────────────────────────────────────────

  ipcMain.handle(IPC.PICK_OUTPUT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Output Directory',
      defaultPath: settings.outputDir,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      settings.outputDir = result.filePaths[0];
      saveSettings(settings);
      return settings.outputDir;
    }
    return null;
  });

  ipcMain.handle(IPC.OPEN_OUTPUT, async (_event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    } else if (recordingSession) {
      shell.openPath(recordingSession.sessionDir);
    }
  });

  // ─── Screen Sources ──────────────────────────────────────────────

  ipcMain.handle(IPC.GET_SOURCES, async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 320, height: 200 },
      });

      return sources.map((src) => ({
        id: src.id,
        name: src.name,
        thumbnail: src.thumbnail.toDataURL(),
      }));
    } catch (err) {
      console.error('[IPC] Failed to get sources:', err);
      return [];
    }
  });

  // ─── Recordings Management ────────────────────────────────────────

  ipcMain.handle(IPC.GET_RECORDINGS, async () => {
    try {
      const outputDir = settings.outputDir;
      if (!fs.existsSync(outputDir)) return [];

      const entries = fs.readdirSync(outputDir, { withFileTypes: true });
      const recordings = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const sessionDir = path.join(outputDir, entry.name);
        const rawFile = path.join(sessionDir, RAW_RECORDING_FILE);
        const outputFile = path.join(sessionDir, OUTPUT_FILE);

        if (!fs.existsSync(rawFile)) continue;

        const stat = fs.statSync(rawFile);
        const hasOutput = fs.existsSync(outputFile);

        recordings.push({
          sessionDir,
          name: entry.name,
          timestamp: stat.mtimeMs,
          size: stat.size,
          filePath: rawFile,
          outputPath: hasOutput ? outputFile : null,
          duration: null, // could parse from events
        });
      }

      // Sort newest first
      recordings.sort((a, b) => b.timestamp - a.timestamp);
      return recordings;
    } catch (err) {
      console.error('[IPC] Failed to list recordings:', err);
      return [];
    }
  });

  ipcMain.handle(IPC.DELETE_RECORDING, async (_event, sessionDir) => {
    try {
      if (sessionDir && fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`[IPC] Deleted recording: ${sessionDir}`);
      }
      return true;
    } catch (err) {
      console.error('[IPC] Failed to delete recording:', err);
      throw err;
    }
  });
}

module.exports = { registerIpcHandlers };
