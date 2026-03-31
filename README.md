<div align="center">
  <img src="https://github.com/user-attachments/assets/f831a6f0-9cef-4848-90ef-5f03b7a47235" width="80" />
  <h1>Orb Recorder</h1>
  <p>A desktop screen recorder that automatically applies smooth zoom and pan effects to your recordings.</p>

  <img src="https://img.shields.io/badge/Electron-2B2E3A?style=flat&logo=electron&logoColor=9FEAF9" />
  <img src="https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat" />
</div>


<video src="https://github.com/user-attachments/assets/ffbd5351-27c8-41ba-bd12-31ded307c6ac"
       autoplay
       muted
       loop
       controls
       playsinline
       style="max-width: 100%;">
</video>

---

Orb Recorder is an open-source desktop screen recorder that automatically applies **smooth zoom and pan effects** to your recordings. Every mouse click and scroll triggers a spring-animated camera movement, producing polished output without any manual editing.

## Features

- Screen source selection with live thumbnails
- One-click recording with a countdown overlay and floating stop bar
- Automatic zoom on mouse clicks driven by a spring-physics camera model
- Scroll-based camera panning
- Recordings library with thumbnail previews and delete support
- Persistent settings: FPS, zoom factor, hold duration, and output folder

---

## Tech Stack

| Layer           | Technology                                         |
| --------------- | -------------------------------------------------- |
| Shell           | Electron 40                                        |
| UI              | React 19 + Vite 7                                  |
| Input capture   | uiohook-napi (global mouse/scroll hooks)           |
| Video rendering | Remotion 4                                         |
| Video muxing    | ffmpeg-static / ffprobe-static                     |
| Post-processing | Python 3 + OpenCV + NumPy (via PyInstaller binary) |
| Packaging       | electron-builder                                   |

---

## Requirements

| Tool    | Version                                                             |
| ------- | ------------------------------------------------------------------- |
| Node.js | 20 LTS or later                                                     |
| pnpm    | 9 or later                                                          |
| Python  | 3.10 or later (only required to rebuild the video processor binary) |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/orb-recorder.git
cd orb-recorder

# Install dependencies
pnpm install

# Start in development mode (hot-reload)
pnpm dev
```

`pnpm dev` starts two processes in parallel:

- **Vite** on `http://localhost:5173` — compiles the React renderer
- **Electron** — waits for Vite, then opens the main window with DevTools attached

Changes to `src/renderer/**` hot-reload instantly. Changes to `src/main/**` require restarting Electron (`Ctrl+C`, then `pnpm dev` again).

### Production build

```bash
pnpm dist      # builds and packages a distributable installer
```

---

## Project Structure

```
orb-recorder/
├── assets/                     # App icons
├── scripts/
│   ├── process.py              # Python video post-processor (OpenCV)
│   └── build-processor.js      # Compiles process.py → bin/screen_processor.exe
├── src/
│   ├── shared/
│   │   └── constants.ts        # IPC channel names and default settings
│   ├── main/                   # Electron main process (Node.js)
│   │   ├── index.ts            # App entry point
│   │   ├── preload.ts          # contextBridge — exposes electronAPI to renderer
│   │   ├── handlers/           # ipcMain.handle() registrations
│   │   ├── services/           # Input tracking, FFmpeg, session management
│   │   └── windows/            # BrowserWindow factories
│   └── renderer/               # React app (Vite, runs in Chromium)
│       ├── pages/              # HomePage, RecordPage, ReviewPage, SettingsPage
│       ├── components/         # Shared UI components
│       └── contexts/           # SettingsContext — shared settings store
└── electron-builder.yml        # Packaging configuration
```

---
