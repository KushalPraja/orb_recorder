// Shared constants for the screen recorder app

const path = require('path');
const os = require('os');

module.exports = {
  // Recording defaults
  DEFAULT_FPS: 30,
  DEFAULT_OUTPUT_DIR: path.join(os.homedir(), 'Videos', 'ScreenRecorder'),

  // Zoom settings
  DEFAULT_ZOOM_FACTOR: 2.0,       // 2x zoom on click
  DEFAULT_ZOOM_DURATION: 1.5,     // seconds to hold zoom
  ZOOM_TRANSITION_TIME: 0.4,      // seconds to ease in/out
  MIN_ZOOM_FACTOR: 1.5,
  MAX_ZOOM_FACTOR: 3.0,

  // Scroll pan settings
  SCROLL_PAN_SPEED: 60,           // pixels per scroll tick
  SCROLL_PAN_DURATION: 0.5,       // seconds of smooth pan per scroll event
  SCROLL_COOLDOWN: 0.1,           // seconds — merge scrolls within this window

  // Encoding settings
  RECORDING_MIME_TYPE: 'video/webm; codecs=vp9',
  OUTPUT_CODEC: 'libx264',
  OUTPUT_CRF: 18,
  OUTPUT_PRESET: 'medium',

  // Timing
  CHUNK_INTERVAL_MS: 100,         // MediaRecorder chunk interval
  CLOSE_CLICK_THRESHOLD: 2.0,     // seconds — merge nearby clicks into pan instead of separate zooms

  // File names
  RAW_RECORDING_FILE: 'recording.webm',
  EVENTS_FILE: 'events.json',
  OUTPUT_FILE: 'output.mp4',

  // Settings file name
  SETTINGS_FILE: 'settings.json',

  // IPC channels
  IPC: {
    START_RECORDING: 'recording:start',
    STOP_RECORDING: 'recording:stop',
    PREPARE_RECORDING_UI: 'recording:prepare-ui',
    FINISH_RECORDING_UI: 'recording:finish-ui',
    SAVE_RECORDING: 'recording:save',
    GET_RECORDINGS: 'recordings:list',
    DELETE_RECORDING: 'recordings:delete',
    GET_SOURCES: 'sources:list',
    PROCESS_VIDEO: 'video:process',
    PROCESSING_PROGRESS: 'video:progress',
    PROCESSING_DONE: 'video:done',
    PROCESSING_ERROR: 'video:error',
    GET_SETTINGS: 'settings:get',
    SET_SETTINGS: 'settings:set',
    PICK_OUTPUT_DIR: 'dialog:pickOutputDir',
    OPEN_OUTPUT: 'shell:openOutput',
  }
};
