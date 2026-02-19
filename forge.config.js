module.exports = {
  packagerConfig: {
    asar: {
      unpack: "**/{ffmpeg-static,ffprobe-static,uiohook-napi}/**",
    },
    extraResource: ["./bin", "./scripts"],
    name: "ScreenRecorder",
    icon: "./assets/icons/Document",
    ignore: [
      /^\/src\/renderer\/(?!.*\.html$)/, // exclude renderer source (built files in dist/)
      /^\/\.vite/,
      /^\/bin/, // binaries go in extraResource, not inside the asar
      /^\/\.pybuild/, // PyInstaller build artefacts
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
