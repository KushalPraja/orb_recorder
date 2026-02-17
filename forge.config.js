module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/{ffmpeg-static,ffprobe-static,uiohook-napi}/**'
    },
    extraResource: ['./bin'],
    name: 'ScreenRecorder',
    icon: './assets/icon'
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
