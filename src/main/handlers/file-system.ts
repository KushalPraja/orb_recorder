// File system & dialog handlers

import { IpcMainInvokeEvent, dialog } from 'electron';
import path from 'path';
import { getMainWindow } from '../windows/main-window';
import { getSettings, updateSettings } from '../services/settings';

export async function handlePickOutputDir(): Promise<string | null> {
  const mainWindow = getMainWindow();
  if (!mainWindow) return null;

  const settings = getSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Output Directory',
    defaultPath: settings.outputDir,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    updateSettings({ outputDir: result.filePaths[0] });
    return result.filePaths[0];
  }
  return null;
}

export async function handlePickExportPath(
  _event: IpcMainInvokeEvent,
  defaultName?: string,
): Promise<string | null> {
  const mainWindow = getMainWindow();
  if (!mainWindow) return null;

  const settings = getSettings();
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Recording',
    defaultPath: path.join(settings.outputDir, (defaultName || 'recording') + '.mp4'),
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });

  if (!result.canceled && result.filePath) return result.filePath;
  return null;
}
