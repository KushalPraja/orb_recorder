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
  zoomFactor: 2.0, // multiplier applied on click zoom
  zoomDuration: 1.5, // seconds to hold the zoomed view
  outputDir: path.join(os.homedir(), "Videos", "ScreenRecorder"),
  overlayPosition: "bottom-center",
};

// ─── Scroll batching ──────────────────────────────────────────────────────────

const SCROLL_COOLDOWN = 0.1; // seconds — merge scrolls within this window

// ─── File names ───────────────────────────────────────────────────────────────

const RAW_RECORDING_FILE = "recording.webm";
const EVENTS_FILE = "events.json";
const OUTPUT_FILE = "output.mp4";
const CLEAN_MP4_FILE = "preview.mp4";
const SETTINGS_FILE = "settings.json";
const META_FILE = "meta.json";

// ─── IPC channel names ────────────────────────────────────────────────────────
// Defined once here and imported by both preload.js and ipc-handlers.js.
// The renderer never uses these strings directly — it calls electronAPI methods.

const IPC = {
  // Recording lifecycle
  START_RECORDING: "recording:start",
  STOP_RECORDING: "recording:stop",
  SET_CAPTURE_SOURCE: "recording:set-capture-source",
  PREPARE_RECORDING_UI: "recording:prepare-ui",
  FINISH_RECORDING_UI: "recording:finish-ui",
  OVERLAY_STOP_REQUEST: "recording:overlay-stop-request",
  OVERLAY_PAUSE_REQUEST: "recording:overlay-pause-request",
  OVERLAY_RESUME_REQUEST: "recording:overlay-resume-request",
  OVERLAY_DISCARD_REQUEST: "recording:overlay-discard-request",
  SAVE_RECORDING: "recording:save",

  // Library management
  GET_RECORDINGS: "recordings:list",
  DELETE_RECORDING: "recordings:delete",
  RENAME_RECORDING: "recordings:rename",

  // Export
  PICK_EXPORT_PATH: "dialog:pickExportPath",

  // Screen sources
  GET_SOURCES: "sources:list",

  // Post-processing
  REMUX_VIDEO: "video:remux",
  PROCESS_VIDEO: "video:process",
  PROCESSING_PROGRESS: "video:progress",
  PROCESSING_DONE: "video:done",
  PROCESSING_ERROR: "video:error",

  // Settings
  GET_SETTINGS: "settings:get",
  SET_SETTINGS: "settings:set",

  // Dialogs & shell
  PICK_OUTPUT_DIR: "dialog:pickOutputDir",
  OPEN_OUTPUT: "shell:openOutput",
  OPEN_SETTINGS: "shell:openSettings",
};

module.exports = {
  DEFAULT_SETTINGS,
  // Scroll batching
  SCROLL_COOLDOWN,
  // File names
  RAW_RECORDING_FILE,
  EVENTS_FILE,
  OUTPUT_FILE,
  CLEAN_MP4_FILE,
  SETTINGS_FILE,
  META_FILE,
  // IPC
  IPC,
};
