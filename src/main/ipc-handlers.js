// IPC Handlers — bridge between renderer UI and backend modules.
// Registered in the main process.

const {
  ipcMain,
  dialog,
  shell,
  BrowserWindow,
  screen,
  desktopCapturer,
} = require("electron");
const fs = require("fs");
const path = require("path");
const inputTracker = require("./input-tracker");
const { processVideo } = require("./post-processor");
const {
  IPC,
  DEFAULT_SETTINGS,
  RAW_RECORDING_FILE,
  EVENTS_FILE,
  OUTPUT_FILE,
  SETTINGS_FILE,
} = require("../shared/constants");

// ─── Persistent Settings ────────────────────────────────────────────

function getSettingsPath() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function loadSettings() {
  try {
    const filePath = getSettingsPath();
    if (fs.existsSync(filePath)) {
      const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      // Merge persisted values on top of defaults so new keys always have a value.
      return { ...DEFAULT_SETTINGS, ...persisted };
    }
  } catch (err) {
    console.error("[Settings] Failed to load settings:", err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    const filePath = getSettingsPath();
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("[Settings] Failed to save settings:", err);
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

    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true);
    overlay.setContentProtection(true);

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:rgba(0,0,0,0.52);
    display:flex;align-items:center;justify-content:center;
    height:100vh;overflow:hidden;
    font-family:'JetBrains Mono','Fira Code','Cascadia Code','Courier New',monospace;
  }
  .box{
    width:136px;height:136px;
    background:rgba(9,9,11,0.95);
    border:1px solid rgba(255,255,255,0.08);
    border-radius:16px;
    display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:6px;
    box-shadow:0 24px 64px rgba(0,0,0,0.7),inset 0 1px 0 rgba(255,255,255,0.04);
    animation:ei .15s ease;
  }
  @keyframes ei{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}
  .n{
    font-size:66px;font-weight:700;line-height:1;
    color:#fff;letter-spacing:-3px;
    animation:pop .4s cubic-bezier(.22,1,.36,1);
  }
  @keyframes pop{from{transform:scale(1.22);opacity:.5}to{transform:scale(1);opacity:1}}
  .sub{
    font-size:9px;font-weight:400;
    color:rgba(255,255,255,0.25);
    letter-spacing:.2em;text-transform:uppercase;
  }
</style>
</head><body>
  <div class="box">
    <div class="n" id="n">${seconds}</div>
    <div class="sub">starting</div>
  </div>
  <script>
    let r=${seconds};
    const el=document.getElementById('n');
    const iv=setInterval(()=>{
      r-=1;
      if(r<=0){clearInterval(iv);window.close();return;}
      el.style.animation='none';
      void el.offsetHeight;
      el.style.animation='pop .4s cubic-bezier(.22,1,.36,1)';
      el.textContent=String(r);
    },1000);
  </script>
</body></html>`;

    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    overlay.on("closed", () => resolve());
  });
}

function closeRecordingOverlay() {
  if (recordingOverlay && !recordingOverlay.isDestroyed()) {
    recordingOverlay.close();
  }
  recordingOverlay = null;
}

/**
 * Convert an anchor name ("bottom-center", "top-right", …) into absolute
 * screen coordinates for the overlay window.
 */
function resolveOverlayPosition(anchor, dBounds, W, H) {
  const { x: dx, y: dy, width: dw, height: dh } = dBounds;
  const MARGIN = 28;
  const cx = Math.round(dx + (dw - W) / 2);
  const positions = {
    "bottom-center": { x: cx, y: dy + dh - H - MARGIN },
    "bottom-left": { x: dx + MARGIN, y: dy + dh - H - MARGIN },
    "bottom-right": { x: dx + dw - W - MARGIN, y: dy + dh - H - MARGIN },
    "top-center": { x: cx, y: dy + MARGIN },
    "top-left": { x: dx + MARGIN, y: dy + MARGIN },
    "top-right": { x: dx + dw - W - MARGIN, y: dy + MARGIN },
  };
  return positions[anchor] || positions["bottom-center"];
}

function showRecordingOverlay(_mainWindow) {
  closeRecordingOverlay();

  // Window is sized to the expanded pill; collapsed / hover state is pure CSS.
  const W = 240;
  const H = 44;

  recordingOverlay = new BrowserWindow({
    width: W,
    height: H,
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

  // Exclude the overlay from OS screen recordings (Windows / macOS).
  recordingOverlay.setContentProtection(true);
  recordingOverlay.setAlwaysOnTop(true, "screen-saver");
  recordingOverlay.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  // Pill is always visible — no ignore-mouse tricks needed.
  recordingOverlay.setIgnoreMouseEvents(false);

  // Load the overlay from its own HTML file — keeps ipc-handlers clean.
  recordingOverlay.loadFile(path.join(__dirname, "recording-overlay.html"));
  recordingOverlay.on("closed", () => {
    recordingOverlay = null;
  });

  const anchor = (settings && settings.overlayPosition) || "bottom-center";
  const d = screen.getPrimaryDisplay().bounds;
  const pos = resolveOverlayPosition(anchor, d, W, H);
  recordingOverlay.setPosition(pos.x, pos.y, false);
}

/**
 * Register all IPC handlers.
 * @param {BrowserWindow} mainWindow  The main app window
 */
function registerIpcHandlers(mainWindow, setSelectedCaptureSource) {
  // ─── Recording Control ────────────────────────────────────────────

  ipcMain.handle(IPC.SET_CAPTURE_SOURCE, async (_event, sourceId) => {
    if (typeof setSelectedCaptureSource === "function") {
      setSelectedCaptureSource(sourceId);
    }
    return true;
  });

  ipcMain.handle(IPC.START_RECORDING, async () => {
    const timestamp = Date.now();

    // Create a session directory for this recording
    const sessionId = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
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
      throw new Error("No active recording session");
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

  ipcMain.removeAllListeners("recording:overlay-stop-clicked");
  ipcMain.on("recording:overlay-stop-clicked", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.OVERLAY_STOP_REQUEST);
    }
  });

  // ─── Save Recording Blob ──────────────────────────────────────────

  ipcMain.handle(IPC.SAVE_RECORDING, async (_event, buffer) => {
    if (!recordingSession) {
      throw new Error("No active recording session");
    }

    const filePath = path.join(recordingSession.sessionDir, RAW_RECORDING_FILE);
    fs.writeFileSync(filePath, Buffer.from(buffer));

    console.log(
      `[IPC] Recording saved: ${filePath} (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`,
    );
    return filePath;
  });

  // ─── Post-Processing ──────────────────────────────────────────────

  ipcMain.handle(IPC.PROCESS_VIDEO, async (_event, opts = {}) => {
    const sessionDir =
      opts.sessionDir || (recordingSession && recordingSession.sessionDir);
    if (!sessionDir) {
      throw new Error("No recording session to process");
    }

    try {
      const outputPath = await processVideo({
        recordingDir: sessionDir,
        fps: settings.fps,

        // Auto-zoom — only when the caller explicitly enables it
        autoZoom: !!opts.autoZoom,
        zoomFactor: settings.zoomFactor,
        zoomDuration: settings.zoomDuration,

        // Visual polish — background + rounded corners
        background: !!opts.background,
        cornerRadius: opts.cornerRadius ?? 12,
        padding: opts.padding ?? 48,
        backgroundType: opts.backgroundType ?? "solid",
        backgroundColor: opts.backgroundColor ?? "#6366f1",
        gradientStart: opts.gradientStart ?? "#667eea",
        gradientEnd: opts.gradientEnd ?? "#764ba2",

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
    console.log("[IPC] Settings requested:", settings);
    return { ...settings };
  });

  ipcMain.handle(IPC.SET_SETTINGS, async (_event, newSettings) => {
    settings = { ...settings, ...newSettings };
    saveSettings(settings);
    console.log("[IPC] Settings updated:", settings);
    return settings;
  });

  // ─── Dialogs & Shell ──────────────────────────────────────────────

  ipcMain.handle(IPC.PICK_OUTPUT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Output Directory",
      defaultPath: settings.outputDir,
      properties: ["openDirectory", "createDirectory"],
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

  // Open the app settings.json in the user's editor (create file if missing)
  ipcMain.handle(IPC.OPEN_SETTINGS, async () => {
    try {
      const filePath = getSettingsPath();
      // Ensure a settings file exists so the editor has something to open
      if (!fs.existsSync(filePath)) {
        saveSettings(settings);
      }
      if (fs.existsSync(filePath)) {
        await shell.openPath(filePath);
        return true;
      }
      return false;
    } catch (err) {
      console.error("[IPC] Failed to open settings file:", err);
      throw err;
    }
  });

  // ─── Screen Sources ──────────────────────────────────────────────

  ipcMain.handle(IPC.GET_SOURCES, async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 320, height: 200 },
      });

      return sources.map((src) => ({
        id: src.id,
        name: src.name,
        thumbnail: src.thumbnail.toDataURL(),
      }));
    } catch (err) {
      console.error("[IPC] Failed to get sources:", err);
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
      console.error("[IPC] Failed to list recordings:", err);
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
      console.error("[IPC] Failed to delete recording:", err);
      throw err;
    }
  });
}

module.exports = { registerIpcHandlers };
