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
  META_FILE,
  DEFAULT_SETTINGS,
} = require("../shared/constants");
const {
  getFfmpegPath,
  applyVisualExport,
  trimVideo,
  muxAudioInto,
  getBestH264Encoder,
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
  const exeName =
    process.platform === "win32" ? "screen_processor.exe" : "screen_processor";

  const isInsideAsar = __dirname.includes("app.asar");

  if (!isInsideAsar) {
    const localBin = path.join(__dirname, "..", "..", "bin", exeName);
    if (fs.existsSync(localBin)) return localBin;
  }

  if (process.resourcesPath) {
    const packagedBin = path.join(process.resourcesPath, "bin", exeName);
    if (fs.existsSync(packagedBin)) return packagedBin;
  }

  return null;
}

function getScriptPath() {
  const isInsideAsar = __dirname.includes("app.asar");

  if (!isInsideAsar) {
    const devPath = path.join(__dirname, "..", "..", "scripts", "process.py");
    if (fs.existsSync(devPath)) return devPath;
  }

  if (process.resourcesPath) {
    const packagedPath = path.join(
      process.resourcesPath,
      "scripts",
      "process.py",
    );
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  return null;
}

/* ─── Run the Python / binary auto-zoom processor ──────────────────── */

function runPythonProcessor(
  inputPath,
  eventsPath,
  metaPath,
  outputPath,
  opts = {},
) {
  const {
    zoom = 2.0,
    hold = 1.5,
    encoder = "libx264",
    onProgress,
    withBackground = false,
    padding = 48,
    cornerRadius = 12,
    backgroundType = "solid",
    backgroundColor = "#6366f1",
    gradientStart = "#667eea",
    gradientEnd = "#764ba2",
    wallpaperPath = null,
    imageBlur = "none",
  } = opts;

  const ffmpegBin = getFfmpegPath();
  const processorBinPath = getProcessorBinaryPath();
  const scriptPath = processorBinPath ? null : getScriptPath();
  const pythonBin = processorBinPath ? null : getPythonPath();

  if (!processorBinPath && !scriptPath) {
    return Promise.reject(
      new Error("Auto-zoom processor not found (checked binary and script)."),
    );
  }

  // Meta-file flags — always passed so the processor can read capture origin
  const metaArgs =
    metaPath && fs.existsSync(metaPath) ? ["--meta", metaPath] : [];

  // Encoder flag — use GPU encoder when available for faster processing
  const encoderArgs = ["--encoder", encoder];

  // Background flags — only appended when compositing is requested
  const bgArgs = withBackground
    ? [
        "--background",
        "--padding",
        String(padding),
        "--corner-radius",
        String(cornerRadius),
        "--bg-type",
        backgroundType,
        "--bg-color",
        backgroundColor,
        "--gradient-start",
        gradientStart,
        "--gradient-end",
        gradientEnd,
        "--image-blur",
        imageBlur,
        ...(wallpaperPath ? ["--wallpaper", wallpaperPath] : []),
      ]
    : [];

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
        ...encoderArgs,
        ...metaArgs,
        ...bgArgs,
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
        ...encoderArgs,
        ...metaArgs,
        ...bgArgs,
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
  const metaPath = path.join(recordingDir, META_FILE);
  const outPath = outputPath ?? path.join(recordingDir, OUTPUT_FILE);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Recording not found: ${inputPath}`);
  }

  /** @param {number} n  @param {number} fallback */
  function validNum(n, fallback) {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  const targetFps = validNum(fps, DEFAULT_SETTINGS.fps);

  // Detect best available hardware encoder once per export (cached after first call)
  const encoder = await getBestH264Encoder();

  // ── Phase 1: Locate the clean preview MP4 (always present) ───────────
  const previewPath = path.join(recordingDir, CLEAN_MP4_FILE);
  const intermediates = [];

  if (!fs.existsSync(previewPath)) {
    throw new Error(
      `preview.mp4 not found at ${previewPath}. Open the recording in the editor first to generate it.`,
    );
  }

  if (onProgress) onProgress({ percent: 0, phase: "Loading recording…" });
  let currentInput = previewPath;

  // ── Phase 1.5: Trim (optional, 0-15%) ────────────────────────────
  const isTrimmed =
    Number.isFinite(trimStart) &&
    Number.isFinite(trimEnd) &&
    trimStart < trimEnd &&
    (trimStart > 0.1 || trimEnd < Infinity);

  if (isTrimmed) {
    const trimmedPath = path.join(recordingDir, "__intermediate_trimmed.mp4");
    intermediates.push(trimmedPath);
    if (onProgress) onProgress({ percent: 0, phase: "Trimming…" });
    console.log(
      `[PostProcessor] Trimming ${trimStart.toFixed(2)}s → ${trimEnd.toFixed(2)}s`,
    );

    try {
      await trimVideo(currentInput, trimmedPath, trimStart, trimEnd, (p) => {
        if (onProgress && Number.isFinite(p.percent)) {
          onProgress({
            percent: Math.min(15, Math.round(p.percent * 0.15)),
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

  // ── Phase 2: Auto-zoom (optional, 15-95%) ────────────────
  if (autoZoom) {
    const zoomOut = path.join(recordingDir, "__intermediate_zoom.mp4");
    intermediates.push(zoomOut);

    // Save the current source so we can merge its audio back after Python
    // (Python/OpenCV only writes video — audio is stripped during processing)
    const audioSourceBeforePython = currentInput;

    const phaseLabel = background
      ? "Applying zoom + background…"
      : "Applying auto-zoom…";

    if (onProgress) onProgress({ percent: 15, phase: phaseLabel });
    console.log(
      `[PostProcessor] Auto-zoom${background ? " + background" : ""} → ${zoomOut}`,
    );

    try {
      await runPythonProcessor(currentInput, eventsPath, metaPath, zoomOut, {
        zoom: validNum(zoomFactor, DEFAULT_SETTINGS.zoomFactor),
        hold: validNum(zoomDuration, DEFAULT_SETTINGS.zoomDuration),
        encoder,
        onProgress: (pct) => {
          if (onProgress) {
            onProgress({
              percent: Math.min(95, 15 + Math.round(pct * 0.8)),
              phase: phaseLabel,
            });
          }
        },
        // Pass background opts so Python composites in the same pass
        withBackground: background,
        padding,
        cornerRadius,
        backgroundType,
        backgroundColor,
        gradientStart,
        gradientEnd,
        wallpaperPath,
        imageBlur,
      });
      currentInput = zoomOut;

      // Python outputs video-only; merge audio back from the pre-zoom source
      const zoomAudio = path.join(
        recordingDir,
        "__intermediate_zoom_audio.mp4",
      );
      intermediates.push(zoomAudio);
      try {
        await muxAudioInto(zoomOut, audioSourceBeforePython, zoomAudio);
        currentInput = zoomAudio;
      } catch (audioErr) {
        console.warn(
          "[PostProcessor] Audio merge after zoom failed (continuing video-only):",
          audioErr.message,
        );
      }
    } catch (err) {
      intermediates.forEach(safeUnlink);
      throw err;
    }
  }

  // ── Phase 3: Visual polish (optional, 15-95%) ──────────────────—
  // Only runs when background is requested WITHOUT auto-zoom.
  // When autoZoom is also true, Python already composited in Phase 2.

  if (background && !autoZoom) {
    const visualOut = outPath; // write directly to final (no zoom step)

    if (onProgress) onProgress({ percent: 15, phase: "Applying background…" });
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
              percent: Math.min(95, 15 + Math.round((p.percent * 80) / 100)),
              phase: "Applying background…",
            });
          }
        },
        encoder,
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
