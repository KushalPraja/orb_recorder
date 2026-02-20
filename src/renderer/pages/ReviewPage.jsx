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
  ArrowLeft,
  RotateCcw,
  FolderOpen,
} from "lucide-react";
import "./ReviewPage.css";

const api = window.electronAPI;

/* ─── Background presets ──────────────────────────────────────────── */

const GRADIENT_PRESETS = [
  { name: "Graphite", start: "#1a1a1a", end: "#0f0f0f" },
  { name: "Steel", start: "#2a2a2a", end: "#111111" },
  { name: "Charcoal", start: "#232323", end: "#161616" },
  { name: "Ocean", start: "#0f2027", end: "#203a43" },
  { name: "Violet", start: "#16001e", end: "#30115e" },
  { name: "Forest", start: "#0a1a0f", end: "#1a3a1f" },
  { name: "Dusk", start: "#1a0a1a", end: "#3a102a" },
  { name: "Ember", start: "#1a0a00", end: "#2d1200" },
];

const COLOR_PRESETS = [
  "#1e293b",
  "#18181b",
  "#2a2a2a",
  "#3a3a3a",
  "#d4d4d4",
  "#f8fafc",
  "#0f172a",
  "#450a0a",
];

const WALLPAPERS = [
  "10-14-Day-Thumb.jpg",
  "10-15-Day-thumb.jpg",
  "10-15-Night-thumb.jpg",
  "11-0-Color-Day-thumbnails.jpg",
  "11-0-Day-thumbnail.jpg",
  "12-Light-thumbnail.jpg",
  "13-Ventura-Light-thumb.jpg",
  "14-Sonoma-Horizon-thumb.jpeg",
  "14-Sonoma-Light-thumb.jpg",
  "15-Sequoia-Dark-thumbnail.jpg",
  "15-Sequoia-Light-thumbnail.jpg",
  "26-Tahoe-Beach-Day-thumb.jpeg",
  "26-Tahoe-Beach-Dusk-thumb.jpeg",
  "26-Tahoe-Dark-6K-thumb.jpeg",
  "26-Tahoe-Light-6K-thumb.jpeg",
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
    document.body.style.cursor = type === "playhead" ? "grabbing" : "ew-resize";
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
          <span className="trimmer-time-current">
            {formatTime(currentTime)}
          </span>
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
  // bgEnabled toggles background on/off; bgType: 'color' | 'gradient' | 'image'
  const [bgEnabled, setBgEnabled] = useState(true);
  const [bgType, setBgType] = useState("gradient");
  const [bgColor, setBgColor] = useState("#1e293b");
  const [gradientIdx, setGradientIdx] = useState(0);
  const [wallpaperIdx, setWallpaperIdx] = useState(0);
  const [imageBlur, setImageBlur] = useState("none"); // 'none' | 'moderate' | 'strong'
  const [cornerRadius, setCornerRadius] = useState(12);
  const [padding, setPadding] = useState(48);

  const videoRef = useRef(null);

  /* Whether we came from the home page (existing project) vs fresh recording */
  const isExistingProject = !!data?.fromHome;

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
  const gradient = GRADIENT_PRESETS[gradientIdx];

  const handleExport = async () => {
    if (!data?.sessionDir) return;

    // Ask user where to save
    const defaultName = data.name || "recording";
    const exportPath = await api.pickExportPath(defaultName);
    if (!exportPath) return; // user cancelled

    setProcessing(true);
    setError(null);
    setProgress(0);
    setDone(false);
    setOutputPath(null);

    const isTrimmed =
      trimStart > 0.1 || (videoDuration > 0 && trimEnd < videoDuration - 0.1);

    const exportOpts = {
      sessionDir: data.sessionDir,
      exportPath,
      autoZoom,
      background: bgEnabled,
      cornerRadius: bgEnabled ? cornerRadius : 0,
      padding: bgEnabled ? padding : 0,
      backgroundType: !bgEnabled
        ? "none"
        : bgType === "color"
          ? "solid"
          : bgType === "gradient"
            ? "gradient"
            : "image",
      backgroundColor: bgEnabled && bgType === "color" ? bgColor : undefined,
      gradientStart:
        bgEnabled && bgType === "gradient" ? gradient.start : undefined,
      gradientEnd:
        bgEnabled && bgType === "gradient" ? gradient.end : undefined,
      wallpaperFile:
        bgEnabled && bgType === "image" ? WALLPAPERS[wallpaperIdx] : undefined,
      imageBlur: bgEnabled && bgType === "image" ? imageBlur : "none",
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
    if (!data?.sessionDir) {
      onNavigate("home");
      return;
    }
    
    try {
      setProcessing(true);
      await api.deleteRecording(data.sessionDir);
    } catch (err) {
      setError(err?.message || "Failed to delete project");
      setProcessing(false);
      return;
    }
    setProcessing(false);
    onNavigate("home");
  };

  const handleOpen = () => {
    if (outputPath) api.openOutput(outputPath);
  };

  const handleReExport = () => {
    setDone(false);
    setOutputPath(null);
    setProgress(0);
    setPhase("");
    setError(null);
  };

  /* ─── Preview background CSS ─────────────────────────────────────── */
  const previewCanvasBg = !bgEnabled
    ? "var(--bg-secondary)"
    : bgType === "color"
      ? bgColor
      : bgType === "gradient"
        ? `linear-gradient(135deg, ${gradient.start}, ${gradient.end})`
        : bgType === "image"
          ? "transparent"
          : "var(--bg-secondary)";

  const blurPx =
    imageBlur === "moderate" ? 10 : imageBlur === "strong" ? 24 : 0;

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
          <p>Preparing editor preview…</p>
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
          <button
            className="rv-back-btn"
            onClick={() => onNavigate("home")}
            title="Back to projects"
          >
            <ArrowLeft size={14} />
          </button>
          <h2>{data.name || "Export"}</h2>
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
            {/* Blurred image background layer */}
            {bgEnabled && bgType === "image" && (
              <div
                className="rv-preview-bg-image"
                style={{
                  backgroundImage: `url(./Wallpapers/${WALLPAPERS[wallpaperIdx]})`,
                  filter: blurPx > 0 ? `blur(${blurPx}px)` : "none",
                }}
              />
            )}
            <div
              className="rv-preview-canvas"
              style={{
                background: previewCanvasBg,
                padding: bgEnabled ? `${Math.round(padding / 4)}px` : 0,
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
            </div>

            <div className="rv-section-body">
              {/* Toggle row — same pattern as Auto-Zoom */}
              <div className="rv-option-row">
                <div className="rv-option-info">
                  <Layers size={12} className="rv-option-icon" />
                  <div className="rv-option-text">
                    <span className="rv-option-name">Background</span>
                    <span className="rv-option-desc">
                      Add canvas behind video
                    </span>
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

              {/* Collapsible sub-panel — only shown when enabled */}
              <div className={`rv-bg-sub ${bgEnabled ? "open" : ""}`}>
                {/* Type selector — 3 options only */}
                <div className="rv-field">
                  <span className="rv-field-label">Style</span>
                  <div className="rv-bg-type-selector">
                    {["color", "gradient", "image"].map((t) => (
                      <button
                        key={t}
                        className={`rv-bg-type-btn ${bgType === t ? "active" : ""}`}
                        onClick={() => setBgType(t)}
                      >
                        {t === "color"
                          ? "Color"
                          : t === "gradient"
                            ? "Gradient"
                            : "Image"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color picker */}
                {bgType === "color" && (
                  <div className="rv-field">
                    <div className="rv-field-header">
                      <span className="rv-field-label">Color</span>
                      <input
                        type="color"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        className="rv-color-input"
                      />
                    </div>
                    <div className="rv-swatches">
                      {COLOR_PRESETS.map((c, i) => (
                        <button
                          key={i}
                          className={`rv-swatch ${bgColor === c ? "active" : ""}`}
                          style={{ background: c }}
                          title={c}
                          onClick={() => setBgColor(c)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Gradient presets */}
                {bgType === "gradient" && (
                  <div className="rv-field">
                    <span className="rv-field-label">Preset</span>
                    <div className="rv-swatches">
                      {GRADIENT_PRESETS.map((g, i) => (
                        <button
                          key={i}
                          className={`rv-swatch ${gradientIdx === i ? "active" : ""}`}
                          style={{
                            background: `linear-gradient(135deg, ${g.start}, ${g.end})`,
                          }}
                          title={g.name}
                          onClick={() => setGradientIdx(i)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Image wallpaper picker */}
                {bgType === "image" && (
                  <>
                    <div className="rv-field">
                      <span className="rv-field-label">Wallpaper</span>
                      <div className="rv-wallpaper-grid">
                        {WALLPAPERS.map((w, i) => (
                          <button
                            key={i}
                            className={`rv-wallpaper-thumb ${wallpaperIdx === i ? "active" : ""}`}
                            style={{
                              backgroundImage: `url(./Wallpapers/${w})`,
                            }}
                            title={w
                              .replace(/-thumb\.(jpg|jpeg)$/i, "")
                              .replace(/-thumbnail\.(jpg|jpeg)$/i, "")}
                            onClick={() => setWallpaperIdx(i)}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="rv-field">
                      <span className="rv-field-label">Blur</span>
                      <div className="rv-blur-options">
                        {["none", "moderate", "strong"].map((b) => (
                          <button
                            key={b}
                            className={`rv-blur-btn ${imageBlur === b ? "active" : ""}`}
                            onClick={() => setImageBlur(b)}
                          >
                            {b.charAt(0).toUpperCase() + b.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Radius + Padding */}
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
            </div>

            {/* Panel footer — actions moved into sidebar */}
            <div className="rv-panel-footer">
              {done ? (
                <>
                  <button
                    className="rv-btn rv-btn--primary"
                    onClick={handleOpen}
                  >
                    <FolderOpen size={14} />
                    <span>Show in Folder</span>
                  </button>
                  <button
                    className="rv-btn rv-btn--secondary"
                    onClick={handleReExport}
                  >
                    <RotateCcw size={14} />
                    <span>Re-export</span>
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
                    <span>{"Discard"}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Progress bar ────────────────────────────────────────── */}
      {processing && (
        <div className="rv-progress">
          <div className="rv-progress-bar">
            <div className="rv-progress-fill" style={{ width: `${progress}%` }}>
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

      {/* actions moved into sidebar footer */}
    </div>
  );
}
