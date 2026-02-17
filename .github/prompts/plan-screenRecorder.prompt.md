# Plan: Electron Screen Recorder with Auto Zoom/Pan

**TL;DR:** Build an Electron desktop app with a simple GUI (record/stop buttons + settings). It uses Electron's `desktopCapturer` + `MediaRecorder` for screen capture, `uiohook-napi` for global mouse click/scroll tracking, and FFmpeg for post-processing zoom/pan effects. The recording saves as WebM, event data as JSON, then FFmpeg re-encodes to MP4 with dynamically computed `crop+scale` filters based on click/scroll events with smooth easing transitions. `ffmpeg-static` bundles FFmpeg so users don't need to install it.

## Steps

### 1. Initialize the Electron project

Use `@electron-forge/cli` to scaffold the app under `c:\Users\Kushal Prajapati\code\screen_recorder`. Install core dependencies: `electron`, `uiohook-napi`, `ffmpeg-static`, `ffprobe-static`. Set up Electron Forge for packaging.

### 2. Create the project structure

```
src/
├── main/
│   ├── index.js              — Main process: window creation, app lifecycle
│   ├── ipc-handlers.js       — IPC bridge: recording control, file save, post-process trigger
│   ├── input-tracker.js      — uiohook-napi: global click + scroll listener w/ timestamps
│   ├── post-processor.js     — Orchestrate FFmpeg zoom/pan pipeline
│   ├── zoom-engine.js        — Compute per-frame crop rects from events + easing math
│   └── ffmpeg-utils.js       — Spawn FFmpeg, resolve binary path from ffmpeg-static, parse progress
├── preload/
│   └── preload.js            — contextBridge: expose safe recording/settings APIs to renderer
├── renderer/
│   ├── index.html            — UI: record/stop buttons, settings panel, progress bar
│   ├── renderer.js           — MediaRecorder logic, UI state management, IPC calls
│   ├── styles.css            — Minimal clean styling
│   └── easing.js             — Easing functions (easeInOutCubic, smootherstep, etc.)
└── shared/
    └── constants.js          — Default FPS, zoom factor, zoom duration, output dir
```

### 3. Main process (`src/main/index.js`)

Create a `BrowserWindow` (~400×300), register `desktopCapturer.getSources()` as a display media request handler via `session.defaultSession.setDisplayMediaRequestHandler()`, initialize IPC handlers. On app `ready`, create the window. Handle `will-quit` to cleanup `uiohook`.

### 4. Preload bridge (`src/preload/preload.js`)

Use `contextBridge.exposeInMainWorld` to expose:

- `startRecording()` / `stopRecording()` — triggers input tracker in main
- `saveRecording(buffer)` — sends recorded WebM blob to main for disk write
- `processVideo(options)` — triggers FFmpeg post-processing
- `onProgress(callback)` — receives FFmpeg progress updates
- `getSettings()` / `setSettings(config)` — FPS, zoom level, zoom duration, output path

### 5. Screen capture (`src/renderer/renderer.js`)

On "Record" button click:

- Call `navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 } })` to get `MediaStream`
- Create `MediaRecorder` with `mimeType: 'video/webm; codecs=vp9'`
- Collect chunks via `ondataavailable` (interval: 100ms for fine-grained data)
- Record the start timestamp (`Date.now()`) and send to main process via IPC
- On "Stop": stop recorder, combine chunks into `Blob`, convert to `Buffer`, send to main process via `saveRecording(buffer)`
- Main process writes `recording.webm` + `events.json` to the output directory

### 6. Input tracking (`src/main/input-tracker.js`)

On recording start:

- Call `uIOhook.start()` to begin global hook
- Listen for `click` events → store `{ type: 'click', x, y, button, timestamp }` (timestamp relative to recording start)
- Listen for `wheel` events → store `{ type: 'scroll', x, y, rotation, direction, timestamp }`
- On recording stop: call `uIOhook.stop()`, return the event array
- Write events to `events.json` alongside the recording

### 7. Zoom/pan engine (`src/main/zoom-engine.js`)

Core auto-edit logic:

- **Click events:** Generate zoom-in keyframes centered on the click position. Each click triggers a zoom cycle: ease-in to `zoomFactor` (default 2×) over 0.3s → hold for `zoomDuration` (default 1.5s) → ease-out over 0.3s
- **Scroll events:** Generate a smooth pan that follows the scroll direction. On downward scroll, slowly pan the crop window down; on upward, pan up. The pan speed is proportional to `event.rotation`
- **Transitions between events:** If two clicks are close in time (< 2s apart), pan smoothly from one zoom target to the next instead of zooming out and back in
- **Edge clamping:** All computed crop rectangles are clamped so they don't exceed video bounds
- **Function `computeFrameCrops(events, fps, videoWidth, videoHeight, totalDuration)`** — Returns an array of `{ cropX, cropY, cropW, cropH }` per frame, using easing functions for smooth transitions
- Easing: `easeInOutCubic` for zoom, `smootherstep` for pan

### 8. FFmpeg post-processing (`src/main/post-processor.js`)

- **Step 1:** Probe the input WebM with `ffprobe` to get resolution, FPS, duration
- **Step 2:** Call `zoom-engine.js` to compute per-frame crop parameters
- **Step 3:** Build FFmpeg filter expression — since FFmpeg's `crop` filter supports `n` (frame number) in expressions, generate a nested `if(eq(n,0),val0,if(eq(n,1),val1,...))` expression for `x`, `y`, `w`, `h`. For videos with many frames, chunk this into segments or use FFmpeg's `sendcmd` filter with a commands file
- **Optimization for long videos:** Instead of a giant nested expression, split the video into segments at event boundaries using `-ss`/`-to`, apply a fixed or linearly interpolated crop per segment, then concatenate with `concat` demuxer
- **Step 4:** Run `ffmpeg -i recording.webm -vf "crop=...,scale=W:H" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p output.mp4`
- **Progress reporting:** Parse FFmpeg stderr for `frame=` and `time=` to calculate % complete, relay to renderer via IPC

### 9. FFmpeg utilities (`src/main/ffmpeg-utils.js`)

- Resolve FFmpeg binary path from `ffmpeg-static` (`require('ffmpeg-static')`)
- `spawnFfmpeg(args)` — spawn with progress parsing
- `probeVideo(filePath)` — run `ffprobe -v quiet -print_format json -show_streams` and parse output
- Handle DPI-aware coordinate mapping if needed

### 10. UI (`src/renderer/index.html` + `src/renderer/styles.css`)

- **Layout:** Single window with: a large Record/Stop toggle button (red circle), status text, settings panel
- **Settings:** Output directory picker, FPS dropdown (15/24/30/60), zoom factor slider (1.5x–3x), zoom duration slider (0.5s–3s)
- **Post-processing view:** After recording stops, show a "Process" button → progress bar → "Open Output" button
- **Styling:** Clean, minimal dark theme. No heavy UI framework needed — vanilla HTML/CSS/JS

### 11. Packaging

Configure Electron Forge's `forge.config.js`:

- Use `@electron-forge/maker-squirrel` for Windows `.exe` installer
- Mark `ffmpeg-static` and `uiohook-napi` as native dependencies to include their binaries
- Set `asar` to `false` or use `asarUnpack` for native modules and FFmpeg binary

## Verification

- **Recording test:** Start recording, perform some clicks and scrolls, stop. Verify `recording.webm` plays correctly and `events.json` contains accurate timestamped events with correct screen coordinates.
- **Zoom test:** Record a short session with 2-3 clicks in different locations. Run post-processing. Verify the output MP4 shows smooth zoom-in on each click position and zoom-out after.
- **Scroll test:** Record with scroll events. Verify the output pans smoothly in the scroll direction.
- **Edge case:** Click near corners of screen → verify crop doesn't go out of bounds.
- **Package test:** Run `npm run make` and verify the packaged `.exe` works standalone without needing FFmpeg installed.

## Decisions

- **`desktopCapturer` over FFmpeg `gdigrab` for recording:** Simpler setup, GPU-accelerated in Chromium, sufficient quality since FFmpeg re-encodes anyway during post-processing
- **`child_process.spawn` over `fluent-ffmpeg`:** `fluent-ffmpeg` is semi-deprecated and adds unnecessary abstraction for complex filter chains
- **Segment-based FFmpeg processing for long videos:** Avoids generating impossibly long nested expressions; chunk at event boundaries and concatenate
- **`uiohook-napi` over `iohook`:** `iohook` is dead and breaks on modern Electron versions; `uiohook-napi` uses N-API for ABI stability
- **`ffmpeg-static` for bundled FFmpeg:** Zero-install experience — users don't need FFmpeg on PATH
- **WebM VP9 for raw recording, MP4 H.264 for final output:** WebM is the only option from `MediaRecorder`; MP4 is universally playable
