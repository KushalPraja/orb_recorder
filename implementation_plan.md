# App Size Reduction — 2 GB → ~200–300 MB

The built installer is over 2 GB primarily because `ffmpeg-static` and `ffprobe-static` each ship **every platform's binary** inside `node_modules`, and electron-forge bundles the resulting `node_modules` into `app.asar` with almost no exclusions.

## Where the size comes from

| Culprit | Size | Why |
|---|---|---|
| `ffprobe-static` | **335 MB** | darwin arm64/x64, linux ia32/x64, win32 ia32/x64 binaries all included |
| `ffmpeg-static` | **79 MB** | Same — ships 6+ platform binaries, we only need `win32/x64` |
| `electron` (devDep) | 333 MB | Already excluded by Forge, but devDeps in `node_modules` still get scanned |
| Assorted devDeps bundled into asar | variable | No `ignore` rules exclude test, build, and documentation folders |

> [!IMPORTANT]
> The **root fix** is to stop relying on `ffmpeg-static`/`ffprobe-static` npm packages at runtime and instead place a single Windows ffmpeg.exe/ffprobe.exe in `bin/` as an `extraResource`. Forge already ships `bin/` as `extraResource` — we just need to wire the path lookup and remove the npm packages from `dependencies`.

---

## Proposed Changes

### 1 — Remove npm packages, use binaries in `bin/` directly

**ffmpeg.exe is already at 79 MB in `ffmpeg-static`** — the Windows x64 binary. We copy it (and ffprobe.exe) into `bin/` once, then remove the npm packages.

#### [MODIFY] [package.json](file:///c:/Users/Kushal%20Prajapati/code/screen_recorder/package.json)
- Remove `ffmpeg-static` and `ffprobe-static` from `dependencies`
- Add a `postinstall` script that copies the Windows binaries from the npm packages into `bin/` **before** those packages are uninstalled (so devs cloning the repo don't need to manually source binaries, only for the one-time copy to `bin/`)

> [!NOTE]
> Actually the simpler approach: copy the binaries manually into `bin/` now (one-time), then remove the npm packages. The binaries are already present in `node_modules` so we can copy once. Devs without the npm packages can download from https://github.com/BtbN/FFmpeg-Builds/releases.

#### [MODIFY] [ipc-handlers.js](file:///c:/Users/Kushal%20Prajapati/code/screen_recorder/src/main/ipc-handlers.js)
- Update the `ffmpegPath` / `ffprobePath` resolution to **not** use `require('ffmpeg-static')` / `require('ffprobe-static')`. Instead resolve from:
  - In packaged app: `process.resourcesPath + /bin/ffmpeg.exe`
  - In dev: `path.join(__dirname, '../../bin/ffmpeg.exe')`

---

### 2 — Drastically expand `forge.config.js` ignore patterns

#### [MODIFY] [forge.config.js](file:///c:/Users/Kushal%20Prajapati/code/screen_recorder/forge.config.js)

Add comprehensive `ignore` rules to exclude from `app.asar`:
- All `devDependencies` by name (electron, vite, prettier, typescript, @babel, webpack, etc.)
- `node_modules/.ignored`, `node_modules/.pnpm`, `node_modules/.cache`
- Source files that Vite already compiled (`src/renderer/**` except built assets)
- `*.md`, `*.map`, test folders, docs
- `node_modules/ffmpeg-static`, `node_modules/ffprobe-static` (removed from deps, but belt-and-suspenders)

---

### 3 — Copy Windows binaries to `bin/` (one-time step)

Run a script to copy `ffmpeg.exe` from `node_modules/ffmpeg-static/` and `ffprobe.exe` from `node_modules/ffprobe-static/bin/win32/x64/` into `bin/`.

---

## Verification Plan

### After changes, check sizes:
```
# Check that bin/ has the binaries
ls bin/

# Do a test package (dry-run, check output folder sizes)
npm run package
# Then check sizes:
Get-ChildItem out/ -Recurse | Measure-Object -Property Length -Sum
```

### Manual Verification
1. Run `npm run dev` — confirm the app launches and ffmpeg paths resolve (recording + export still works)
2. Run `npm run package` — confirm the output folder is under 300 MB
3. Launch the packaged exe — confirm recording and video export still works end-to-end
