// Settings handlers

import { IpcMainInvokeEvent } from 'electron';
import { getSettings, updateSettings } from '../services/settings';
import type { AppSettings } from '../../shared/types';

export async function handleGetSettings(): Promise<AppSettings> {
  console.log('[IPC] Settings requested:', getSettings());
  return getSettings();
}

export async function handleSetSettings(
  _event: IpcMainInvokeEvent,
  newSettings: Partial<AppSettings>,
): Promise<AppSettings> {
  return updateSettings(newSettings);
}
