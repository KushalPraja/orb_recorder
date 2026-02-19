module.exports = {
  packagerConfig: {
    asar: {
      unpack: "**/{uiohook-napi,Wallpapers}/**",
    },
    extraResource: ["./bin", "./scripts"],
    name: "ScreenRecorder",
    icon: "./assets/icons/Document",
    ignore: [
      // Renderer source — Vite output already in dist/
      /^\/src\/renderer/,
      // Vite / build artefacts that aren't needed at runtime
      /^\/\.vite/,
      /^\/vite\.config/,
      /^\/forge\.config/,
      // Binaries live in extraResource, not inside the asar
      /^\/bin/,
      // PyInstaller build artefacts
      /^\/\.pybuild/,
      // Heavy ffmpeg/ffprobe npm packages — we ship binaries via extraResource
      // All devDependencies
      /^\/node_modules\/@electron-forge/,
      /^\/node_modules\/@vitejs/,
      /^\/node_modules\/vite/,
      /^\/node_modules\/electron($|\/)/,
      /^\/node_modules\/concurrently/,
      /^\/node_modules\/wait-on/,
      // Common dead-weight in node_modules
      /^\/node_modules\/.*\/(\.github|\.travis\.yml|test|tests|__tests__|docs|examples|coverage|benchmark|benchmarks|typings|types)($|\/)/,
      /^\/node_modules\/.*\.(md|map|ts|flow|coffee|patch|bat|sh)$/,
      // Docs / config noise at repo root
      /^\/(CONTRIBUTING|README|todolist|implementation_plan)\.md$/,
      /^\/\.eslint/,
      /^\/\.prettier/,
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "ScreenRecorder",
      },
    },
  ],
};
