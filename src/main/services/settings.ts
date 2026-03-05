// Settings service — load/save app settings from disk.

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { DEFAULT_SETTINGS, SETTINGS_FILE } from '../../shared/constants';
import type { AppSettings } from '../../shared/types';

let settings: AppSettings = loadSettings();

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function loadSettings(): AppSettings {
  try {
    const filePath = getSettingsPath();
    if (fs.existsSync(filePath)) {
      const persisted = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { ...DEFAULT_SETTINGS, ...persisted };
    }
  } catch (err) {
    console.error('[Settings] Failed to load settings:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettingsToDisk(s: AppSettings): void {
  try {
    const filePath = getSettingsPath();
    fs.writeFileSync(filePath, JSON.stringify(s, null, 2));
  } catch (err) {
    console.error('[Settings] Failed to save settings:', err);
  }
}

/** Get current settings (copy). */
export function getSettings(): AppSettings {
  return { ...settings };
}

/** Merge new values into settings and persist. */
export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  settings = { ...settings, ...partial };
  saveSettingsToDisk(settings);
  console.log('[Settings] Updated:', settings);
  return { ...settings };
}

/** Ensure the settings file exists on disk and return its path. */
export function ensureSettingsFile(): string {
  const filePath = getSettingsPath();
  if (!fs.existsSync(filePath)) {
    saveSettingsToDisk(settings);
  }
  return filePath;
}
