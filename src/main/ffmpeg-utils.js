// FFmpeg / ffprobe helpers — resolve binary paths, spawn processes, parse progress

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// ─── Binary path resolution ────────────────────────────────────────────────────

/** The platform-appropriate executable suffix. */
const EXE = process.platform === "win32" ? ".exe" : "";

/**
 * Resolve the ffmpeg binary path.
 */
function getFfmpegPath() {
  const { app } = require("electron");
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", `ffmpeg${EXE}`);
  }
  return path.join(__dirname, "../../bin", `ffmpeg${EXE}`);
}

/**
 * Resolve the ffprobe binary path.
 * In packaged app: <resourcesPath>/bin/ffprobe.exe
 * In dev:         <repo-root>/bin/ffprobe.exe
 */
function getFfprobePath() {
  const { app } = require("electron");
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", `ffprobe${EXE}`);
  }
  return path.join(__dirname, "../../bin", `ffprobe${EXE}`);
}

// ─── Hardware encoder detection ────────────────────────────────────────────────

/** @type {string | null} Cached result of getBestH264Encoder() after first call. */
let _cachedEncoder = null;

/**
 * Detect the best available H.264 encoder for this machine.
 * Priority: h264_nvenc (NVIDIA) → h264_amf (AMD) → h264_videotoolbox (macOS) → libx264
 *
 * Result is cached after the first call so subsequent exports pay no overhead.
 * @returns {Promise<string>} FFmpeg encoder name
 */
async function getBestH264Encoder() {
  if (_cachedEncoder !== null) return _cachedEncoder;

  const ffmpeg = getFfmpegPath();
  const CANDIDATES = ["h264_nvenc", "h264_amf", "h264_videotoolbox"];

  // Run `ffmpeg -encoders` and check which hardware encoders are listed
  try {
    const encoders = await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, ["-encoders", "-hide_banner"]);
      let out = "";
      proc.stdout.on("data", (d) => {
        out += d.toString();
      });
      proc.stderr.on("data", (d) => {
        out += d.toString();
      });
      proc.on("close", () => resolve(out));
      proc.on("error", reject);
    });

    for (const encoder of CANDIDATES) {
      if (encoders.includes(encoder)) {
        console.log(`[FFmpeg] Hardware encoder available: ${encoder}`);
        _cachedEncoder = encoder;
        return encoder;
      }
    }
  } catch (err) {
    console.warn(`[FFmpeg] Could not probe encoders: ${err.message}`);
  }

  console.log("[FFmpeg] Falling back to software encoder: libx264");
  _cachedEncoder = "libx264";
  return "libx264";
}

/**
 * Return the appropriate quality flags for a given encoder.
 * GPU encoders use -rc/-cq instead of -crf.
 * @param {string} encoder  FFmpeg encoder name
 * @param {number} [quality=18]  Target quality value
 * @returns {string[]}  FFmpeg argument array
 */
function getEncoderQualityFlags(encoder, quality = 18) {
  switch (encoder) {
    case "h264_nvenc":
      return ["-rc", "vbr", "-cq", String(quality), "-preset", "p4"];
    case "h264_amf":
      return ["-qp_i", String(quality), "-qp_p", String(quality)];
    case "h264_videotoolbox":
      return ["-q:v", String(quality)];
    default: // libx264 and any unknown
      return ["-crf", String(quality), "-preset", "medium"];
  }
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
    "-c:a",
    "aac",
    "-b:a",
    "192k", // keep audio if present
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

/**
 * Trim a clean MP4 to a specific time range with frame-accurate cuts.
 *
 * @param {string}   inputPath   Path to the source MP4
 * @param {string}   outputPath  Path for the trimmed MP4
 * @param {number}   startTime   Start time in seconds
 * @param {number}   endTime     End time in seconds
 * @param {function} [onProgress] Optional progress callback
 * @returns {Promise<string>} outputPath
 */
function trimVideo(
  inputPath,
  outputPath,
  startTime,
  endTime,
  onProgress = null,
) {
  const duration = endTime - startTime;
  console.log(
    `[FFmpeg] Trimming ${startTime.toFixed(2)}s → ${endTime.toFixed(2)}s (${duration.toFixed(2)}s)`,
  );

  const args = [
    "-i",
    inputPath,
    "-ss",
    String(startTime),
    "-to",
    String(endTime),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "14",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k", // keep audio if present
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];

  const { promise } = spawnFfmpeg(args, onProgress, duration);
  return promise.then(() => {
    console.log(`[FFmpeg] Trimmed video ready: ${outputPath}`);
    return outputPath;
  });
}

/**
 * Mux audio from audioSourcePath into a video-only file.
 * Uses stream copy for video (no re-encode) and AAC for audio.
 * Safe to call on an audio-less audioSource — output will just be video-only.
 *
 * @param {string} videoPath       Video-only source
 * @param {string} audioSourcePath File that carries the desired audio track
 * @param {string} outputPath      Destination MP4
 * @returns {Promise<string>}      outputPath
 */
function muxAudioInto(videoPath, audioSourcePath, outputPath) {
  const args = [
    "-i",
    videoPath,
    "-i",
    audioSourcePath,
    "-map",
    "0:v:0",
    "-map",
    "1:a?",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];
  const { promise } = spawnFfmpeg(args, null, 0);
  return promise.then(() => {
    console.log(`[FFmpeg] Audio muxed → ${outputPath}`);
    return outputPath;
  });
}

/* ─── Hex-to-RGB helper ────────────────────────────────────────────── */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/**
 * Apply Screen-Studio-style visual polish: rounded corners + coloured
 * background with padding.  Pure FFmpeg — no Python / OpenCV needed.
 *
 * When corner-radius > 0, a one-frame alpha mask PNG is pre-generated
 * and fed to `alphamerge` — orders of magnitude faster than the old
 * per-frame `geq` approach.
 *
 * Uses the best available hardware encoder (NVENC → AMF → VideoToolbox → libx264)
 * for significantly faster export on GPU-equipped systems.
 *
 * @param {string}   inputPath    Clean MP4 (output of remuxToCleanMp4 or auto-zoom)
 * @param {string}   outputPath   Final polished MP4
 * @param {object}   opts         Visual options
 * @param {function} [onProgress] Progress callback ({ percent, frame, time })
 * @param {string}   [encoder]    FFmpeg encoder override (auto-detected if omitted)
 * @returns {Promise<string>}  outputPath on success
 */
async function applyVisualExport(
  inputPath,
  outputPath,
  opts = {},
  onProgress = null,
  encoder = null,
) {
  const {
    cornerRadius = 12,
    padding = 48,
    backgroundType = "solid",
    backgroundColor = "#6366f1",
    gradientStart = "#667eea",
    gradientEnd = "#764ba2",
    wallpaperPath = null,
    imageBlur = "none", // 'none' | 'moderate' | 'strong'
  } = opts;

  // Resolve encoder lazily (cached after first call)
  const enc = encoder ?? (await getBestH264Encoder());
  const qualityFlags = getEncoderQualityFlags(enc, 18);

  const info = await probeVideo(inputPath);
  const { width: srcW, height: srcH, duration, fps, nbFrames } = info;

  // Output canvas = video + padding on each side, ensure even dimensions
  const rawW = srcW + padding * 2;
  const rawH = srcH + padding * 2;
  const finalW = rawW + (rawW % 2);
  const finalH = rawH + (rawH % 2);

  // Clamp corner radius to something sensible
  const R = Math.max(
    0,
    Math.min(cornerRadius, Math.floor(Math.min(srcW, srcH) / 4)),
  );

  const outFps =
    Number.isFinite(Number(fps)) && Number(fps) > 0
      ? Math.round(Number(fps))
      : 30;

  const frameCount =
    Number.isFinite(nbFrames) && nbFrames > 0 ? Math.round(nbFrames) : 0;

  // ── Pre-generate alpha mask PNG for rounded corners ──────────────────────
  // geq evaluates a math expression for every pixel of every frame — extremely
  // slow.  Instead we render ONE frame of the mask to a PNG, then feed that
  // static image into `alphamerge`.  The per-frame cost becomes a trivial
  // texture lookup instead of a full per-pixel expression evaluation.
  const { app } = require("electron");
  const maskPath =
    R > 0
      ? path.join(app.getPath("temp"), `orb_mask_${srcW}x${srcH}_r${R}.png`)
      : null;

  if (R > 0) {
    const alphaExpr = `if(gt(abs(W/2-X),W/2-${R})*gt(abs(H/2-Y),H/2-${R}),if(lte(hypot(${R}-(W/2-abs(W/2-X)),${R}-(H/2-abs(H/2-Y))),${R}),255,0),255)`;
    console.log(
      `[FFmpeg] Generating rounded-corner mask (${srcW}x${srcH} r=${R})…`,
    );
    const maskArgs = [
      "-f",
      "lavfi",
      "-i",
      `color=white:s=${srcW}x${srcH}:d=0.04`,
      "-vf",
      `format=gray,geq=lum='${alphaExpr}'`,
      "-frames:v",
      "1",
      "-y",
      maskPath,
    ];
    const { promise: maskPromise } = spawnFfmpeg(maskArgs);
    await maskPromise;
    console.log("[FFmpeg] Mask generated.");
  }

  /** Clean up temp mask on completion or failure. */
  function cleanupMask() {
    if (maskPath && fs.existsSync(maskPath)) {
      try {
        fs.unlinkSync(maskPath);
      } catch (_) {}
    }
  }

  try {
    // ── Image background path ──────────────────────────────────────────────
    if (backgroundType === "image" && wallpaperPath) {
      const blurSigma =
        imageBlur === "moderate" ? 10 : imageBlur === "strong" ? 25 : 0;
      const blurFilter = blurSigma > 0 ? `,gblur=sigma=${blurSigma}` : "";

      let filterComplex;
      if (R > 0) {
        // [0]=video  [1]=wallpaper  [2]=mask (looped static PNG)
        filterComplex = [
          `[1:v]scale=${finalW}:${finalH},setsar=1${blurFilter}[bg]`,
          `[0:v]format=yuva420p[vid]`,
          `[2:v]format=gray[mask]`,
          `[vid][mask]alphamerge[rounded]`,
          `[bg][rounded]overlay=(W-w)/2:(H-h)/2,format=yuv420p[vout]`,
        ].join(";");
      } else {
        filterComplex = [
          `[1:v]scale=${finalW}:${finalH},setsar=1${blurFilter}[bg]`,
          `[bg][0:v]overlay=(W-w)/2:(H-h)/2,format=yuv420p[vout]`,
        ].join(";");
      }

      console.log(
        `[FFmpeg] Image background: ${wallpaperPath}  blur=${imageBlur}  encoder=${enc}`,
      );

      const args = [
        "-i",
        inputPath,
        "-i",
        wallpaperPath,
        ...(R > 0 ? ["-loop", "1", "-i", maskPath] : []),
        "-filter_complex",
        filterComplex,
        "-map",
        "[vout]",
        "-map",
        "0:a?",
        "-c:v",
        enc,
        ...qualityFlags,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(outFps),
        ...(frameCount > 0 ? ["-frames:v", String(frameCount)] : []),
        "-shortest",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ];

      const { promise } = spawnFfmpeg(args, onProgress, duration);
      await promise;
      console.log(`[FFmpeg] Image background export done → ${outputPath}`);
      cleanupMask();
      return outputPath;
    }

    // ── Solid / gradient color background (lavfi) ──────────────────────────
    let bgHex = backgroundColor;
    if (backgroundType === "gradient") {
      const [r1, g1, b1] = hexToRgb(gradientStart);
      const [r2, g2, b2] = hexToRgb(gradientEnd);
      const rm = Math.round((r1 + r2) / 2)
        .toString(16)
        .padStart(2, "0");
      const gm = Math.round((g1 + g2) / 2)
        .toString(16)
        .padStart(2, "0");
      const bm = Math.round((b1 + b2) / 2)
        .toString(16)
        .padStart(2, "0");
      bgHex = `#${rm}${gm}${bm}`;
    }

    const bgColor = bgHex.replace("#", "0x");

    // ── Build filter_complex (video [0] + lavfi bg [1] + optional mask [2]) ─
    let filterComplex;
    if (R > 0) {
      // Mask-based rounded corners:  [0]=video  [1]=bg  [2]=mask
      filterComplex = [
        `[0:v]format=yuva420p[vid]`,
        `[2:v]format=gray[mask]`,
        `[vid][mask]alphamerge[rounded]`,
        `[1:v][rounded]overlay=(W-w)/2:(H-h)/2,format=yuv420p[vout]`,
      ].join(";");
    } else {
      filterComplex = `[1:v][0:v]overlay=(W-w)/2:(H-h)/2,format=yuv420p[vout]`;
    }

    console.log(`[FFmpeg] Visual export encoder=${enc}  mask=${R > 0}`);

    const args = [
      "-i",
      inputPath,
      "-f",
      "lavfi",
      "-i",
      `color=${bgColor}:s=${finalW}x${finalH}:r=${outFps}`,
      ...(R > 0 ? ["-loop", "1", "-i", maskPath] : []),
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      enc,
      ...qualityFlags,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(outFps),
      ...(frameCount > 0 ? ["-frames:v", String(frameCount)] : []),
      "-shortest",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ];

    const { promise } = spawnFfmpeg(args, onProgress, duration);
    try {
      await promise;
      console.log(`[FFmpeg] Visual export done → ${outputPath}`);
      cleanupMask();
      return outputPath;
    } catch (err) {
      // On filter failure, fall back to simple pad filter without rounded corners.
      console.warn(
        `[FFmpeg] Rounded export failed (${err.message}), retrying with pad fallback…`,
      );

      const fallbackArgs = [
        "-i",
        inputPath,
        "-vf",
        `pad=${finalW}:${finalH}:(ow-iw)/2:(oh-ih)/2:color=${bgColor}`,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        enc,
        ...qualityFlags,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(outFps),
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ];

      const { promise: fallbackPromise } = spawnFfmpeg(
        fallbackArgs,
        onProgress,
        duration,
      );
      await fallbackPromise;
      console.log(`[FFmpeg] Fallback visual export done → ${outputPath}`);
      cleanupMask();
      return outputPath;
    }
  } catch (err) {
    cleanupMask();
    throw err;
  }
}

module.exports = {
  getFfmpegPath,
  getFfprobePath,
  probeVideo,
  spawnFfmpeg,
  muxAudioInto,
  remuxToCleanMp4,
  applyVisualExport,
  trimVideo,
  hexToRgb,
  getBestH264Encoder,
  getEncoderQualityFlags,
};
