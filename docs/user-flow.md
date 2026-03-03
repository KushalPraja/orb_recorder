# ORB -> RECORDER

---

## Phase 1: TypeScript Migration & Main Process Restructure

**TypeScript tooling** — Install `typescript`, `@types/node`, `@types/react`. Configure `tsconfig.json` for main (Node/CommonJS target) and renderer (ESNext/JSX). Update `vite.config.js` and `forge.config.js` to handle `.ts`/`.tsx` extensions.

**Handler routing file** — New `src/main/ipc.ts` following the desired pattern: thin `registerIpcHandlers()` that imports from `./handlers/*` and maps IPC channel constants to handler functions. Each handler file exports named functions only.

**Split `ipc-handlers.js` (846 lines) into domain handlers:**

- `src/main/handlers/app.ts` — window minimize/maximize/close, title bar overlay
- `src/main/handlers/recording.ts` — handleStartRecording, handleStopRecording, handleSaveRecording, prepareRecordingUI, finishRecordingUI, overlay relay handlers (~L264–500)
- `src/main/handlers/sources.ts` — getSources with thumbnail generation (~L693–730)
- `src/main/handlers/export.ts` — processVideo, remuxVideo, progress forwarding (~L517–640)
- `src/main/handlers/settings.ts` — getSettings, setSettings (~L642–654)
- `src/main/handlers/file-system.ts` — pickOutputDir, pickExportPath (~L655–840)
- `src/main/handlers/shell.ts` — openOutput, openSettings (~L667–690)
- `src/main/handlers/recordings.ts` — listRecordings, deleteRecording, renameRecording (~L730–815)

**Extract window factories** — Move BrowserWindow creation logic from `index.js` and inline HTML from `ipc-handlers.js` (countdown overlay at ~L104, recording overlay at ~L170) into:

- `src/main/windows/main-window.ts`
- `src/main/windows/overlay-window.ts`
- `src/main/windows/countdown-window.ts`

**Extract services** — Move `InputTracker` class from `input-tracker.js` → `src/main/services/input-tracker.ts`. Move ffmpeg utils from `ffmpeg-utils.js` → `src/main/services/ffmpeg.ts`.

**Fix unhandled IPC channel** — `recording:overlay-resize` is sent from `recording-overlay.html` but never handled. Add handler in `recording.ts` or remove the send.

---

## Phase 2: Cross-Platform Abstraction

**Platform service interface** — Define `PlatformService` in `src/main/platform/types.ts` with methods:

- `getWindowBounds(sourceId: string): Promise<{x, y, width, height}>` — replaces HWND-specific `getWindowBoundsFromHwnd()` at `ipc-handlers.js:233`
- `getAudioSources(): Promise<AudioSource[]>` — replaces DShow-specific device enumeration
- `getCursorScale(): number`
- `getSourceIdFromElectronId(id: string): string` — abstracts `window:HWND:0` parsing at `ipc-handlers.js:338`
- `checkCapturePermissions(): Promise<boolean>` — macOS screen recording permission check

**Platform backends:**

- `src/main/platform/windows.ts` — extract existing HWND logic from `ipc-handlers.js` and `process.py _hwnd_bounds_mode()`. Use `screen_processor --hwnd` binary or native Node addon.
- `src/main/platform/darwin.ts` — use `CGWindowListCopyWindowInfo` via native addon or Electron's `systemPreferences.getMediaAccessStatus('screen')`. For audio, detect/guide virtual audio device setup (BlackHole/Loopback).
- `src/main/platform/linux.ts` — X11 `xdotool`/`xwininfo` for window bounds, PipeWire/PulseAudio for audio sources.

**Replace all hardcoded platform checks** — Every `process.platform === 'win32'` in `ipc-handlers.js`, `post-processor.js`, `ffmpeg-utils.js` gets replaced with calls to the platform service.

**Add macOS/Linux makers to Forge config** — Update `forge.config.js` to include `@electron-forge/maker-dmg` (macOS) and `@electron-forge/maker-deb`/`maker-rpm` (Linux).

---

## Phase 3: Replace Python Processor with ffmpeg Filters

**Design the ffmpeg filter chain** — Replace `process.py` (800+ lines Python/OpenCV) with ffmpeg's built-in filters:

- **Zoom/pan:** `zoompan` filter with keyframe expressions, OR `crop` + `scale` filters chained. The `zoompan` filter supports `zoom`, `x`, `y` expressions referencing frame number `n` — perfect for keyframe interpolation.
- **Background:** `pad` filter for padding + `color` source for solid/gradient, OR `overlay` filter to composite video onto a background image/color.
- **Corner radius:** `format=yuva420p,geq` with circular mask, or `alphaextract`+`alphamerge` with a rounded rectangle mask image generated once.
- **Click ripple:** Generate overlay sprites with `drawtext`/`drawbox` filters timed to click events, or pre-render click animations as transparent PNGs and overlay.

**Zoom engine service** — New `src/main/services/zoom-engine.ts`:

- Input: array of `ZoomKeyframe` objects (timestamp, x, y, zoomLevel, easing)
- Output: ffmpeg filter graph string with interpolated expressions
- Port the `SmoothCamera` smoothing math from `process.py:176` to TypeScript for both preview AND filter generation
- Support auto-zoom (from click events) and manual zoom (from user-placed keyframes)

**Update export pipeline** — New `src/main/services/export-pipeline.ts` replaces `post-processor.js`:

1. Generate zoom keyframes (auto from `events.json` + manual from user edits)
2. Build ffmpeg complex filter graph (zoom + background + padding + radius + click effects)
3. Single ffmpeg pass with hardware encoding
4. Progress reporting via ffmpeg stderr parsing (already partially in `ffmpeg-utils.js`)

**Remove Python dependency** — Delete `process.py`, `build-processor.js`, and the `bin/screen_processor` binary requirement. Remove PyInstaller from build steps. This dramatically simplifies cross-platform distribution.

---

## Phase 4: Real-Time Zoom Preview (CSS Transforms)

**Add zoom preview layer in ReviewPage** — In `ReviewPage.jsx` (→ `.tsx`):

- Wrap the `<video>` element in a container with `overflow: hidden`
- On each `requestAnimationFrame`, compute the current zoom state from the keyframe timeline + current playback time
- Apply CSS `transform: scale(z) translate(x, y)` to the video element
- This gives instant zoom preview with zero processing cost
- Add a background layer behind the video (solid/gradient/image) visible when zoom reveals padding

**Port SmoothCamera to TypeScript** — Create a shared `SmoothCamera` class usable by both the preview renderer and the export zoom engine. Same exponential smoothing math from `process.py:176`, but in TypeScript:

- `update(targetX, targetY, targetZoom, dt)` → returns smoothed `{x, y, zoom}`
- Configurable easing constants (snap, follow, recenter)
- Frame-rate-independent via delta-time

---

## Phase 5: Manual Zoom Editing on Timeline

**Add zoom track to timeline UI** — Below the existing trim timeline in ReviewPage, add a second track showing zoom keyframes:

- Each keyframe is a draggable marker on the timeline (timestamp + zoom level)
- Click to add a new keyframe at current playback position
- Drag to reposition in time, scroll/input to change zoom level
- Right-click to delete
- Auto-zoom keyframes (from click events) shown in a different color, editable

**Define zoom keyframe data model** — In `src/shared/types.ts`:

- Auto keyframes generated from `events.json` click data
- Manual keyframes added/edited by user
- Both types merged and sorted by timestamp for preview and export

**Persist zoom edits** — Save zoom keyframe data to the session directory (e.g., `zoom-keyframes.json`) alongside `meta.json` and `events.json`. Load on ReviewPage mount.

---

## Phase 6: Remaining v1 Items

- **Fix `recording:overlay-resize`** — Either handle it in the main process or remove the dead `ipcRenderer.send` from `recording-overlay.html`.
- **Remove stale remux step** — The post-recording flow now produces MP4 directly, so the 0–40% "remux" export step is redundant. Remove from pipeline.
- **Remove unused dependencies** — `react-router-dom` is listed in `package.json` but never imported. Remove it or start using it.
- **Rewrite docs** — Replace everything in `docs/` with accurate documentation: `architecture.md`, `development-guide.md`, `cross-platform.md`. Update `README.md` accordingly.
- **Renderer TypeScript migration** — Rename `.jsx`/`.js` → `.tsx`/`.ts`. Add type annotations. Keep the existing structure.

---

## Verification Checklist

- `npx tsc --noEmit` passes with zero errors
- Build and test on Windows, macOS (Intel + ARM), and Linux (Ubuntu) — verify screen capture, window capture, audio recording, overlay, export
- Play a recording in ReviewPage — verify CSS transform zoom matches timeline keyframes in real-time with no lag
- Export a recording with zoom keyframes — compare visual output to CSS preview (should match closely)
- Benchmark ffmpeg filter chain export vs old Python/OpenCV pipeline — target 5–10× faster
- Add, move, delete keyframes on timeline — verify preview updates instantly and export includes them
- Ensure `npm start` and `npm run make` work without Python installed

---

## Key Decisions

| Decision | Rationale |
|---|---|
| CSS transform preview over Canvas/WebGL | Simpler, GPU-accelerated by default, matches Screen Studio's approach |
| Pure ffmpeg filters over Python/OpenCV | Eliminates Python dependency, 5–10× faster exports, truly cross-platform without PyInstaller |
| TypeScript migration now | Harder upfront but prevents accumulating more untyped code before restructure |
| Platform service abstraction | Single interface, three implementations — no more scattered `if (win32)` checks |
| Keep renderer structure | Already well-organized, just rename to `.tsx` |

---

## Target File Structure

```
src/
  main/
    index.ts                      # App entry, BrowserWindow creation, lifecycle
    preload.ts                    # contextBridge API
    ipc.ts                        # registerIpcHandlers() — thin routing only
    windows/
      main-window.ts
      overlay-window.ts
      countdown-window.ts
    handlers/
      app.ts
      recording.ts
      sources.ts
      export.ts
      settings.ts
      file-system.ts
      shell.ts
      recordings.ts
    services/
      input-tracker.ts
      ffmpeg.ts
      export-pipeline.ts
      zoom-engine.ts
      session-manager.ts
    platform/
      index.ts
      types.ts
      windows.ts
      darwin.ts
      linux.ts
    constants.ts
  renderer/
    (keep as-is, already well-structured)
  shared/
    types.ts                      # ZoomKeyframe, RecordingMeta, ExportOptions, etc.
    constants.ts                  # IPC channel strings
```