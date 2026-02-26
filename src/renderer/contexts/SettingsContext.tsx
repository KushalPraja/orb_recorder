/**
 * SettingsContext — single source of truth for user settings in the renderer.
 *
 * Settings are loaded once on mount via IPC and kept in sync with the
 * main-process settings.json through updateSetting / pickOutputDir.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AppSettings } from '../../shared/types';

// ─── Context type ────────────────────────────────────────────────────────────

interface SettingsContextValue {
  settings: AppSettings | null;
  isLoading: boolean;
  updateSetting: (key: keyof AppSettings, value: any) => Promise<void>;
  pickOutputDir: () => Promise<string | null>;
  openSettingsFile: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const loaded = await window.electronAPI.getSettings();
        setSettings(loaded);
      } catch (err) {
        console.error('[SettingsContext] Failed to load settings:', err);
        setSettings({} as AppSettings);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const updateSetting = useCallback(
    async (key: keyof AppSettings, value: any) => {
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
      try {
        await window.electronAPI.setSettings({ [key]: value });
      } catch (err) {
        console.error('[SettingsContext] Failed to persist setting:', key, err);
      }
    },
    [],
  );

  const pickOutputDir = useCallback(async () => {
    try {
      const dir = await window.electronAPI.pickOutputDir();
      if (dir) {
        setSettings((prev) => (prev ? { ...prev, outputDir: dir } : prev));
      }
      return dir ?? null;
    } catch (err) {
      console.error('[SettingsContext] Failed to pick output directory:', err);
      return null;
    }
  }, []);

  const openSettingsFile = useCallback(async () => {
    try {
      await window.electronAPI.openSettings();
    } catch (err) {
      console.error('[SettingsContext] Failed to open settings file:', err);
    }
  }, []);

  return (
    <SettingsContext.Provider
      value={{ settings, isLoading, updateSetting, pickOutputDir, openSettingsFile }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a <SettingsProvider>');
  }
  return context;
}
