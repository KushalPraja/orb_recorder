// FFmpeg / ffprobe helpers — resolve binary paths, spawn processes, parse progress

const { spawn } = require("child_process");

/**
 * Resolve the ffmpeg binary path from ffmpeg-static.
 * Handles both development (node_modules) and packaged (asar unpacked) scenarios.
 */
function getFfmpegPath() {
  let fp = require("ffmpeg-static");
  // When packaged, ffmpeg-static may return a path inside app.asar — fix it
  if (fp && fp.includes("app.asar")) {
    fp = fp.replace("app.asar", "app.asar.unpacked");
  }
  return fp;
}

/**
 * Resolve the ffprobe binary path from ffprobe-static.
 */
function getFfprobePath() {
  let fp = require("ffprobe-static").path;
  if (fp && fp.includes("app.asar")) {
    fp = fp.replace("app.asar", "app.asar.unpacked");
  }
  return fp;
}

/**
 * Probe a video file and return metadata (width, height, fps, duration).
 * @param {string} filePath  Absolute path to the video file
 * @returns {Promise<{width: number, height: number, fps: number, duration: number}>}
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = getFfprobePath();
    const args = [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      "-count_frames",
      filePath,
    ];
    const proc = spawn(ffprobe, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
      try {
        const data = JSON.parse(stdout);
        const videoStream = data.streams.find((s) => s.codec_type === "video");
        if (!videoStream) {
          return reject(new Error("No video stream found"));
        }
        let fps = 30;
        if (
          videoStream.avg_frame_rate &&
          videoStream.avg_frame_rate !== "0/0"
        ) {
          const [num, den] = videoStream.avg_frame_rate.split("/").map(Number);
          if (den && num / den > 1 && num / den < 240) fps = num / den;
        } else if (videoStream.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
          const candidate = den ? num / den : num;
          // r_frame_rate of 1000 is a VFR timebase, not a real fps
          if (candidate > 1 && candidate < 120) fps = candidate;
        }

        // ── Duration ─────────────────────────────────────────────
        let duration = parseFloat(
          data.format?.duration || videoStream.duration || "0",
        );

        if (!Number.isFinite(duration) || duration <= 0) {
          const taggedDuration =
            videoStream.tags?.DURATION || data.format?.tags?.DURATION;
          if (taggedDuration && /^\d+:\d+:\d+(\.\d+)?$/.test(taggedDuration)) {
            const [hh, mm, ss] = taggedDuration.split(":");
            duration = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
          }
        }

        // Last resort: count actual frames (nb_read_frames from -count_frames)
        const nbFrames = parseInt(
          videoStream.nb_read_frames || videoStream.nb_frames || "0",
          10,
        );
        if ((!Number.isFinite(duration) || duration <= 0) && nbFrames > 0) {
          duration = nbFrames / fps;
        }

        if (!Number.isFinite(duration) || duration < 0) {
          duration = 0;
        }

        resolve({
          width: parseInt(videoStream.width, 10),
          height: parseInt(videoStream.height, 10),
          fps: Math.round(fps),
          duration,
          nbFrames,
        });
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${err.message}`));
      }
    });
  });
}

/**
 * Spawn an FFmpeg process with the given arguments.
 * Returns an object with the child process and a promise that resolves on completion.
 *
 * @param {string[]} args          FFmpeg arguments
 * @param {function} onProgress    Callback receiving { frame, time, percent } updates
 * @param {number}   totalDuration Total video duration in seconds (for percent calculation)
 * @returns {{ proc: ChildProcess, promise: Promise<void> }}
 */
function spawnFfmpeg(args, onProgress = null, totalDuration = 0) {
  const ffmpeg = getFfmpegPath();
  const proc = spawn(ffmpeg, args);

  let stderr = "";

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;

    if (onProgress && totalDuration > 0) {
      // Parse "time=00:01:23.45" from FFmpeg stderr
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      const frameMatch = text.match(/frame=\s*(\d+)/);

      if (timeMatch) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        const percent = Math.min(
          100,
          Math.round((currentTime / totalDuration) * 100),
        );
        const frame = frameMatch ? parseInt(frameMatch[1], 10) : 0;

        onProgress({ frame, time: currentTime, percent });
      }
    }
  });

  const promise = new Promise((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-500)}`),
        );
      }
    });
    proc.on("error", reject);
  });

  return { proc, promise };
}

/**
 * Re-encode a WebM to a clean intermediate MP4 with correct timestamps.
 * This fixes VFR → CFR, adds proper duration, and produces reliable metadata.
 *
 * @param {string} inputPath   Path to the source WebM
 * @param {string} outputPath  Path for the intermediate MP4
 * @param {function} [onProgress] Optional progress callback
 * @param {number} [targetFps] Target constant frame rate for output
 * @returns {Promise<string>} outputPath
 */
function remuxToCleanMp4(
  inputPath,
  outputPath,
  onProgress = null,
  targetFps = 30,
) {
  console.log("[FFmpeg] Re-encoding to clean intermediate MP4…");

  const fps =
    Number.isFinite(Number(targetFps)) && Number(targetFps) > 0
      ? Math.round(Number(targetFps))
      : 30;

  const args = [
    "-i",
    inputPath,
    "-vf",
    `fps=${fps}`,
    "-vsync",
    "cfr",
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast", // speed — this is just an intermediate file
    "-crf",
    "14", // near-lossless quality
    "-pix_fmt",
    "yuv420p",
    "-an", // drop audio (screen recording)
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];

  const { promise } = spawnFfmpeg(args, onProgress, 0);
  return promise.then(() => {
    console.log(`[FFmpeg] Intermediate MP4 ready: ${outputPath}`);
    return outputPath;
  });
}

module.exports = {
  getFfmpegPath,
  getFfprobePath,
  probeVideo,
  spawnFfmpeg,
  remuxToCleanMp4,
};
