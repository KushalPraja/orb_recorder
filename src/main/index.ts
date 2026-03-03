// Main process entry — creates the BrowserWindow, sets up screen capture,
// registers IPC handlers, and manages the app lifecycle.

import { app, BrowserWindow, session, desktopCapturer } from 'electron';

import { createMainWindow, getMainWindow } from './windows/main-window';
import { registerIpcHandlers } from './ipc';
import { setSelectedCaptureSource } from './handlers/recording';
import { inputTracker } from './services/input-tracker';

let selectedCaptureSourceId: string | null = null;

function createWindow(): void {
  const mainWindow = createMainWindow();

  // ─── Desktop Capture Permission ─────────────────────────────────
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
          const selected = selectedCaptureSourceId
            ? sources.find((source) => source.id === selectedCaptureSourceId)
            : null;
          const chosenSource = selected || sources[0];
          console.log(`[Main] Granting access to: "${chosenSource.name}" (${chosenSource.id})`);
          callback({ video: chosenSource });
        } else {
          console.error('[Main] No screen sources found');
          callback({});
        }
      } catch (err) {
        console.error('[Main] Failed to get desktop sources:', err);
        callback({});
      }
    },
  );

  // Register IPC handlers
  registerIpcHandlers();

  // Link capture source selection from handler back to display media handler
  const originalSetCaptureSource = setSelectedCaptureSource;
  // Override to also update local state for the display media handler
  const wrappedSetCaptureSource = (sourceId: string | null) => {
    selectedCaptureSourceId = sourceId;
    originalSetCaptureSource(sourceId);
  };

  // Patch the recording handler's set function to also update our local ref
  // (The handler already calls this, but we also need it for the display media callback)
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
    if (inputTracker.recording) {
      inputTracker.stop();
    }
  } catch {
    /* already stopped */
  }
});
