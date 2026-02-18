// Shared constants for the screen recorder app.
// This is the single source of truth for all default settings, IPC channel
// names, and tuning knobs. Never hard-code these values anywhere else.

const path = require("path");
const os = require("os");

// ─── Default user-facing settings ────────────────────────────────────────────
// Keep ALL defaults here. ipc-handlers.js merges settings.json on top of this
// object, so every key always has a value — no inline || fallbacks needed.

const DEFAULT_SETTINGS = {
  fps: 30,
  zoomFactor: 2.0,   // multiplier applied on click zoom
  zoomDuration: 1.5, // seconds to hold the zoomed view
  outputDir: path.join(os.homedir(), "Videos", "ScreenRecorder"),
};

// ─── Zoom / pan tuning ────────────────────────────────────────────────────────

const ZOOM_TRANSITION_TIME = 0.4; // seconds to ease in/out
const MIN_ZOOM_FACTOR = 1.5;
const MAX_ZOOM_FACTOR = 3.0;

// ─── Scroll batching ──────────────────────────────────────────────────────────

const SCROLL_PAN_SPEED = 60;    // pixels per scroll tick
const SCROLL_PAN_DURATION = 0.5; // seconds of smooth pan per scroll event
const SCROLL_COOLDOWN = 0.1;    // seconds — merge scrolls within this window

// ─── Encoding ─────────────────────────────────────────────────────────────────

const RECORDING_MIME_TYPE = "video/webm; codecs=vp9";
const OUTPUT_CODEC = "libx264";
const OUTPUT_CRF = 18;
const OUTPUT_PRESET = "medium";

// ─── Timing ───────────────────────────────────────────────────────────────────

const CHUNK_INTERVAL_MS = 1000;       // MediaRecorder timeslice (ms)
const CLOSE_CLICK_THRESHOLD = 2.0;   // seconds — merge nearby clicks into pan

// ─── File names ───────────────────────────────────────────────────────────────

const RAW_RECORDING_FILE = "recording.webm";
const EVENTS_FILE = "events.json";
const OUTPUT_FILE = "output.mp4";
const SETTINGS_FILE = "settings.json";

// ─── IPC channel names ────────────────────────────────────────────────────────
// Defined once here and imported by both preload.js and ipc-handlers.js.
// The renderer never uses these strings directly — it calls electronAPI methods.

const IPC = {
  // Recording lifecycle
  START_RECORDING:      "recording:start",
  STOP_RECORDING:       "recording:stop",
  SET_CAPTURE_SOURCE:   "recording:set-capture-source",
  PREPARE_RECORDING_UI: "recording:prepare-ui",
  FINISH_RECORDING_UI:  "recording:finish-ui",
  OVERLAY_STOP_REQUEST: "recording:overlay-stop-request",
  SAVE_RECORDING:       "recording:save",

  // Library management
  GET_RECORDINGS:  "recordings:list",
  DELETE_RECORDING: "recordings:delete",

  // Screen sources
  GET_SOURCES: "sources:list",

  // Post-processing
  PROCESS_VIDEO:       "video:process",
  PROCESSING_PROGRESS: "video:progress",
  PROCESSING_DONE:     "video:done",
  PROCESSING_ERROR:    "video:error",

  // Settings
  GET_SETTINGS: "settings:get",
  SET_SETTINGS:  "settings:set",

  // Dialogs & shell
  PICK_OUTPUT_DIR: "dialog:pickOutputDir",
  OPEN_OUTPUT:     "shell:openOutput",
  OPEN_SETTINGS:   "shell:openSettings",
};

module.exports = {
  DEFAULT_SETTINGS,

  // Zoom / pan
  ZOOM_TRANSITION_TIME,
  MIN_ZOOM_FACTOR,
  MAX_ZOOM_FACTOR,

  // Scroll
  SCROLL_PAN_SPEED,
  SCROLL_PAN_DURATION,
  SCROLL_COOLDOWN,

  // Encoding
  RECORDING_MIME_TYPE,
  OUTPUT_CODEC,
  OUTPUT_CRF,
  OUTPUT_PRESET,

  // Timing
  CHUNK_INTERVAL_MS,
  CLOSE_CLICK_THRESHOLD,

  // File names
  RAW_RECORDING_FILE,
  EVENTS_FILE,
  OUTPUT_FILE,
  SETTINGS_FILE,

  // IPC
  IPC,
};
