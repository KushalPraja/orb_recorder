// Main process entry — creates the BrowserWindow, sets up screen capture,
// registers IPC handlers, and manages the app lifecycle.

const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    minWidth: 400,
    minHeight: 500,
    resizable: true,
    title: 'Screen Recorder',
    backgroundColor: '#0b0b1a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0b1a',
      symbolColor: '#ffffff',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Remove menu bar for cleaner look
  mainWindow.setMenuBarVisibility(false);

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // ─── Desktop Capture Permission ─────────────────────────────────
  // Grant screen capture access automatically.
  // Electron 31+ changed the callback: it expects { video, audio }.
  // We also need to handle the case where desktopCapturer returns
  // no sources gracefully.

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      console.log('[Main] Display media requested');
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 150, height: 150 },
        });
        console.log(`[Main] Found ${sources.length} screen source(s)`);

        if (sources.length > 0) {
          console.log(`[Main] Granting access to: "${sources[0].name}" (${sources[0].id})`);
          callback({ video: sources[0] });
        } else {
          console.error('[Main] No screen sources found');
          callback({});
        }
      } catch (err) {
        console.error('[Main] Failed to get desktop sources:', err);
        callback({});
      }
    }
  );

  // Register IPC handlers
  registerIpcHandlers(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// Ensure uiohook is cleaned up on quit
app.on('will-quit', () => {
  try {
    const inputTracker = require('./input-tracker');
    if (inputTracker.recording) {
      inputTracker.stop();
    }
  } catch { /* already stopped */ }
});
