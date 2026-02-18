import React, { useState, useEffect } from "react";
import { FolderOpen } from "lucide-react";
import "./SettingsPage.css";

const api = window.electronAPI;

export function SettingsPage({ onNavigate }) {
  const [settings, setSettings] = useState({
    fps: 30,
    zoomFactor: 2.0,
    zoomDuration: 1.5,
    outputDir: "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getSettings();
        setSettings(s);
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    })();
  }, []);

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    api.setSettings({ [key]: value });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const pickDir = async () => {
    const dir = await api.pickOutputDir();
    if (dir) {
      setSettings((prev) => ({ ...prev, outputDir: dir }));
    }
  };

  const shortenPath = (p) => {
    if (!p) return "—";
    const parts = p.split(/[/\\]/);
    if (parts.length > 3) return `.../${parts.slice(-2).join("/")}`;
    return p;
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
        {saved && <span className="save-indicator">Saved</span>}
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
              onChange={(e) => update("fps", parseInt(e.target.value, 10))}
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
            <button className="setting-btn" onClick={pickDir}>
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
              onChange={(e) => update("zoomFactor", parseFloat(e.target.value))}
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
                update("zoomDuration", parseFloat(e.target.value))
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
        </div>
      </div>
    </div>
  );
}
