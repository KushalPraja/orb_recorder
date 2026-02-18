import React, { useState } from "react";
import { FolderOpen } from "lucide-react";
import { useSettings } from "../contexts/SettingsContext";
import "./SettingsPage.css";

export function SettingsPage({ onNavigate }) {
  const { settings, isLoading, updateSetting, pickOutputDir, openSettingsFile } = useSettings();
  const [savedKey, setSavedKey] = useState(null);

  if (isLoading || !settings) {
    return (
      <div className="settings-page">
        <div className="settings-header">
          <h2>Settings</h2>
        </div>
        <div className="settings-list" />
      </div>
    );
  }

  const handleUpdate = (key, value) => {
    updateSetting(key, value);
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 1500);
  };

  const handlePickDir = async () => {
    await pickOutputDir();
    setSavedKey("outputDir");
    setTimeout(() => setSavedKey(null), 1500);
  };

  const shortenPath = (p) => {
    if (!p) return "—";
    const parts = p.split(/[/\\]/);
    return parts.length > 3 ? `.../${parts.slice(-2).join("/")}` : p;
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
        {savedKey && <span className="save-indicator">Saved</span>}
      </div>

      <div className="settings-list">
        {/* Recording section */}
        <div className="settings-section">
          <div className="section-label">Recording</div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Frame Rate</span>
            </div>
            <select
              className="setting-select"
              value={settings.fps}
              onChange={(e) =>
                handleUpdate("fps", parseInt(e.target.value, 10))
              }
            >
              <option value={15}>15 fps</option>
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Output Folder</span>
              <span className="setting-hint" title={settings.outputDir}>
                {shortenPath(settings.outputDir)}
              </span>
            </div>
            <button className="setting-btn" onClick={handlePickDir}>
              <FolderOpen size={13} />
              <span>Change</span>
            </button>
          </div>
        </div>

        {/* Post-processing section */}
        <div className="settings-section">
          <div className="section-label">Post-Processing</div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Zoom Level</span>
              <span className="setting-value">
                {settings.zoomFactor.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              className="setting-range"
              min="1.5"
              max="3"
              step="0.1"
              value={settings.zoomFactor}
              onChange={(e) =>
                handleUpdate("zoomFactor", parseFloat(e.target.value))
              }
            />
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Hold Duration</span>
              <span className="setting-value">
                {settings.zoomDuration.toFixed(1)}s
              </span>
            </div>
            <input
              type="range"
              className="setting-range"
              min="0.5"
              max="3"
              step="0.1"
              value={settings.zoomDuration}
              onChange={(e) =>
                handleUpdate("zoomDuration", parseFloat(e.target.value))
              }
            />
          </div>
        </div>

        {/* About section */}
        <div className="settings-section">
          <div className="section-label">About</div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Version</span>
            </div>
            <span className="setting-value-static">1.0.0</span>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span>Settings file</span>
              <span className="setting-hint">settings.json</span>
            </div>
            <button className="setting-btn" onClick={openSettingsFile}>
              <FolderOpen size={13} />
              <span>Edit</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
