Todolist.md :

[] size bar should allow scrubbing and jumping to different parts of the recording during preview, this will make it easier for users to review their recordings and find specific parts of the recording that they want to save or discard. This can be implemented using a progress bar that shows the duration of the recording and allows users to click on different parts of the bar to jump to those parts of the recording during preview.

[] yolo model to load and detecet the important parts of the screen and zoom in on them while recording, like clicking a button or 
typing in a terminal, this will make the recordings more engaging and focused on the important parts of the screen. This can be implemented using a pre-trained yolo model and integrating it into the recording process to detect and zoom in on the important parts of the screen in real-time while recording.

[] add the ability to record audio along with the screen recording, this will make the recordings more informative and engaging. This can be implemented using the Web Audio API to capture audio from the user's microphone and integrate it into the recording process.

[] presets for quality like 1080p, 720p, 480p, etc, or encoders like vp9 or av1, or presets for encoders like:

const presets = {
  "Ultra": {
    codec: "video/webm;codecs=av1",
    videoBitsPerSecond: 6_000_000,
    frameRate: 60,
    resolution: null,
    exportCrf: 14,        // near-lossless final output
    exportPreset: "slow",
  },
  "High": {
    codec: "video/webm;codecs=av1",
    videoBitsPerSecond: 3_000_000,
    frameRate: 30,
    resolution: null,
    exportCrf: 18,
    exportPreset: "slow",
  },
  "Medium": {
    codec: "video/webm;codecs=av1",
    videoBitsPerSecond: 1_500_000,
    frameRate: 30,
    resolution: { width: 1920, height: 1080 },
    exportCrf: 22,
    exportPreset: "medium",
  },
  "Low": {
    codec: "video/webm;codecs=av1",
    videoBitsPerSecond: 600_000,
    frameRate: 30,
    resolution: { width: 1280, height: 720 },
    exportCrf: 26,
    exportPreset: "medium",
  }
}

orb

options:
- image
- color
- gradient
- None

- image blur : none moderate strong


- add option for audio recording (might not work on mac)