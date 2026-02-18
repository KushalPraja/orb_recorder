import React, { useState, useRef, useEffect } from "react";
import {
  Download,
  Check,
  Loader2,
  Trash2,
  Film,
  Layers,
} from "lucide-react";
import "./ReviewPage.css";

const api = window.electronAPI;

/* ─── Background presets ──────────────────────────────────────────── */

const BG_PRESETS = [
  { name: "Indigo",  type: "gradient", start: "#667eea", end: "#764ba2" },
  { name: "Ocean",   type: "gradient", start: "#0ea5e9", end: "#06b6d4" },
  { name: "Sunset",  type: "gradient", start: "#f97316", end: "#ec4899" },
  { name: "Emerald", type: "gradient", start: "#10b981", end: "#059669" },
  { name: "Rose",    type: "gradient", start: "#f43f5e", end: "#e11d48" },
  { name: "Slate",   type: "solid",    color: "#1e293b" },
  { name: "Zinc",    type: "solid",    color: "#18181b" },
  { name: "White",   type: "solid",    color: "#f8fafc" },
];

/* ─── Component ───────────────────────────────────────────────────── */

export function ReviewPage({ data, onNavigate }) {
  /* state — processing */
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [done, setDone] = useState(false);
  const [outputPath, setOutputPath] = useState(null);
  const [error, setError] = useState(null);

  /* state — export options */
  const [autoZoom, setAutoZoom] = useState(false);
  const [bgEnabled, setBgEnabled] = useState(true);
  const [presetIdx, setPresetIdx] = useState(0);
  const [cornerRadius, setCornerRadius] = useState(12);
  const [padding, setPadding] = useState(48);

  const videoRef = useRef(null);

  /* ─── IPC listeners ──────────────────────────────────────────────── */
  useEffect(() => {
    const off1 = api.onProgress((d) => {
      setProgress(d.percent);
      if (d.phase) setPhase(d.phase);
    });
    const off2 = api.onProcessingDone((d) => {
      setOutputPath(d.outputPath);
      setDone(true);
      setProcessing(false);
      setProgress(100);
    });
    const off3 = api.onProcessingError((d) => {
      setError(d.error);
      setProcessing(false);
    });
    return () => { off1(); off2(); off3(); };
  }, []);

  /* ─── Load video preview ─────────────────────────────────────────── */
  useEffect(() => {
    if (data?.filePath && videoRef.current) {
      videoRef.current.src = `file://${data.filePath}`;
    }
  }, [data]);

  /* ─── Handlers ───────────────────────────────────────────────────── */
  const preset = BG_PRESETS[presetIdx];

  const handleExport = async () => {
    if (!data?.sessionDir) return;
    setProcessing(true);
    setError(null);
    setProgress(0);

    const exportOpts = {
      sessionDir: data.sessionDir,
      autoZoom,
      background: bgEnabled,
      cornerRadius,
      padding,
      backgroundType: preset.type,
      backgroundColor: preset.color || preset.start,
      gradientStart: preset.start,
      gradientEnd: preset.end,
    };

    try {
      await api.processVideo(exportOpts);
    } catch (err) {
      setError(err.message);
      setProcessing(false);
    }
  };

  const handleDiscard = async () => {
    if (data?.sessionDir) {
      try { await api.deleteRecording(data.sessionDir); } catch {}
    }
    onNavigate("home");
  };

  const handleOpen = () => {
    if (outputPath) api.openOutput(outputPath);
  };

  /* ─── Preview background CSS ─────────────────────────────────────── */
  const previewBg = bgEnabled
    ? preset.type === "gradient"
      ? `linear-gradient(135deg, ${preset.start}, ${preset.end})`
      : preset.color
    : "var(--bg-secondary)";

  /* ─── Empty state ────────────────────────────────────────────────── */
  if (!data) {
    return (
      <div className="review-page">
        <div className="review-empty">
          <p>No recording to review</p>
          <button className="rv-btn rv-btn--secondary" onClick={() => onNavigate("home")}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  /* ─── Main render ────────────────────────────────────────────────── */
  return (
    <div className="review-page">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="rv-header">
        <h2>Export</h2>
        {data.size && (
          <span className="rv-meta">
            {(data.size / (1024 * 1024)).toFixed(1)} MB
          </span>
        )}
      </div>

      <div className="rv-body">
        {/* ── Live Preview ──────────────────────────────────────── */}
        <div className="rv-preview-wrap">
          <div
            className="rv-preview-canvas"
            style={{
              background: previewBg,
              padding: bgEnabled ? `${Math.max(8, Math.round(padding / 6))}px` : 0,
            }}
          >
            <video
              ref={videoRef}
              controls
              className="rv-video"
              style={{
                borderRadius: bgEnabled ? `${cornerRadius}px` : "var(--radius-md)",
              }}
            />
          </div>
        </div>

        {/* ── Options panel ─────────────────────────────────────── */}
        <div className="rv-options">
          {/* Auto-Zoom toggle */}
          <div className="rv-option-row">
            <div className="rv-option-info">
              <Film size={14} className="rv-option-icon" />
              <span>Auto-Zoom</span>
              <span className="rv-hint">Follow cursor clicks</span>
            </div>
            <label className="rv-toggle">
              <input
                type="checkbox"
                checked={autoZoom}
                onChange={(e) => setAutoZoom(e.target.checked)}
              />
              <span className="rv-toggle-track" />
            </label>
          </div>

          {/* Background toggle */}
          <div className="rv-option-row">
            <div className="rv-option-info">
              <Layers size={14} className="rv-option-icon" />
              <span>Background</span>
              <span className="rv-hint">Rounded corners + padding</span>
            </div>
            <label className="rv-toggle">
              <input
                type="checkbox"
                checked={bgEnabled}
                onChange={(e) => setBgEnabled(e.target.checked)}
              />
              <span className="rv-toggle-track" />
            </label>
          </div>

          {/* Background sub-options */}
          {bgEnabled && (
            <div className="rv-sub-options">
              {/* Preset swatches */}
              <div className="rv-swatch-row">
                <span className="rv-sub-label">Color</span>
                <div className="rv-swatches">
                  {BG_PRESETS.map((p, i) => {
                    const bg =
                      p.type === "gradient"
                        ? `linear-gradient(135deg, ${p.start}, ${p.end})`
                        : p.color;
                    return (
                      <button
                        key={i}
                        className={`rv-swatch ${i === presetIdx ? "active" : ""}`}
                        style={{ background: bg }}
                        title={p.name}
                        onClick={() => setPresetIdx(i)}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Corner radius */}
              <div className="rv-slider-row">
                <span className="rv-sub-label">Radius</span>
                <input
                  type="range"
                  min={0}
                  max={32}
                  value={cornerRadius}
                  onChange={(e) => setCornerRadius(Number(e.target.value))}
                  className="rv-slider"
                />
                <span className="rv-slider-val">{cornerRadius}px</span>
              </div>

              {/* Padding */}
              <div className="rv-slider-row">
                <span className="rv-sub-label">Padding</span>
                <input
                  type="range"
                  min={16}
                  max={120}
                  value={padding}
                  onChange={(e) => setPadding(Number(e.target.value))}
                  className="rv-slider"
                />
                <span className="rv-slider-val">{padding}px</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Progress ────────────────────────────────────────────── */}
      {processing && (
        <div className="rv-progress">
          <div className="rv-track">
            <div className="rv-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="rv-progress-label">
            {phase || "Processing…"} {progress}%
          </span>
        </div>
      )}

      {error && (
        <div className="rv-error">
          <p>{error}</p>
        </div>
      )}

      {/* ── Actions ─────────────────────────────────────────────── */}
      <div className="rv-actions">
        {done ? (
          <>
            <button className="rv-btn rv-btn--primary" onClick={handleOpen}>
              <Check size={14} />
              <span>Open Output</span>
            </button>
            <button
              className="rv-btn rv-btn--secondary"
              onClick={() => onNavigate("home")}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <button
              className="rv-btn rv-btn--primary"
              onClick={handleExport}
              disabled={processing}
            >
              {processing ? (
                <>
                  <Loader2 size={14} className="spinner" />
                  <span>Exporting…</span>
                </>
              ) : (
                <>
                  <Download size={14} />
                  <span>Export</span>
                </>
              )}
            </button>
            <button
              className="rv-btn rv-btn--danger"
              onClick={handleDiscard}
              disabled={processing}
            >
              <Trash2 size={14} />
              <span>Discard</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
