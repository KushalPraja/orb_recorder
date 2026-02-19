// Post-processor — orchestrates the export pipeline.
//
// Pipeline modes (all optional, any combination):
//   1. remux WebM → clean CFR MP4  (always)
//   2. auto-zoom via Python/binary  (if opts.autoZoom)
//   3. visual polish via FFmpeg      (if opts.background)
//
// If neither 2 nor 3 is enabled the clean MP4 is the final output.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  EVENTS_FILE,
  RAW_RECORDING_FILE,
  CLEAN_MP4_FILE,
  OUTPUT_FILE,
  DEFAULT_SETTINGS,
} = require("../shared/constants");
const {
  getFfmpegPath,
  remuxToCleanMp4,
  applyVisualExport,
  trimVideo,
} = require("./ffmpeg-utils");

/* ─── Resolve binaries ─────────────────────────────────────────────── */

function safeUnlink(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_err) {}
}

function getPythonPath() {
  if (process.platform === "win32") return "python";
  return "python3";
}

function getProcessorBinaryPath() {
  const localBin = path.join(
    __dirname,
    "..",
    "..",
    "bin",
    process.platform === "win32" ? "screen_processor.exe" : "screen_processor",
  );
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  const packagedBin = path.join(
    process.resourcesPath || "",
    "bin",
    process.platform === "win32" ? "screen_processor.exe" : "screen_processor",
  );
  if (fs.existsSync(packagedBin)) {
    return packagedBin;
  }

  return null;
}

function getScriptPath() {
  const devPath = path.join(__dirname, "..", "..", "scripts", "process.py");
  if (fs.existsSync(devPath)) return devPath;

  const packagedPath = path.join(
    process.resourcesPath || "",
    "scripts",
    "process.py",
  );
  return fs.existsSync(packagedPath) ? packagedPath : null;
}

/* ─── Run the Python / binary auto-zoom processor ──────────────────── */

function runPythonProcessor(inputPath, eventsPath, outputPath, opts = {}) {
  const { zoom = 2.0, hold = 1.5, onProgress } = opts;

  const ffmpegBin = getFfmpegPath();
  const processorBinPath = getProcessorBinaryPath();
  const scriptPath = processorBinPath ? null : getScriptPath();
  const pythonBin = processorBinPath ? null : getPythonPath();

  if (!processorBinPath && !scriptPath) {
    return Promise.reject(
      new Error("Auto-zoom processor not found (checked binary and script)."),
    );
  }

  const command = processorBinPath || pythonBin;
  const args = processorBinPath
    ? [
        inputPath,
        eventsPath,
        outputPath,
        "--zoom",
        String(zoom),
        "--hold",
        String(hold),
        "--ffmpeg",
        ffmpegBin,
      ]
    : [
        scriptPath,
        inputPath,
        eventsPath,
        outputPath,
        "--zoom",
        String(zoom),
        "--hold",
        String(hold),
        "--ffmpeg",
        ffmpegBin,
      ];

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("PROGRESS:") && onProgress) {
          const pct = parseInt(trimmed.slice(9), 10);
          if (Number.isFinite(pct)) onProgress(pct);
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        if (line.trim()) console.log(`[Python] ${line.trim()}`);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else
        reject(
          new Error(`Python processor exited ${code}\n${stderr.slice(-500)}`),
        );
    });

    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            processorBinPath
              ? `Bundled processor not found ("${command}").`
              : `Python not found ("${pythonBin}"). Install Python 3 and run: pip install opencv-python numpy`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}

/* ─── Main entry ───────────────────────────────────────────────────── */

async function processVideo(opts) {
  const {
    recordingDir,
    outputPath,
    onProgress,

    // Auto-zoom (Python processor)
    autoZoom = false,
    zoomFactor,
    zoomDuration,
    fps,

    // Visual polish (FFmpeg)
    background = false,
    cornerRadius = 12,
    padding = 48,
    backgroundType = "solid",
    backgroundColor = "#6366f1",
    gradientStart = "#667eea",
    gradientEnd = "#764ba2",
    wallpaperPath = null,
    imageBlur = "none",

    // Trim
    trimStart,
    trimEnd,
  } = opts;

  const inputPath = path.join(recordingDir, RAW_RECORDING_FILE);
  const eventsPath = path.join(recordingDir, EVENTS_FILE);
  const outPath = outputPath || path.join(recordingDir, OUTPUT_FILE);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Recording not found: ${inputPath}`);
  }

  const targetFps = Number(fps) || DEFAULT_SETTINGS.fps;

  // ── Phase 1: Get a clean CFR MP4 (0-30%) ──────────────────────────
  // If review-page already remuxed a preview.mp4, reuse it to skip work.
  const previewPath = path.join(recordingDir, CLEAN_MP4_FILE);
  const cleanPath = path.join(recordingDir, "__intermediate_clean.mp4");
  const intermediates = [];

  if (fs.existsSync(previewPath)) {
    console.log(`[PostProcessor] Reusing cached preview → ${previewPath}`);
    if (onProgress) onProgress({ percent: 30, phase: "Using cached preview…" });
    // Don't add previewPath to intermediates — we want to keep it
  } else {
    if (onProgress) onProgress({ percent: 0, phase: "Normalizing recording…" });
    console.log(`[PostProcessor] Remuxing → ${cleanPath}`);
    intermediates.push(cleanPath);
    try {
      await remuxToCleanMp4(
        inputPath,
        cleanPath,
        (p) => {
          if (onProgress && Number.isFinite(p.percent)) {
            onProgress({
              percent: Math.min(30, Math.round(p.percent * 0.3)),
              phase: "Normalizing recording…",
            });
          }
        },
        targetFps,
      );
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  let currentInput = fs.existsSync(previewPath) ? previewPath : cleanPath;

  // ── Phase 1.5: Trim (optional, 30-40%) ────────────────────────────
  const isTrimmed =
    Number.isFinite(trimStart) &&
    Number.isFinite(trimEnd) &&
    trimStart < trimEnd &&
    (trimStart > 0.1 || trimEnd < Infinity);

  if (isTrimmed) {
    const trimmedPath = path.join(recordingDir, "__intermediate_trimmed.mp4");
    intermediates.push(trimmedPath);
    if (onProgress) onProgress({ percent: 30, phase: "Trimming…" });
    console.log(
      `[PostProcessor] Trimming ${trimStart.toFixed(2)}s → ${trimEnd.toFixed(2)}s`,
    );

    try {
      await trimVideo(currentInput, trimmedPath, trimStart, trimEnd, (p) => {
        if (onProgress && Number.isFinite(p.percent)) {
          onProgress({
            percent: Math.min(40, 30 + Math.round(p.percent * 0.1)),
            phase: "Trimming…",
          });
        }
      });
      currentInput = trimmedPath;
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Phase 2: Auto-zoom (optional, 40-70%) ─────────────────────────
  if (autoZoom) {
    const zoomOut = path.join(recordingDir, "__intermediate_zoom.mp4");
    intermediates.push(zoomOut);

    if (onProgress) onProgress({ percent: 40, phase: "Applying auto-zoom…" });
    console.log(`[PostProcessor] Auto-zoom → ${zoomOut}`);

    try {
      await runPythonProcessor(currentInput, eventsPath, zoomOut, {
        zoom: Number(zoomFactor) || DEFAULT_SETTINGS.zoomFactor,
        hold: Number(zoomDuration) || DEFAULT_SETTINGS.zoomDuration,
        onProgress: (pct) => {
          if (onProgress) {
            onProgress({
              percent: Math.min(70, 40 + Math.round(pct * 0.3)),
              phase: "Applying auto-zoom…",
            });
          }
        },
      });
      currentInput = zoomOut;
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Phase 3: Visual polish (optional, 70-95%) ─────────────────────
  if (background) {
    const visualOut = autoZoom
      ? path.join(recordingDir, "__intermediate_visual.mp4")
      : outPath; // write directly to final if no zoom step
    if (autoZoom) intermediates.push(visualOut);

    const phaseStart = autoZoom ? 70 : 40;
    const phaseEnd = 95;
    if (onProgress)
      onProgress({ percent: phaseStart, phase: "Applying background…" });
    console.log(`[PostProcessor] Visual export → ${visualOut}`);

    try {
      await applyVisualExport(
        currentInput,
        visualOut,
        {
          cornerRadius,
          padding,
          backgroundType,
          backgroundColor,
          gradientStart,
          gradientEnd,
          wallpaperPath,
          imageBlur,
        },
        (p) => {
          if (onProgress && Number.isFinite(p.percent)) {
            onProgress({
              percent: Math.min(
                phaseEnd,
                phaseStart +
                  Math.round((p.percent * (phaseEnd - phaseStart)) / 100),
              ),
              phase: "Applying background…",
            });
          }
        },
      );
      currentInput = visualOut;
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Phase 4: Finalize ─────────────────────────────────────────────
  // If the current intermediate isn't the final path, rename it
  if (currentInput !== outPath) {
    try {
      fs.copyFileSync(currentInput, outPath);
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // Clean up all intermediates
  intermediates.forEach(safeUnlink);

  if (onProgress) onProgress({ percent: 100, phase: "Done" });
  console.log(`[PostProcessor] Done → ${outPath}`);
  return outPath;
}

module.exports = { processVideo };
