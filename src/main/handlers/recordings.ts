// Recordings library handlers — list, delete, rename

import { IpcMainInvokeEvent } from 'electron';
import * as sessionManager from '../services/session-manager';
import { getSettings } from '../services/settings';
import type { RecordingInfo } from '../../shared/types';

export async function handleGetRecordings(): Promise<RecordingInfo[]> {
  const settings = getSettings();
  return sessionManager.listRecordings(settings.outputDir);
}

export async function handleDeleteRecording(
  _event: IpcMainInvokeEvent,
  sessionDir: string,
): Promise<boolean> {
  sessionManager.deleteSession(sessionDir);
  return true;
}

export async function handleRenameRecording(
  _event: IpcMainInvokeEvent,
  sessionDir: string,
  newName: string,
): Promise<string> {
  return sessionManager.renameSession(sessionDir, newName);
}
