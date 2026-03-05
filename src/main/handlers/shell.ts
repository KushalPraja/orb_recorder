// Shell handlers — open files/folders in the OS

import { IpcMainInvokeEvent, shell } from 'electron';
import fs from 'fs';
import { ensureSettingsFile } from '../services/settings';
import { getRecordingSession } from './recording';

export async function handleOpenOutput(
  _event: IpcMainInvokeEvent,
  filePath?: string,
): Promise<void> {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  } else {
    const session = getRecordingSession();
    if (session) shell.openPath(session.sessionDir);
  }
}

export async function handleOpenSettings(): Promise<boolean> {
  try {
    const filePath = ensureSettingsFile();
    if (fs.existsSync(filePath)) {
      await shell.openPath(filePath);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[Shell] Failed to open settings file:', err);
    throw err;
  }
}
