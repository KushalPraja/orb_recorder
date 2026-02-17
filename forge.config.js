module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/{ffmpeg-static,ffprobe-static,uiohook-napi}/**'
    },
    name: 'ScreenRecorder',
    icon: './assets/icon'
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'ScreenRecorder'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32']
    }
  ]
};
