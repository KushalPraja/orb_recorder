// Main application window factory

import { BrowserWindow } from 'electron';
import path from 'path';
import { is } from '@electron-toolkit/utils';
import { fromRoot } from '../paths';

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
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, '../../dist/index.html'),
    );
  }

  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}
