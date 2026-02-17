module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/{ffmpeg-static,ffprobe-static,uiohook-napi}/**'
    },
    extraResource: ['./bin'],
    name: 'ScreenRecorder',
    icon: './assets/icons/Document',
    ignore: [
      /^\/src\/renderer\/(?!.*\.html$)/,  // exclude renderer source (built files in dist/)
      /^\/\.vite/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'ScreenRecorder'
      }
    }
  ]
};
