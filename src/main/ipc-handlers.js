// IPC Handlers — bridge between renderer UI and backend modules.
// Registered in the main process.

const { ipcMain, dialog, shell, BrowserWindow, screen } = require('electron');
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
} = require('../shared/constants');

// In-memory settings (persists for the session)
let settings = {
  fps: DEFAULT_FPS,
  zoomFactor: DEFAULT_ZOOM_FACTOR,
  zoomDuration: DEFAULT_ZOOM_DURATION,
  outputDir: DEFAULT_OUTPUT_DIR,
};

// Current recording session state
let recordingSession = null;

function findLatestSessionDir(baseDir) {
  if (!fs.existsSync(baseDir)) return null;

  const candidates = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sessionDir = path.join(baseDir, entry.name);
      const recordingPath = path.join(sessionDir, RAW_RECORDING_FILE);
      if (!fs.existsSync(recordingPath)) return null;

      const stat = fs.statSync(sessionDir);
      return { sessionDir, mtimeMs: stat.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates.length ? candidates[0].sessionDir : null;
}

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
        body{margin:0;background:rgba(0,0,0,0.12);display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden;font-family:Segoe UI,Arial,sans-serif}
        .circle{width:190px;height:190px;border-radius:999px;background:rgba(14,14,32,0.88);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.16);box-shadow:0 12px 40px rgba(0,0,0,0.35)}
        .n{font-size:94px;font-weight:700;color:#fff;line-height:1}
      </style>
    </head>
    <body>
      <div class="circle"><div id="n" class="n">${seconds}</div></div>
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

/**
 * Register all IPC handlers.
 * @param {BrowserWindow} mainWindow  The main app window
 */
function registerIpcHandlers(mainWindow) {
  // ─── Recording Control ────────────────────────────────────────────

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

  ipcMain.handle(IPC.REPROCESS_LAST_SESSION, async () => {
    const sessionDir = findLatestSessionDir(settings.outputDir);
    if (!sessionDir) {
      throw new Error(`No previous sessions found in ${settings.outputDir}`);
    }

    try {
      const outputPath = await processVideo({
        recordingDir: sessionDir,
        zoomFactor: settings.zoomFactor,
        zoomDuration: settings.zoomDuration,
        onProgress: (progress) => {
          mainWindow.webContents.send(IPC.PROCESSING_PROGRESS, progress);
        },
      });

      mainWindow.webContents.send(IPC.PROCESSING_DONE, { outputPath });
      return { outputPath, sessionDir };
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
}

module.exports = { registerIpcHandlers };
