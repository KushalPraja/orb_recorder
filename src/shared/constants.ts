// Shared constants for the Orb screen recorder app.
// Single source of truth for all default settings, IPC channel names, and
// tuning knobs.  Imported by both main process and preload — never
// hard-code these values anywhere else.

import path from 'path';
import os from 'os';
import type { AppSettings, OverlayPosition } from './types';

// ─── Default user-facing settings ────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  fps: 30,
  zoomFactor: 2.0,
  zoomDuration: 1.5,
  outputDir: path.join(os.homedir(), 'Videos', 'ScreenRecorder'),
  overlayPosition: 'bottom-center' as OverlayPosition,
};

// ─── Scroll batching ──────────────────────────────────────────────────────────

export const SCROLL_COOLDOWN = 0.1; // seconds — merge scrolls within this window

// ─── File names ───────────────────────────────────────────────────────────────

export const RAW_RECORDING_FILE = 'recording.webm';
export const EVENTS_FILE = 'events.json';
export const OUTPUT_FILE = 'output.mp4';
export const CLEAN_MP4_FILE = 'preview.mp4';
export const SETTINGS_FILE = 'settings.json';
export const META_FILE = 'meta.json';
export const ZOOM_KEYFRAMES_FILE = 'zoom-keyframes.json';

// ─── IPC channel names ───────────────────────────────────────────────────────
// Defined once here and imported by both preload and handler modules.
// The renderer never uses these strings directly — it calls electronAPI methods.

export const IPC = {
  // Recording lifecycle
  START_RECORDING: 'recording:start',
  STOP_RECORDING: 'recording:stop',
  SET_CAPTURE_SOURCE: 'recording:set-capture-source',
  PREPARE_RECORDING_UI: 'recording:prepare-ui',
  FINISH_RECORDING_UI: 'recording:finish-ui',
  OVERLAY_STOP_REQUEST: 'recording:overlay-stop-request',
  OVERLAY_PAUSE_REQUEST: 'recording:overlay-pause-request',
  OVERLAY_RESUME_REQUEST: 'recording:overlay-resume-request',
  OVERLAY_DISCARD_REQUEST: 'recording:overlay-discard-request',
  OVERLAY_RESIZE: 'recording:overlay-resize',
  SAVE_RECORDING: 'recording:save',

  // Library management
  GET_RECORDINGS: 'recordings:list',
  DELETE_RECORDING: 'recordings:delete',
  RENAME_RECORDING: 'recordings:rename',

  // Export
  PICK_EXPORT_PATH: 'dialog:pickExportPath',

  // Screen sources
  GET_SOURCES: 'sources:list',

  // Post-processing
  REMUX_VIDEO: 'video:remux',
  PROCESS_VIDEO: 'video:process',
  PROCESSING_PROGRESS: 'video:progress',
  PROCESSING_DONE: 'video:done',
  PROCESSING_ERROR: 'video:error',

  // Settings
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',

  // Events loading
  LOAD_EVENTS: 'events:load',

  // Dialogs & shell
  PICK_OUTPUT_DIR: 'dialog:pickOutputDir',
  OPEN_OUTPUT: 'shell:openOutput',
  OPEN_SETTINGS: 'shell:openSettings',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
