import path from 'path';
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { is } from '@electron-toolkit/utils';
import { IPC } from '../../shared/constants';
import type { ExportProgress, RendererExportRequest } from '../../shared/types';

function createExportHostWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    frame: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.setBackgroundThrottling(false);

  return win;
}

async function loadExportHostWindow(win: BrowserWindow): Promise<void> {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set('mode', 'export-host');
    await win.loadURL(url.toString());
  } else {
    await win.loadFile(path.join(__dirname, '../../dist/index.html'), {
      query: { mode: 'export-host' },
    });
  }
}

function isJobMessage(
  event: IpcMainEvent,
  win: BrowserWindow,
  jobId: string,
  payload: { jobId?: string } | undefined,
): boolean {
  return event.sender === win.webContents && payload?.jobId === jobId;
}

export async function runRendererExport(
  request: RendererExportRequest,
  onProgress?: (progress: ExportProgress) => void,
): Promise<string> {
  const win = createExportHostWindow();

  return await new Promise<string>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      ipcMain.removeListener(IPC.EXPORT_HOST_READY, handleReady);
      ipcMain.removeListener(IPC.EXPORT_HOST_PROGRESS, handleProgress);
      ipcMain.removeListener(IPC.EXPORT_HOST_DONE, handleDone);
      ipcMain.removeListener(IPC.EXPORT_HOST_ERROR, handleError);
      win.removeListener('closed', handleClosed);
      win.webContents.removeListener('render-process-gone', handleGone);

      if (!win.isDestroyed()) {
        win.destroy();
      }
    };

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const handleReady = (event: IpcMainEvent): void => {
      if (event.sender !== win.webContents) return;
      win.webContents.send(IPC.EXPORT_HOST_START, request);
    };

    const handleProgress = (
      event: IpcMainEvent,
      payload: { jobId: string; progress: ExportProgress },
    ): void => {
      if (!isJobMessage(event, win, request.jobId, payload)) return;
      onProgress?.(payload.progress);
    };

    const handleDone = (
      event: IpcMainEvent,
      payload: { jobId: string; outputPath: string },
    ): void => {
      if (!isJobMessage(event, win, request.jobId, payload)) return;
      settle(() => resolve(payload.outputPath));
    };

    const handleError = (
      event: IpcMainEvent,
      payload: { jobId: string; error: string },
    ): void => {
      if (!isJobMessage(event, win, request.jobId, payload)) return;
      settle(() => reject(new Error(payload.error)));
    };

    const handleClosed = (): void => {
      settle(() => reject(new Error('Export host window closed before export completed.')));
    };

    const handleGone = (): void => {
      settle(() => reject(new Error('Export host renderer process exited unexpectedly.')));
    };

    ipcMain.on(IPC.EXPORT_HOST_READY, handleReady);
    ipcMain.on(IPC.EXPORT_HOST_PROGRESS, handleProgress);
    ipcMain.on(IPC.EXPORT_HOST_DONE, handleDone);
    ipcMain.on(IPC.EXPORT_HOST_ERROR, handleError);
    win.on('closed', handleClosed);
    win.webContents.on('render-process-gone', handleGone);

    void loadExportHostWindow(win).catch((error) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      settle(() => reject(normalizedError));
    });
  });
}
