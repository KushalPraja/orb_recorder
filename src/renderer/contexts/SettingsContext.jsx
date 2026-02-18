/**
 * SettingsContext — the single source of truth for user settings inside the
 * renderer process.
 *
 * Settings are loaded once on mount via the IPC bridge and then kept in sync
 * with the main-process settings.json through `updateSetting` / `pickOutputDir`.
 * No component should call `window.electronAPI.getSettings()` directly.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const SettingsContext = createContext(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null); // null while loading
  const [isLoading, setIsLoading] = useState(true);

  // Load settings from main process once on mount.
  useEffect(() => {
    (async () => {
      try {
        const loaded = await window.electronAPI.getSettings();
        setSettings(loaded);
      } catch (err) {
        console.error("[SettingsContext] Failed to load settings:", err);
        setSettings({});
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  /**
   * Update a single setting key.  Optimistically updates local state then
   * persists via IPC so UI stays snappy.
   *
   * @param {string} key   - The settings key to update (e.g. "fps")
   * @param {*}      value - The new value
   */
  const updateSetting = useCallback(async (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    try {
      await window.electronAPI.setSettings({ [key]: value });
    } catch (err) {
      console.error("[SettingsContext] Failed to persist setting:", key, err);
    }
  }, []);

  /**
   * Open the OS folder picker and update `outputDir` if the user confirms.
   * @returns {Promise<string|null>} The chosen directory path, or null if cancelled.
   */
  const pickOutputDir = useCallback(async () => {
    try {
      const dir = await window.electronAPI.pickOutputDir();
      if (dir) {
        setSettings((prev) => ({ ...prev, outputDir: dir }));
      }
      return dir ?? null;
    } catch (err) {
      console.error("[SettingsContext] Failed to pick output directory:", err);
      return null;
    }
  }, []);

  const openSettingsFile = useCallback(async () => {
    try {
      await window.electronAPI.openSettings();
    } catch (err) {
      console.error("[SettingsContext] Failed to open settings file:", err);
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

/**
 * Access the settings store from any component inside SettingsProvider.
 *
 * @returns {{ settings: object, isLoading: boolean, updateSetting: Function, pickOutputDir: Function }}
 */
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a <SettingsProvider>");
  }
  return context;
}
