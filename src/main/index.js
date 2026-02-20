// Main process entry — creates the BrowserWindow, sets up screen capture,
// registers IPC handlers, and manages the app lifecycle.

const { app, BrowserWindow, session, desktopCapturer } = require("electron");

if (require("electron-squirrel-startup")) {
  app.quit();
}
const path = require("path");
const fs = require("fs");
const { registerIpcHandlers } = require("./ipc-handlers");

let mainWindow = null;
let selectedCaptureSourceId = null;

function setSelectedCaptureSource(sourceId) {
  selectedCaptureSourceId = sourceId || null;
}

const isDev = process.argv.includes("--dev");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    resizable: true,
    title: "Orb",
    icon: path.join(__dirname, "..", "..", "assets", "icons", "Document.ico"),
    backgroundColor: "#0f1214",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0f1214",
      symbolColor: "#888888",
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, "..", "main", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // allow loading file:// URLs for video preview
    },
  });

  // Load the renderer — use Vite dev server in dev, built files in prod
  const distIndex = path.join(
    __dirname,
    "..",
    "..",
    "dist",
    "renderer",
    "index.html",
  );
  const srcIndex = path.join(__dirname, "..", "renderer", "index.html");

  if (isDev) {
    // In dev mode, try Vite dev server first, fallback to src file
    mainWindow.loadURL("http://localhost:5173").catch(() => {
      mainWindow.loadFile(srcIndex);
    });
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex);
  } else {
    mainWindow.loadFile(srcIndex);
  }

  // Remove menu bar for cleaner look
  mainWindow.setMenuBarVisibility(false);

  // ─── Desktop Capture Permission ─────────────────────────────────
  // Grant screen capture access automatically.
  // Electron 31+ changed the callback: it expects { video, audio }.
  // We also need to handle the case where desktopCapturer returns
  // no sources gracefully.

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      console.log("[Main] Display media requested");
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 150, height: 150 },
        });
        console.log(`[Main] Found ${sources.length} screen source(s)`);

        if (sources.length > 0) {
          const selected = selectedCaptureSourceId
            ? sources.find((source) => source.id === selectedCaptureSourceId)
            : null;
          const chosenSource = selected || sources[0];
          console.log(
            `[Main] Granting access to: "${chosenSource.name}" (${chosenSource.id})`,
          );
          callback({ video: chosenSource });
        } else {
          console.error("[Main] No screen sources found");
          callback({});
        }
      } catch (err) {
        console.error("[Main] Failed to get desktop sources:", err);
        callback({});
      }
    },
  );

  // Register IPC handlers
  registerIpcHandlers(mainWindow, setSelectedCaptureSource);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

// Ensure uiohook is cleaned up on quit
app.on("will-quit", () => {
  try {
    const inputTracker = require("./input-tracker");
    if (inputTracker.recording) {
      inputTracker.stop();
    }
  } catch {
    /* already stopped */
  }
});
