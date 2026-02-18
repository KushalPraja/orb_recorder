# Screen Recorder

A desktop screen recorder that automatically edits your recordings with smooth zoom and pan effects on every click and scroll — like [Screen Studio](https://www.screen.studio/), but open-source and free.

Built with **Electron**, **React**, and **Python** (OpenCV).

---

## Features

- 🖥 Screen source selection with live thumbnails
- 🔴 One-click recording with countdown overlay and floating stop bar
- 🔍 Auto-zoom on mouse clicks with spring-smooth camera motion
- 🖱 Scroll-based camera panning
- 💾 Recordings library with preview and delete
- ⚙️ Persistent settings (FPS, zoom level, hold duration, output folder)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 40 |
| UI | React 19 + Vite 7 |
| Input capture | uiohook-napi (global mouse/scroll hooks) |
| Video muxing | ffmpeg-static / ffprobe-static |
| Post-processing | Python 3 + OpenCV + NumPy (via PyInstaller binary) |
| Packaging | Electron Forge + Squirrel (Windows) |

---

## Quick Start

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup guide.

```bash
pnpm install
pnpm dev       # hot-reload dev mode
```

---

## License

MIT
