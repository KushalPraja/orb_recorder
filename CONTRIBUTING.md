# Contributing to Screen Recorder

Thank you for taking the time to contribute! This document covers everything
you need to understand the codebase, get a dev environment running, and submit
good pull requests.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Getting Started](#2-getting-started)
3. [Project Structure](#3-project-structure)
4. [Architecture Overview](#4-architecture-overview)
5. [Settings — the Single Source of Truth](#5-settings--the-single-source-of-truth)
6. [IPC Communication](#6-ipc-communication)
7. [Adding a New Setting](#7-adding-a-new-setting)
8. [Adding a New IPC Channel](#8-adding-a-new-ipc-channel)
9. [The Python Post-Processor](#9-the-python-post-processor)
10. [Build & Package](#10-build--package)
11. [Code Style](#11-code-style)
12. [Pull Request Checklist](#12-pull-request-checklist)

---

## 1. Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 20 LTS | Use `nvm` or `fnm` to manage versions |
| pnpm | 9 | `npm i -g pnpm` |
| Python | 3.10 | Only needed to rebuild the video processor binary |
| Git | any | — |

> **Windows only:** The post-processing binary is built as a `.exe` via
> PyInstaller. Running the processor in dev mode falls back to `python
> scripts/process.py` directly, so you can skip the binary build while
> iterating on UI work.

---

## 2. Getting Started

```bash
# 1. Fork & clone
git clone https://github.com/your-fork/screen-recorder.git
cd screen-recorder

# 2. Install JS dependencies
pnpm install

# 3. Start in dev mode (Vite + Electron, hot-reload)
pnpm dev
```

`pnpm dev` starts two processes in parallel:

- **Vite** on `http://localhost:5173` — compiles the React renderer  
- **Electron** — waits for Vite, then opens the main window in dev mode with DevTools detached

> Changes to `src/renderer/**` hot-reload instantly.  
> Changes to `src/main/**` require restarting Electron (`Ctrl+C`, then `pnpm dev` again).

### Production preview (no hot-reload)

```bash
pnpm start        # builds renderer → runs packaged electron
```

---

## 3. Project Structure

```
screen-recorder/
├── assets/
│   └── icons/                  # App icons (ICO, SVG)
│
├── scripts/
│   ├── process.py              # Python video post-processor (OpenCV)
│   └── build-processor.js      # Compiles process.py → bin/screen_processor(.exe)
│
├── src/
│   ├── shared/
│   │   └── constants.js        # ★ Single source of truth (settings defaults, IPC names)
│   │
│   ├── main/                   # Electron main process (Node.js)
│   │   ├── index.js            # App entry — creates BrowserWindow, registers handlers
│   │   ├── preload.js          # contextBridge — exposes electronAPI to renderer
│   │   ├── ipc-handlers.js     # All ipcMain.handle() registrations
│   │   ├── input-tracker.js    # Global mouse/scroll capture (uiohook-napi)
│   │   ├── post-processor.js   # Spawns Python processor, streams progress
│   │   └── ffmpeg-utils.js     # ffprobe helpers + webm→mp4 remux
│   │
│   └── renderer/               # React app (Vite, runs in Chromium)
│       ├── index.html
│       ├── main.jsx            # React entry point
│       ├── App.jsx             # Root component, page router, SettingsProvider wrapper
│       ├── contexts/
│       │   └── SettingsContext.jsx  # ★ Shared settings store (useSettings hook)
│       ├── components/
│       │   └── Titlebar.jsx
│       └── pages/
│           ├── HomePage.jsx    # Recordings library
│           ├── RecordPage.jsx  # Source selection + recording controls
│           ├── ReviewPage.jsx  # Post-processing + export
│           └── SettingsPage.jsx
│
├── forge.config.js             # Electron Forge packaging config
├── vite.config.js
└── package.json
```

---

## 4. Architecture Overview

```
┌────────────────────────────────────────────┐
│  Renderer (Chromium / React)               │
│                                            │
│  App.jsx                                   │
│   └─ <SettingsProvider>        ← one load  │
│       ├─ <HomePage>                        │
│       ├─ <RecordPage>  ←─ useSettings()    │
│       ├─ <ReviewPage>                      │
│       └─ <SettingsPage> ←─ useSettings()   │
│                                            │
│  window.electronAPI.*  (contextBridge)     │
└───────────────┬────────────────────────────┘
                │ IPC (invoke / on)
┌───────────────▼────────────────────────────┐
│  Main Process (Node.js / Electron)         │
│                                            │
│  ipc-handlers.js  ←── settings object      │
│   ├─ input-tracker.js  (uiohook)           │
│   └─ post-processor.js                     │
│       └─ ffmpeg-utils.js                   │
│       └─ scripts/process.py  (spawned)     │
└────────────────────────────────────────────┘
```

**Key rule:** the renderer never directly reads or writes `settings.json`.  
It calls `window.electronAPI.getSettings()` (via `SettingsContext`) and  
`window.electronAPI.setSettings(partial)`. The main process owns persistence.

---

## 5. Settings — the Single Source of Truth

Every default value and every IPC channel name lives in one file:

```
src/shared/constants.js
```

### `DEFAULT_SETTINGS`

```js
const DEFAULT_SETTINGS = {
  fps: 30,
  zoomFactor: 2.0,
  zoomDuration: 1.5,
  outputDir: path.join(os.homedir(), 'Videos', 'ScreenRecorder'),
};
```

- **Main process** (`ipc-handlers.js`): merges `settings.json` on top of
  `DEFAULT_SETTINGS` at startup. New keys are always present.
- **Renderer** (`SettingsContext.jsx`): loads settings once via IPC on mount.
  All pages read from `useSettings()` — no component ever hard-codes a default.
- **Post-processor** (`post-processor.js`): falls back to `DEFAULT_SETTINGS`
  if a value is not passed, keeping it independently testable.

> **Never** add `|| someHardCodedFallback` anywhere in the codebase.  
> Add the key to `DEFAULT_SETTINGS` instead.

### `SettingsContext` (renderer)

```jsx
import { useSettings } from '../contexts/SettingsContext';

function MyComponent() {
  const { settings, isLoading, updateSetting, pickOutputDir } = useSettings();
  // settings.fps, settings.zoomFactor, etc.
}
```

| Value / Function | Description |
|---|---|
| `settings` | Full settings object (`null` while loading) |
| `isLoading` | `true` until the first IPC response |
| `updateSetting(key, value)` | Optimistically updates state and persists via IPC |
| `pickOutputDir()` | Opens OS folder picker and updates `outputDir` |

---

## 6. IPC Communication

All IPC channel names are defined in `src/shared/constants.js` under `IPC`:

```js
const IPC = {
  START_RECORDING:      'recording:start',
  GET_SETTINGS:         'settings:get',
  // ...
};
```

The flow for every feature:

```
constants.js  ──imported by──►  preload.js   (contextBridge)
                                     │
                                     ▼
                               window.electronAPI.someMethod()
                                     │  ipcRenderer.invoke
                                     ▼
constants.js  ──imported by──►  ipc-handlers.js  (ipcMain.handle)
```

**Rule:** channel strings appear exactly once — in `constants.js`.  
`preload.js` and `ipc-handlers.js` both import `IPC` from there.

---

## 7. Adding a New Setting

Follow these steps in order so the single-source-of-truth rule stays intact:

### Step 1 — `src/shared/constants.js`

Add the key and its default to `DEFAULT_SETTINGS`:

```js
const DEFAULT_SETTINGS = {
  fps: 30,
  zoomFactor: 2.0,
  zoomDuration: 1.5,
  outputDir: '...',
  myNewSetting: 'default-value',   // ← add here
};
```

### Step 2 — `src/renderer/pages/SettingsPage.jsx`

Expose a control using `handleUpdate`:

```jsx
const { settings, handleUpdate } = useSettings();

<input
  value={settings.myNewSetting}
  onChange={(e) => handleUpdate('myNewSetting', e.target.value)}
/>
```

### Step 3 — consume it where needed

In any page component:

```jsx
const { settings } = useSettings();
// settings.myNewSetting is always defined (from DEFAULT_SETTINGS)
```

In the main process:

```js
// settings object is already merged — just use it directly
settings.myNewSetting;
```

That's it. No other files need to change.

---

## 8. Adding a New IPC Channel

### Step 1 — `src/shared/constants.js`

```js
const IPC = {
  // ...existing channels...
  MY_NEW_CHANNEL: 'myfeature:action',
};
```

### Step 2 — `src/main/ipc-handlers.js`

Register a handler inside `registerIpcHandlers`:

```js
ipcMain.handle(IPC.MY_NEW_CHANNEL, async (_event, arg) => {
  // implementation
  return result;
});
```

### Step 3 — `src/main/preload.js`

Expose a typed method on `electronAPI`:

```js
contextBridge.exposeInMainWorld('electronAPI', {
  // ...existing methods...
  myNewAction: (arg) => ipcRenderer.invoke(IPC.MY_NEW_CHANNEL, arg),
});
```

### Step 4 — call it from the renderer

```jsx
await window.electronAPI.myNewAction(someArg);
```

---

## 9. The Python Post-Processor

`scripts/process.py` reads a `.webm` recording and `events.json`, then writes
a polished `.mp4` using OpenCV and FFmpeg.

### How it works

1. `post-processor.js` (Node) **remuxes** the raw WebM to a clean MP4 first  
   (via `ffmpeg-utils.js → remuxToCleanMp4`).
2. It then **spawns** `scripts/process.py` (or the compiled binary) with the
   clean MP4, events JSON, and output path.
3. The Python script uses a `SmoothCamera` class (exponential smoothing) to
   compute per-frame zoom/pan, then pipes frames back through FFmpeg to write
   the final video.
4. Progress lines (`PROGRESS:50`) are written to stdout and forwarded to the
   renderer via `IPC.PROCESSING_PROGRESS`.

### Running the processor manually

```bash
python scripts/process.py input.mp4 events.json output.mp4 --zoom 2.0 --hold 1.5
```

### Rebuilding the binary

```bash
pnpm build:processor
```

This runs `scripts/build-processor.js` which installs PyInstaller + deps and
compiles `scripts/process.py` to `bin/screen_processor.exe` (Windows) or
`bin/screen_processor` (macOS/Linux).

The packaged Electron app uses the binary; dev mode falls back to `python
scripts/process.py` directly if no binary exists.

---

## 10. Build & Package

| Command | What it does |
|---|---|
| `pnpm dev` | Vite + Electron in watch/dev mode |
| `pnpm start` | Build renderer → run Electron (production mode, no DevTools) |
| `pnpm build:renderer` | Vite production build → `dist/renderer/` |
| `pnpm build:processor` | Compile Python → `bin/screen_processor[.exe]` |
| `pnpm package` | Full Electron Forge package (builds renderer + processor first) |
| `pnpm make` | Package + create installer (Squirrel on Windows, ZIP on others) |

### ASAR unpacking

`ffmpeg-static`, `ffprobe-static`, and `uiohook-napi` contain native binaries
that must live outside the `.asar` archive. This is handled automatically by
`forge.config.js`:

```js
asar: {
  unpack: '**/{ffmpeg-static,ffprobe-static,uiohook-napi}/**'
}
```

Do not move those packages without updating the unpack glob.

---

## 11. Code Style

### General

- **PascalCase** for React components, context files, and their exports  
  (`SettingsContext`, `RecordPage`, `useSettings`)
- **camelCase** for all other JS/JSX identifiers and filenames  
  (`ipc-handlers.js`, `inputTracker`, `handleUpdate`)
- **SCREAMING_SNAKE_CASE** for module-level constants (`DEFAULT_SETTINGS`, `IPC`)
- No magic numbers or inline string literals — put them in `constants.js`

### React

- Functional components only — no class components
- One component per file
- Use the `useSettings()` hook; never call `window.electronAPI.getSettings()` directly in a component
- Clean up `useEffect` subscriptions — every `api.on*` call returns an unsubscriber; call it in the cleanup function

### Main process

- Every `ipcMain.handle` registration lives in `ipc-handlers.js` — no IPC in `index.js`
- Wrap all file system and spawn operations in try/catch and log with a `[Module]` prefix, e.g. `[IPC]`, `[PostProcessor]`

---

## 12. Pull Request Checklist

Before opening a PR, confirm:

- [ ] `pnpm dev` starts without errors
- [ ] `pnpm start` (production build) works end-to-end
- [ ] New defaults added to `DEFAULT_SETTINGS` in `constants.js`, not inline
- [ ] New IPC channels added to `IPC` in `constants.js`, not as raw strings
- [ ] No direct calls to `window.electronAPI.getSettings()` inside components (use `useSettings()`)
- [ ] All `useEffect` subscriptions have cleanup functions
- [ ] Console is free of errors and warnings during normal usage
- [ ] PR description explains **what** changed and **why**
