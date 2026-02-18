// Post-processor — spawns the Python Screen Studio-style processor.
//
// Input:  session dir containing recording.webm + events.json
// Output: output.mp4 with smooth auto-zoom, click ripples, scroll panning
//
// The heavy lifting is done by scripts/process.py (opencv + ffmpeg pipe).
// This module just resolves paths, spawns Python, and parses progress.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  EVENTS_FILE,
  RAW_RECORDING_FILE,
  OUTPUT_FILE,
  DEFAULT_ZOOM_FACTOR,
  DEFAULT_ZOOM_DURATION,
  DEFAULT_FPS,
} = require("../shared/constants");
const { getFfmpegPath, remuxToCleanMp4 } = require("./ffmpeg-utils");

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

/* ─── Main entry ───────────────────────────────────────────────────── */

async function processVideo(opts) {
  const { recordingDir, outputPath, zoomFactor, zoomDuration, onProgress } =
    opts;

  const inputPath = path.join(recordingDir, RAW_RECORDING_FILE);
  const eventsPath = path.join(recordingDir, EVENTS_FILE);
  const outPath = outputPath || path.join(recordingDir, OUTPUT_FILE);
  const cleanInputPath = path.join(recordingDir, "__intermediate_clean.mp4");

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Recording not found: ${inputPath}`);
  }

  const ffmpegBin = getFfmpegPath();
  const processorBinPath = getProcessorBinaryPath();
  const scriptPath = processorBinPath ? null : getScriptPath();
  const pythonBin = processorBinPath ? null : getPythonPath();

  if (!processorBinPath && !scriptPath) {
    throw new Error(
      `Processor not found (checked binary and script): ${scriptPath}`,
    );
  }

  const zoom = Number(zoomFactor) || DEFAULT_ZOOM_FACTOR;
  const hold = Number(zoomDuration) || DEFAULT_ZOOM_DURATION;
  const targetFps = Number(opts.fps) || DEFAULT_FPS;

  console.log(`[PostProcessor] Preparing clean intermediate…`);
  console.log(`[PostProcessor]   input:  ${inputPath}`);
  console.log(`[PostProcessor]   output: ${outPath}`);
  console.log(`[PostProcessor]   zoom=${zoom} hold=${hold}`);

  if (onProgress) onProgress({ percent: 0, phase: "Starting processor…" });

  try {
    await remuxToCleanMp4(
      inputPath,
      cleanInputPath,
      (p) => {
        if (onProgress && Number.isFinite(p.percent)) {
          const remuxPct = Math.min(
            70,
            Math.max(0, Math.round(p.percent * 0.7)),
          );
          onProgress({ percent: remuxPct, phase: "Normalizing recording…" });
        }
      },
      targetFps,
    );
  } catch (err) {
    safeUnlink(cleanInputPath);
    throw err;
  }

  console.log(`[PostProcessor] Spawning Python processor…`);

  return new Promise((resolve, reject) => {
    const args = processorBinPath
      ? [
          cleanInputPath,
          eventsPath,
          outPath,
          "--zoom",
          String(zoom),
          "--hold",
          String(hold),
          "--ffmpeg",
          ffmpegBin,
        ]
      : [
          scriptPath,
          cleanInputPath,
          eventsPath,
          outPath,
          "--zoom",
          String(zoom),
          "--hold",
          String(hold),
          "--ffmpeg",
          ffmpegBin,
        ];

    const command = processorBinPath || pythonBin;

    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    const cleanup = () => safeUnlink(cleanInputPath);

    proc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("PROGRESS:")) {
          const pct = parseInt(trimmed.slice(9), 10);
          if (Number.isFinite(pct) && onProgress) {
            const mappedPct = Math.min(
              100,
              Math.max(70, 70 + Math.round(pct * 0.3)),
            );
            onProgress({ percent: mappedPct, phase: "Applying zoom…" });
          }
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
      cleanup();

      if (code === 0) {
        console.log(`[PostProcessor] Done → ${outPath}`);
        resolve(outPath);
      } else {
        const msg = `Python processor exited with code ${code}\n${stderr.slice(-500)}`;
        console.error(`[PostProcessor] Failed: ${msg}`);
        reject(new Error(msg));
      }
    });

    proc.on("error", (err) => {
      cleanup();

      if (err.code === "ENOENT") {
        const dependencyMessage = processorBinPath
          ? `Bundled processor not found (tried "${command}").`
          : `Python not found (tried "${pythonBin}"). Install Python 3 and run: pip install opencv-python numpy`;
        reject(new Error(dependencyMessage));
      } else {
        reject(err);
      }
    });
  });
}

module.exports = { processVideo };
