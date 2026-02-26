// Main application window factory

import { BrowserWindow } from 'electron';
import path from 'path';
import { fromRoot } from '../paths';

// Injected by the Forge Vite plugin at build time.
// In dev:  MAIN_WINDOW_VITE_DEV_SERVER_URL is the Vite dev-server URL.
// In prod: it is undefined; load the built HTML instead.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    resizable: true,
    title: 'Orb',
    icon: fromRoot('assets', 'icons', 'Document.ico'),
    backgroundColor: '#0f1214',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1214',
      symbolColor: '#888888',
      height: 32,
    },
    webPreferences: {
      // Both main.js and preload.js are compiled into the same .vite/build/ dir.
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  // Dev: Forge Vite plugin injects the dev-server URL.
  // Prod: load the renderer bundle built by the plugin.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}
