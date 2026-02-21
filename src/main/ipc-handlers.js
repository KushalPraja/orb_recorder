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
const { remuxToCleanMp4 } = require("./ffmpeg-utils");
const {
    IPC,
    DEFAULT_SETTINGS,
    RAW_RECORDING_FILE,
    EVENTS_FILE,
    OUTPUT_FILE,
    CLEAN_MP4_FILE,
    SETTINGS_FILE,
    META_FILE,
} = require("../shared/constants");

// ─── Helper Functions ────────────────────────────────────────────

function getSettingsPath() {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function loadSettings() {
    try {
        const filePath = getSettingsPath();
        if (fs.existsSync(filePath)) {
            const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));
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
let selectedCaptureSourceId = null;

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

    // Window is sized to the compact card.
    const W = 260;
    const H = 64;

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

    const anchor = settings.overlayPosition;
    const d = screen.getPrimaryDisplay().bounds;
    const pos = resolveOverlayPosition(anchor, d, W, H);
    recordingOverlay.setPosition(pos.x, pos.y, false);
}

/**
 * (Windows only) Retrieve the on-screen bounds of a native window handle.
 * Uses Python ctypes to call DwmGetWindowAttribute (DWMWA_EXTENDED_FRAME_BOUNDS = 9)
 * for the visible rect, falling back to GetWindowRect.
 * Returns { x, y, width, height } in physical screen-pixel space, or null on failure.
 */
function getWindowBoundsFromHwnd(hwndInt) {
    if (process.platform !== "win32") return null;
    try {
        const { execFileSync } = require("child_process");
        const pyScript = [
            "import ctypes, ctypes.wintypes as w",
            `h=w.HWND(${hwndInt})`,
            "r=w.RECT()",
            "hr=ctypes.windll.dwmapi.DwmGetWindowAttribute(h,9,ctypes.byref(r),ctypes.sizeof(r))",
            "hr==0 or ctypes.windll.user32.GetWindowRect(h,ctypes.byref(r))",
            "print(f'{r.left},{r.top},{r.right},{r.bottom}')",
        ].join(";");

        const output = execFileSync("python", ["-c", pyScript], {
            timeout: 3000,
            encoding: "utf-8",
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const parts = output.trim().split(",").map(Number);
        if (parts.length === 4 && parts.every(Number.isFinite)) {
            return {
                x: parts[0],
                y: parts[1],
                width: parts[2] - parts[0],
                height: parts[3] - parts[1],
            };
        }
        console.warn("[IPC] getWindowBoundsFromHwnd: unexpected output:", output.trim());
    } catch (err) {
        console.warn("[IPC] getWindowBoundsFromHwnd failed:", err.message);
    }
    return null;
}

/**
 * Register all IPC handlers.
 * @param {BrowserWindow} mainWindow  The main app window
 */
function registerIpcHandlers(mainWindow, setSelectedCaptureSource) {
    ipcMain.handle(IPC.SET_CAPTURE_SOURCE, async (_event, sourceId) => {
        selectedCaptureSourceId = sourceId ?? null;
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

        // ── Resolve capture-source origin for coordinate normalization ────────
        // uiohook reports events in global (logical / DIP) screen coordinates.
        // To map them onto the recorded video frame we need:
        //   originX/Y  – top-left of the recorded area in that same space
        //   scaleFactor – ratio  physical-pixels / logical-pixels  for the
        //                 recorded display (handles HiDPI / retina)
        let meta = {};
        if (selectedCaptureSourceId) {
            console.log(`[IPC] Capture source: ${selectedCaptureSourceId}`);
            try {
                const isScreen = selectedCaptureSourceId.startsWith("screen:");
                const allDisplays = screen.getAllDisplays();

                // Find the display that owns this capture source
                let display = null;
                if (isScreen) {
                    // For screen sources, match via desktopCapturer display_id
                    const allSources = await desktopCapturer.getSources({
                        types: ["screen"],
                        thumbnailSize: { width: 1, height: 1 },
                    });
                    const src = allSources.find((s) => s.id === selectedCaptureSourceId);
                    if (src) {
                        display = allDisplays.find(
                            (d) => String(d.id) === String(src.display_id),
                        );
                    }
                    // Fallback: if only one display, use it
                    if (!display && allDisplays.length === 1) {
                        display = allDisplays[0];
                    }
                    if (display) {
                        // uiohook reports physical screen coordinates on Windows.
                        // Electron's display.bounds is in DIP, so convert the
                        // origin to physical pixels to match the event space.
                        // The video is also captured at physical resolution, so
                        // scaleFactor=1.0 (no further conversion needed).
                        const sf = display.scaleFactor || 1;
                        meta = {
                            sourceType: "screen",
                            originX: Math.round(display.bounds.x * sf),
                            originY: Math.round(display.bounds.y * sf),
                            captureWidth: Math.round(display.bounds.width * sf),
                            captureHeight: Math.round(display.bounds.height * sf),
                            scaleFactor: 1.0,
                        };
                    }
                } else {
                    // ── Window source — get actual window rectangle ──────────
                    const cursorPt = screen.getCursorScreenPoint();
                    display = screen.getDisplayNearestPoint(cursorPt);
                    const sf = display?.scaleFactor || 1;

                    // Extract HWND from Electron source ID ("window:HWND:0")
                    const hwndMatch = selectedCaptureSourceId.match(/^window:(\d+):/);
                    console.log(
                        `[IPC] Window source HWND match: ${hwndMatch ? hwndMatch[1] : "none"}, sf=${sf}`,
                    );
                    if (hwndMatch) {
                        const winBounds = getWindowBoundsFromHwnd(
                            parseInt(hwndMatch[1], 10),
                        );
                        console.log(
                            `[IPC] Window bounds result: ${JSON.stringify(winBounds)}`,
                        );
                        if (winBounds && winBounds.width > 0 && winBounds.height > 0) {
                            // winBounds is in physical screen-pixels.
                            // uiohook reports coordinates in physical pixels
                            // on Windows, and the video frame is also in physical
                            // pixels.  So both the origin and the events are in
                            // the same coordinate space → scaleFactor = 1.0
                            // (no DIP→physical conversion needed).
                            meta = {
                                sourceType: "window",
                                originX: winBounds.x,
                                originY: winBounds.y,
                                captureWidth: winBounds.width,
                                captureHeight: winBounds.height,
                                scaleFactor: 1.0,
                            };
                            console.log(
                                `[IPC] Window origin: (${winBounds.x}, ${winBounds.y}), ` +
                                    `size: ${winBounds.width}x${winBounds.height}, sf=${sf}`,
                            );
                        }
                    }
                }

                // Fallback for any source type when bounds couldn't be resolved.
                if (!meta.sourceType) {
                    if (display) {
                        meta = {
                            sourceType: isScreen ? "screen" : "window",
                            originX: display.bounds.x,
                            originY: display.bounds.y,
                            captureWidth: display.bounds.width,
                            captureHeight: display.bounds.height,
                            scaleFactor: display.scaleFactor || 1,
                        };
                    } else {
                        meta = {
                            sourceType: isScreen ? "screen" : "window",
                            originX: 0,
                            originY: 0,
                            scaleFactor: 1,
                        };
                    }
                    console.warn("[IPC] Using display-based fallback for origin:", meta);
                }
            } catch (err) {
                console.warn(
                    "[IPC] Could not resolve capture source bounds:",
                    err.message,
                );
            }
        }

        // Write meta.json — may be enriched later (e.g., project name via RENAME_RECORDING)
        const metaPath = path.join(sessionDir, META_FILE);
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

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

    ipcMain.handle(IPC.STOP_RECORDING, async (_event, videoStartTime) => {
        if (!recordingSession) {
            throw new Error("No active recording session");
        }

        // Stop input tracking and get events
        const events = inputTracker.stop();

        // Align event timestamps with the video timeline.
        // inputTracker started at recordingSession.startTime, but the
        // MediaRecorder in the renderer started slightly later (IPC round-trip).
        // Shift every event backward by that delta so t=0 matches the first
        // video frame rather than the IPC call.
        if (videoStartTime && recordingSession.startTime) {
            const offsetSec = (videoStartTime - recordingSession.startTime) / 1000;
            if (offsetSec > 0) {
                for (const e of events) {
                    e.timestamp = Math.max(0, e.timestamp - offsetSec);
                }
                console.log(`[IPC] Event timestamps shifted by -${offsetSec.toFixed(3)}s to align with video`);
            }
        }

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

    ipcMain.on("recording:overlay-stop-clicked", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.OVERLAY_STOP_REQUEST);
        }
    });

    ipcMain.on("recording:overlay-pause-clicked", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.OVERLAY_PAUSE_REQUEST);
        }
    });

    ipcMain.on("recording:overlay-resume-clicked", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.OVERLAY_RESUME_REQUEST);
        }
    });

    ipcMain.on("recording:overlay-discard-clicked", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.OVERLAY_DISCARD_REQUEST);
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

    ipcMain.handle(IPC.REMUX_VIDEO, async (_event, sessionDir) => {
        const rawPath = path.join(sessionDir, RAW_RECORDING_FILE);
        const cleanPath = path.join(sessionDir, CLEAN_MP4_FILE);

        // Return cached file if already remuxed
        if (fs.existsSync(cleanPath)) {
            console.log(`[IPC] Reusing cached preview: ${cleanPath}`);
            return cleanPath;
        }

        if (!fs.existsSync(rawPath)) {
            throw new Error(`Recording not found: ${rawPath}`);
        }

        console.log(`[IPC] Remuxing for preview: ${rawPath} → ${cleanPath}`);
        await remuxToCleanMp4(rawPath, cleanPath, null, settings.fps);
        return cleanPath;
    });

    ipcMain.handle(IPC.PROCESS_VIDEO, async (_event, opts = {}) => {
        const sessionDir = opts.sessionDir ?? recordingSession?.sessionDir;
        if (!sessionDir) {
            throw new Error(
                "No session directory provided and no active recording session",
            );
        }

        // Resolve wallpaper filesystem path (checked in multiple locations for dev + packaged)
        let wallpaperPath = null;
        if (opts.wallpaperFile) {
            const { app } = require("electron");
            const base = app.getAppPath();
            // In packaged app base points inside app.asar — FFmpeg can't read asar paths.
            // The forge config unpacks Wallpapers to app.asar.unpacked so try that first.
            const baseUnpacked = base.replace(/app\.asar$/, "app.asar.unpacked");
            const candidates = [
                path.join(
                    baseUnpacked,
                    "dist",
                    "renderer",
                    "Wallpapers",
                    opts.wallpaperFile,
                ),
                path.join(baseUnpacked, "renderer", "Wallpapers", opts.wallpaperFile),
                path.join(
                    base,
                    "src",
                    "renderer",
                    "public",
                    "Wallpapers",
                    opts.wallpaperFile,
                ),
                path.join(
                    base,
                    ".vite",
                    "renderer",
                    "main_window",
                    "Wallpapers",
                    opts.wallpaperFile,
                ),
                path.join(base, "dist", "renderer", "Wallpapers", opts.wallpaperFile),
                path.join(base, "renderer", "Wallpapers", opts.wallpaperFile),
            ];
            wallpaperPath =
                candidates.find(
                    (p) =>
                        fs.existsSync(p) &&
                        !p.includes("app.asar\\") &&
                        !p.includes("app.asar/"),
                ) ||
                candidates.find((p) => fs.existsSync(p)) ||
                null;
            if (wallpaperPath) {
                console.log(`[IPC] Resolved wallpaper: ${wallpaperPath}`);
            } else {
                console.warn(`[IPC] Wallpaper not found: ${opts.wallpaperFile}`);
            }
        }

        try {
            const outputPath = await processVideo({
                recordingDir: sessionDir,
                outputPath: opts.exportPath || undefined,
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
                wallpaperPath,
                imageBlur: opts.imageBlur ?? "none",

                // Trim — optional time range
                trimStart: opts.trimStart,
                trimEnd: opts.trimEnd,

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
                types: ["screen", "window"],
                thumbnailSize: { width: 320, height: 200 },
            });

            const allDisplays = screen.getAllDisplays();

            return sources
                .filter((src) => {
                    // Filter out our own app window to avoid confusion
                    const name = src.name || "";
                    return !name.startsWith("Orb");
                })
                .map((src) => {
                    const isScreen = src.id.startsWith("screen:");
                    // Resolve the display that contains this source so we can store
                    // its origin (top-left) for coordinate normalization in process.py
                    const display = allDisplays.find(
                        (d) => String(d.id) === String(src.display_id),
                    );
                    const displayBounds = display ? { ...display.bounds } : null;

                    return {
                        id: src.id,
                        name: src.name,
                        thumbnail: src.thumbnail.toDataURL(),
                        /** "screen" for full displays, "window" for individual app windows */
                        type: isScreen ? "screen" : "window",
                        displayBounds,
                    };
                });
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

                // Read project name from meta.json if available
                let projectName = entry.name;
                const metaPath = path.join(sessionDir, META_FILE);
                try {
                    if (fs.existsSync(metaPath)) {
                        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                        if (meta.name) projectName = meta.name;
                    }
                } catch {
                    /* ignore corrupt meta */
                }

                recordings.push({
                    sessionDir,
                    name: projectName,
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

    // ─── Rename Recording ─────────────────────────────────────────────

    ipcMain.handle(IPC.RENAME_RECORDING, async (_event, sessionDir, newName) => {
        try {
            if (!sessionDir || !newName)
                throw new Error("Missing sessionDir or name");
            const metaPath = path.join(sessionDir, META_FILE);
            let meta = {};
            try {
                if (fs.existsSync(metaPath)) {
                    meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                }
            } catch {
            }
            meta.name = newName.trim();
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
            console.log(`[IPC] Renamed recording: ${sessionDir} → "${meta.name}"`);
            return meta.name;
        } catch (err) {
            console.error("[IPC] Failed to rename recording:", err);
            throw err;
        }
    });

    // ─── Export Path Dialog ───────────────────────────────────────────

    ipcMain.handle(IPC.PICK_EXPORT_PATH, async (_event, defaultName) => {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: "Export Recording",
            defaultPath: path.join(
                settings.outputDir,
                (defaultName || "recording") + ".mp4",
            ),
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
        });

        if (!result.canceled && result.filePath) {
            return result.filePath;
        }
        return null;
    });
}

module.exports = { registerIpcHandlers };
