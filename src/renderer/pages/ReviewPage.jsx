import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Download,
  Check,
  Loader2,
  Trash2,
  Film,
  Layers,
  Play,
  Pause,
  Scissors,
  Clock,
  Sparkles,
  SkipBack,
  SkipForward,
} from "lucide-react";
import "./ReviewPage.css";

const api = window.electronAPI;

/* ─── Background presets ──────────────────────────────────────────── */

const BG_PRESETS = [
  { name: "Graphite", type: "gradient", start: "#1a1a1a", end: "#0f0f0f" },
  { name: "Steel", type: "gradient", start: "#2a2a2a", end: "#111111" },
  { name: "Charcoal", type: "gradient", start: "#232323", end: "#161616" },
  { name: "Slate", type: "solid", color: "#1e293b" },
  { name: "Zinc", type: "solid", color: "#18181b" },
  { name: "Ash", type: "solid", color: "#2a2a2a" },
  { name: "Stone", type: "solid", color: "#3a3a3a" },
  { name: "Cloud", type: "solid", color: "#d4d4d4" },
  { name: "White", type: "solid", color: "#f8fafc" },
];

/* ─── Helpers ─────────────────────────────────────────────────────── */

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${ms}`;
}

function formatTimecode(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ═══════════════════════════════════════════════════════════════════
   VideoTrimmer — timeline scrubber with start/end trim handles,
   thumbnail strip, and playhead.
   ═══════════════════════════════════════════════════════════════════ */

function VideoTrimmer({
  videoSrc,
  duration,
  trimStart,
  trimEnd,
  onTrimChange,
  currentTime,
  onSeek,
  isPlaying,
  onPlayPause,
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [thumbsLoaded, setThumbsLoaded] = useState(false);

  /* ── Generate thumbnail strip from video frames ───────────────── */
  useEffect(() => {
    if (!videoSrc || !duration || duration <= 0) return;

    let cancelled = false;
    setThumbsLoaded(false);

    const video = document.createElement("video");
    video.src = videoSrc;
    video.muted = true;
    video.preload = "auto";

    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext("2d");

    const THUMB_COUNT = 20;
    const thumbs = [];

    video.addEventListener("loadeddata", async () => {
      for (let i = 0; i < THUMB_COUNT && !cancelled; i++) {
        const time = ((i + 0.5) / THUMB_COUNT) * duration;
        video.currentTime = Math.min(time, duration - 0.05);
        await new Promise((resolve) => {
          video.onseeked = resolve;
          setTimeout(resolve, 600);
        });
        if (cancelled) break;
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          thumbs.push(canvas.toDataURL("image/jpeg", 0.5));
        } catch {
          thumbs.push(null);
        }
      }
      if (!cancelled) {
        setThumbnails([...thumbs]);
        setThumbsLoaded(true);
      }
      video.src = "";
    });

    video.addEventListener("error", () => {
      if (!cancelled) setThumbsLoaded(true);
    });

    return () => {
      cancelled = true;
      video.src = "";
    };
  }, [videoSrc, duration]);

  /* ── Position helpers ─────────────────────────────────────────── */
  const posToTime = useCallback(
    (clientX) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !duration) return 0;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * duration;
    },
    [duration],
  );

  /* ── Drag interaction ─────────────────────────────────────────── */
  const handlePointerDown = useCallback((e, type) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(type);
    document.body.style.cursor =
      type === "playhead" ? "grabbing" : "ew-resize";
  }, []);

  const handleTrackClick = useCallback(
    (e) => {
      if (dragging) return;
      const time = posToTime(e.clientX);
      const clamped = Math.max(trimStart, Math.min(time, trimEnd));
      onSeek(clamped);
    },
    [dragging, posToTime, trimStart, trimEnd, onSeek],
  );

  useEffect(() => {
    if (!dragging) return;

    const MIN_CLIP = 0.5;

    const handleMove = (e) => {
      const time = posToTime(e.clientX);
      if (dragging === "start") {
        onTrimChange(Math.max(0, Math.min(time, trimEnd - MIN_CLIP)), trimEnd);
      } else if (dragging === "end") {
        onTrimChange(
          trimStart,
          Math.min(duration, Math.max(time, trimStart + MIN_CLIP)),
        );
      } else if (dragging === "playhead") {
        onSeek(Math.max(trimStart, Math.min(time, trimEnd)));
      }
    };

    const handleUp = () => {
      setDragging(null);
      document.body.style.cursor = "";
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, posToTime, trimStart, trimEnd, duration, onTrimChange, onSeek]);

  /* ── Computed positions ───────────────────────────────────────── */
  const startPct = duration > 0 ? (trimStart / duration) * 100 : 0;
  const endPct = duration > 0 ? (trimEnd / duration) * 100 : 100;
  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const clipDuration = trimEnd - trimStart;

  /* ── Skip controls ────────────────────────────────────────────── */
  const skipBackward = useCallback(() => {
    onSeek(Math.max(trimStart, currentTime - 1));
  }, [onSeek, currentTime, trimStart]);

  const skipForward = useCallback(() => {
    onSeek(Math.min(trimEnd, currentTime + 1));
  }, [onSeek, currentTime, trimEnd]);

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="trimmer">
      {/* Trim time badges */}
      <div className="trimmer-info">
        <div className="trimmer-badge trimmer-badge--start">
          <Scissors size={10} />
          <span>{formatTime(trimStart)}</span>
        </div>
        <div className="trimmer-badge trimmer-badge--clip">
          <Clock size={10} />
          <span>{formatTime(clipDuration)}</span>
        </div>
        <div className="trimmer-badge trimmer-badge--end">
          <span>{formatTime(trimEnd)}</span>
          <Scissors size={10} style={{ transform: "scaleX(-1)" }} />
        </div>
      </div>

      {/* Timeline track */}
      <div className="trimmer-track" ref={trackRef} onClick={handleTrackClick}>
        {/* Thumbnail strip */}
        <div className="trimmer-thumbs">
          {thumbsLoaded && thumbnails.length > 0
            ? thumbnails.map((src, i) =>
              src ? (
                <img
                  key={i}
                  src={src}
                  className="trimmer-thumb"
                  draggable={false}
                  alt=""
                />
              ) : (
                <div key={i} className="trimmer-thumb trimmer-thumb--empty" />
              ),
            )
            : !thumbsLoaded && (
              <div className="trimmer-thumbs-loading">
                <div className="trimmer-thumbs-shimmer" />
              </div>
            )}
        </div>

        {/* Dimmed regions outside selection */}
        <div
          className="trimmer-dim trimmer-dim--left"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="trimmer-dim trimmer-dim--right"
          style={{ width: `${100 - endPct}%` }}
        />

        {/* Selection highlight border */}
        <div
          className="trimmer-selection"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />

        {/* Start handle */}
        <div
          className={`trimmer-handle trimmer-handle--start ${dragging === "start" ? "active" : ""}`}
          style={{ left: `${startPct}%` }}
          onPointerDown={(e) => handlePointerDown(e, "start")}
        >
          <div className="trimmer-handle-bar">
            <span />
            <span />
          </div>
        </div>

        {/* End handle */}
        <div
          className={`trimmer-handle trimmer-handle--end ${dragging === "end" ? "active" : ""}`}
          style={{ left: `${endPct}%` }}
          onPointerDown={(e) => handlePointerDown(e, "end")}
        >
          <div className="trimmer-handle-bar">
            <span />
            <span />
          </div>
        </div>

        {/* Playhead */}
        <div
          className={`trimmer-playhead ${dragging === "playhead" ? "active" : ""}`}
          style={{ left: `${playheadPct}%` }}
          onPointerDown={(e) => handlePointerDown(e, "playhead")}
        >
          <div className="trimmer-playhead-head" />
          <div className="trimmer-playhead-line" />
        </div>
      </div>

      {/* Playback controls */}
      <div className="trimmer-controls">
        <div className="trimmer-controls-left">
          <button
            className="trimmer-ctrl-btn"
            onClick={skipBackward}
            title="Back 1s"
          >
            <SkipBack size={12} />
          </button>
          <button
            className="trimmer-play-btn"
            onClick={onPlayPause}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="trimmer-ctrl-btn"
            onClick={skipForward}
            title="Forward 1s"
          >
            <SkipForward size={12} />
          </button>
        </div>
        <div className="trimmer-controls-right">
          <span className="trimmer-time-current">{formatTime(currentTime)}</span>
          <span className="trimmer-time-sep">/</span>
          <span className="trimmer-time-total">{formatTime(clipDuration)}</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ReviewPage — export screen with video trimmer + settings sidebar.
   ═══════════════════════════════════════════════════════════════════ */

export function ReviewPage({ data, onNavigate }) {
  /* state — remux */
  const [remuxing, setRemuxing] = useState(false);
  const [cleanPath, setCleanPath] = useState(null);

  /* state — video */
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  /* state — trim */
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

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

  /* ─── Remux on mount ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!data?.sessionDir) return;
    setRemuxing(true);
    setError(null);
    api
      .remuxVideo(data.sessionDir)
      .then((p) => {
        setCleanPath(p);
        setRemuxing(false);
      })
      .catch((err) => {
        setError(`Failed to prepare video: ${err.message}`);
        setRemuxing(false);
      });
  }, [data?.sessionDir]);

  /* ─── Load video preview ─────────────────────────────────────────── */
  useEffect(() => {
    if (cleanPath && videoRef.current) {
      videoRef.current.src = `file://${cleanPath}`;
    }
  }, [cleanPath]);

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
    return () => {
      off1();
      off2();
      off3();
    };
  }, []);

  /* ─── Video event handlers ───────────────────────────────────────── */
  const handleLoadedMetadata = useCallback(() => {
    const dur = videoRef.current?.duration || 0;
    if (Number.isFinite(dur) && dur > 0) {
      setVideoDuration(dur);
      setTrimEnd(dur);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const time = videoRef.current?.currentTime || 0;
    setCurrentTime(time);
    if (time >= trimEnd - 0.05) {
      videoRef.current.pause();
      videoRef.current.currentTime = trimStart;
      setIsPlaying(false);
    }
  }, [trimStart, trimEnd]);

  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current.currentTime >= trimEnd - 0.1) {
        videoRef.current.currentTime = trimStart;
      }
      if (
        videoRef.current.currentTime < trimStart ||
        videoRef.current.currentTime > trimEnd
      ) {
        videoRef.current.currentTime = trimStart;
      }
      videoRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying, trimStart, trimEnd]);

  const handleSeek = useCallback((time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const handleTrimChange = useCallback((start, end) => {
    setTrimStart(start);
    setTrimEnd(end);
  }, []);

  /* ─── Export handler ─────────────────────────────────────────────── */
  const preset = BG_PRESETS[presetIdx];

  const handleExport = async () => {
    if (!data?.sessionDir) return;
    setProcessing(true);
    setError(null);
    setProgress(0);

    const isTrimmed =
      trimStart > 0.1 || (videoDuration > 0 && trimEnd < videoDuration - 0.1);

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
      ...(isTrimmed && { trimStart, trimEnd }),
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
      try {
        await api.deleteRecording(data.sessionDir);
      } catch { }
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

  const videoSrc = cleanPath ? `file://${cleanPath}` : null;

  /* ─── Empty state ────────────────────────────────────────────────── */
  if (!data) {
    return (
      <div className="review-page">
        <div className="review-empty">
          <p>No recording to review</p>
          <button
            className="rv-btn rv-btn--secondary"
            onClick={() => onNavigate("home")}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  /* ─── Loading state (remuxing) ───────────────────────────────────── */
  if (remuxing) {
    return (
      <div className="review-page">
        <div className="review-loading">
          <div className="review-loading-spinner">
            <Loader2 size={28} className="spinner" />
          </div>
          <p>Preparing preview…</p>
          <span>Converting to seekable format</span>
        </div>
      </div>
    );
  }

  /* ─── Main render ────────────────────────────────────────────────── */
  return (
    <div className="review-page">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="rv-header">
        <div className="rv-header-left">
          <h2>Export</h2>
          <div className="rv-header-badges">
            {data.size && (
              <span className="rv-badge rv-badge--muted">
                {(data.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            )}
            {videoDuration > 0 && (
              <span className="rv-badge rv-badge--accent">
                {formatTimecode(videoDuration)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Body: left (video+trimmer) + right (sidebar) ────────── */}
      <div className="rv-body">
        {/* Left pane */}
        <div className="rv-left">
          {/* Video preview */}
          <div className="rv-preview-wrap">
            <div
              className="rv-preview-canvas"
              style={{
                background: bgEnabled ? previewBg : "transparent",
                padding: bgEnabled
                  ? `${Math.round(padding / 4)}px`
                  : 0,
              }}
            >
              <video
                ref={videoRef}
                className="rv-video"
                style={{
                  borderRadius: bgEnabled ? `${cornerRadius}px` : 0,
                }}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
                onPause={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
              />
            </div>
          </div>

          {/* Timeline trimmer */}
          {videoDuration > 0 && (
            <VideoTrimmer
              videoSrc={videoSrc}
              duration={videoDuration}
              trimStart={trimStart}
              trimEnd={trimEnd}
              onTrimChange={handleTrimChange}
              currentTime={currentTime}
              onSeek={handleSeek}
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
            />
          )}
        </div>

        {/* Right sidebar — unified panel */}
        <div className="rv-sidebar">
          <div className="rv-panel">
            {/* ── Trim section ──────────────────────────────────── */}
            <div className="rv-section-header">
              <Scissors size={9} />
              <span>Trim</span>
            </div>
            <div className="rv-section-body">
              <div className="rv-stat-row">
                <span className="rv-stat-label">Start</span>
                <span className="rv-stat-value">{formatTime(trimStart)}</span>
              </div>
              <div className="rv-stat-row">
                <span className="rv-stat-label">End</span>
                <span className="rv-stat-value">{formatTime(trimEnd)}</span>
              </div>
              <div className="rv-stat-row rv-stat-row--highlight">
                <span className="rv-stat-label">Duration</span>
                <span className="rv-stat-value rv-stat-value--accent">
                  {formatTime(trimEnd - trimStart)}
                </span>
              </div>
            </div>

            {/* ── Effects section ───────────────────────────────── */}
            <div className="rv-section-header">
              <Sparkles size={9} />
              <span>Effects</span>
            </div>
            <div className="rv-section-body">
              <div className="rv-option-row">
                <div className="rv-option-info">
                  <Film size={12} className="rv-option-icon" />
                  <div className="rv-option-text">
                    <span className="rv-option-name">Auto-Zoom</span>
                    <span className="rv-option-desc">Follow cursor clicks</span>
                  </div>
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
              <div className="rv-option-row">
                <div className="rv-option-info">
                  <Layers size={12} className="rv-option-icon" />
                  <div className="rv-option-text">
                    <span className="rv-option-name">Background</span>
                    <span className="rv-option-desc">Padded + styled</span>
                  </div>
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
            </div>

            {/* ── Background section (conditional) ──────────────── */}
            {bgEnabled && (
              <>
                <div className="rv-section-header">
                  <Layers size={9} />
                  <span>Background</span>
                </div>
                <div className="rv-section-body">
                  <div className="rv-field">
                    <span className="rv-field-label">Color</span>
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
                  <div className="rv-field">
                    <div className="rv-field-header">
                      <span className="rv-field-label">Radius</span>
                      <span className="rv-field-value">{cornerRadius}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={32}
                      value={cornerRadius}
                      onChange={(e) => setCornerRadius(Number(e.target.value))}
                      className="rv-slider"
                    />
                  </div>
                  <div className="rv-field">
                    <div className="rv-field-header">
                      <span className="rv-field-label">Padding</span>
                      <span className="rv-field-value">{padding}px</span>
                    </div>
                    <input
                      type="range"
                      min={16}
                      max={120}
                      value={padding}
                      onChange={(e) => setPadding(Number(e.target.value))}
                      className="rv-slider"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Progress bar ────────────────────────────────────────── */}
      {processing && (
        <div className="rv-progress">
          <div className="rv-progress-bar">
            <div
              className="rv-progress-fill"
              style={{ width: `${progress}%` }}
            >
              <div className="rv-progress-glow" />
            </div>
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
