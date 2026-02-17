// Renderer process — handles MediaRecorder, UI state, and IPC communication.

(() => {

const electronAPI = window.electronAPI;

// ─── DOM Elements ────────────────────────────────────────────────────

const btnRecord = document.getElementById('btn-record');
const recordRing = document.querySelector('.record-ring');
const statusText = document.getElementById('status-text');
const timerEl = document.getElementById('timer');

const processingSection = document.getElementById('processing');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const processingActions = document.getElementById('processing-actions');

const settingFps = document.getElementById('setting-fps');
const settingZoom = document.getElementById('setting-zoom');
const zoomValueEl = document.getElementById('zoom-value');
const settingDuration = document.getElementById('setting-duration');
const durationValueEl = document.getElementById('duration-value');
const btnOutputDir = document.getElementById('btn-output-dir');
const outputDirText = document.getElementById('output-dir-text');

const eventLogSection = document.getElementById('event-log');
const eventList = document.getElementById('event-list');

// ─── State ───────────────────────────────────────────────────────────

let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let timerInterval = null;
let currentSessionDir = null;
let outputFilePath = null;
let countdownActive = false;

function log(...args) {
  console.log(`[Renderer ${new Date().toLocaleTimeString()}]`, ...args);
}

// ─── Initialize Settings ────────────────────────────────────────────

async function loadSettings() {
  try {
    const settings = await electronAPI.getSettings();
    settingFps.value = String(settings.fps);
    settingZoom.value = String(settings.zoomFactor);
    zoomValueEl.textContent = `${settings.zoomFactor}x`;
    settingDuration.value = String(settings.zoomDuration);
    durationValueEl.textContent = `${settings.zoomDuration}s`;

    const dirParts = settings.outputDir.split(/[/\\]/);
    outputDirText.textContent =
      dirParts.length > 3
        ? `.../${dirParts.slice(-2).join('/')}`
        : settings.outputDir;
    outputDirText.title = settings.outputDir;
    log('Settings loaded:', settings);
  } catch (err) {
    log('Failed to load settings:', err);
  }
}

loadSettings();
initializeProcessingPanel();

// ─── Settings Controls ──────────────────────────────────────────────

settingFps.addEventListener('change', () => {
  electronAPI.setSettings({ fps: parseInt(settingFps.value, 10) });
});

settingZoom.addEventListener('input', () => {
  const val = parseFloat(settingZoom.value).toFixed(1);
  zoomValueEl.textContent = `${val}x`;
  electronAPI.setSettings({ zoomFactor: parseFloat(val) });
});

settingDuration.addEventListener('input', () => {
  const val = parseFloat(settingDuration.value).toFixed(1);
  durationValueEl.textContent = `${val}s`;
  electronAPI.setSettings({ zoomDuration: parseFloat(val) });
});

btnOutputDir.addEventListener('click', async () => {
  const dir = await electronAPI.pickOutputDir();
  if (dir) {
    const dirParts = dir.split(/[/\\]/);
    outputDirText.textContent =
      dirParts.length > 3
        ? `.../${dirParts.slice(-2).join('/')}`
        : dir;
    outputDirText.title = dir;
  }
});

// ─── Recording ──────────────────────────────────────────────────────

btnRecord.addEventListener('click', async () => {
  if (countdownActive) return;
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  let stream;

  try {
    log('Requesting screen capture stream…');
    statusText.textContent = 'Requesting screen access…';

    // Request screen capture FIRST — this may show a picker dialog
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: parseInt(settingFps.value, 10) },
      },
      audio: false,
    });

    log('Got stream:', stream.id, 'tracks:', stream.getTracks().map(t => `${t.kind}:${t.readyState}`));
  } catch (err) {
    log('getDisplayMedia failed:', err.name, err.message);
    statusText.textContent = err.name === 'NotAllowedError'
      ? 'Screen access denied. Click record to try again.'
      : `Error: ${err.message}`;
    return;
  }

  // Verify we actually have a video track
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack || videoTrack.readyState !== 'live') {
    log('ERROR: No live video track in stream');
    statusText.textContent = 'Failed to capture screen. Try again.';
    stream.getTracks().forEach(t => t.stop());
    return;
  }

  const trackSettings = videoTrack.getSettings();
  log('Video track settings:', JSON.stringify(trackSettings));

  // ─── 3-2-1 Overlay + hide app window ───────────────────────────
  countdownActive = true;
  btnRecord.disabled = true;
  statusText.textContent = 'Starting in 3…';
  await electronAPI.prepareRecordingUi();
  countdownActive = false;
  btnRecord.disabled = false;

  // Check if track is still alive after countdown
  if (videoTrack.readyState !== 'live') {
    log('Video track died during countdown');
    statusText.textContent = 'Screen capture ended. Try again.';
    stream.getTracks().forEach(t => t.stop());
    return;
  }

  try {
    // Notify main process to start input tracking
    log('Starting input tracker in main process…');
    const session = await electronAPI.startRecording();
    currentSessionDir = session.sessionDir;
    log('Session created:', session.sessionDir);

    // Set up MediaRecorder
    recordedChunks = [];

    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      log('VP9 not supported, falling back to VP8');
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
      log('VP8 not supported, falling back to generic webm');
    }
    log('Using MIME type:', mimeType);

    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      log('MediaRecorder stopped, chunks:', recordedChunks.length);
      stream.getTracks().forEach((track) => track.stop());
      await handleRecordingStopped();
    };

    mediaRecorder.onerror = (e) => {
      log('MediaRecorder error:', e.error?.name, e.error?.message);
      statusText.textContent = `Recorder error: ${e.error?.name || 'unknown'}`;
    };

    mediaRecorder.onstart = () => {
      log('MediaRecorder started successfully');
    };

    // Handle user stopping via the browser's built-in stop button
    videoTrack.addEventListener('ended', () => {
      log('Video track ended externally');
      if (isRecording) {
        stopRecording();
      }
    });

    // Start recording
    mediaRecorder.start(1000); // chunk every 1s for reliability
    isRecording = true;

    log('Recording! State:', mediaRecorder.state);

    // Update UI
    btnRecord.classList.add('recording');
    recordRing.classList.add('recording');
    statusText.textContent = 'Recording screen…';
    processingSection.classList.add('hidden');
    processingActions.innerHTML = '';
    eventLogSection.classList.add('hidden');

    startTimer();
  } catch (err) {
    log('Failed to start recording:', err);
    statusText.textContent = `Error: ${err.message}`;
    stream.getTracks().forEach(t => t.stop());
  }
}

async function stopRecording() {
  if (!isRecording || !mediaRecorder) return;

  log('Stopping recording…');
  isRecording = false;
  stopTimer();

  // Stop MediaRecorder (triggers onstop → handleRecordingStopped)
  if (mediaRecorder.state !== 'inactive') {
    if (mediaRecorder.state === 'recording') {
      try {
        mediaRecorder.requestData();
      } catch (err) {
        log('requestData failed (continuing stop):', err);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    mediaRecorder.stop();
  }

  // Notify main process to stop input tracking
  try {
    const result = await electronAPI.stopRecording();
    log('Input tracker stopped:', result.eventCount, 'events');
    showEventLog(result.events);
    await electronAPI.finishRecordingUi();
  } catch (err) {
    log('Failed to stop input tracking:', err);
    await electronAPI.finishRecordingUi();
  }

  // Update UI
  btnRecord.classList.remove('recording');
  recordRing.classList.remove('recording');
  statusText.textContent = 'Saving recording…';
}

async function handleRecordingStopped() {
  try {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    log('Recording blob size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

    if (blob.size === 0) {
      statusText.textContent = 'Recording is empty. Try again.';
      log('ERROR: Empty recording blob');
      return;
    }

    const arrayBuffer = await blob.arrayBuffer();
    log('Sending recording to main process…');
    const savedPath = await electronAPI.saveRecording(arrayBuffer);
    log('Recording saved at:', savedPath);

    statusText.textContent = `Saved! (${(blob.size / 1024 / 1024).toFixed(1)} MB) — Ready to process`;

    // Show processing section
    processingSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Click below to auto-edit with zoom/pan effects';

    showProcessButtons();
  } catch (err) {
    log('Failed to save recording:', err);
    statusText.textContent = `Save error: ${err.message}`;
  }
}

// ─── Post-Processing ────────────────────────────────────────────────

function initializeProcessingPanel() {
  processingSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = 'Auto-edit this recording with zoom/pan effects';
  showProcessButtons();
}

function showProcessButtons() {
  const disableCurrent = !currentSessionDir;
  const currentHint = disableCurrent ? 'title="Record once to enable this" disabled' : '';

  processingActions.innerHTML = `
    <button id="btn-process" class="btn-primary" ${currentHint}>
      Auto-Edit Video
    </button>
  `;

  const btnProcess = document.getElementById('btn-process');

  if (btnProcess && !disableCurrent) {
    btnProcess.addEventListener('click', startProcessing);
  }
}

async function startProcessing() {
  if (!currentSessionDir) {
    progressText.textContent = 'No current session to process. Record once first.';
    return;
  }

  processingActions.innerHTML = '';
  progressText.textContent = 'Processing…';

  try {
    outputFilePath = await electronAPI.processVideo({
      sessionDir: currentSessionDir,
    });
  } catch (err) {
    progressText.textContent = `Error: ${err.message}`;
  }
}

// Listen for progress updates from main process
electronAPI.onProgress((data) => {
  progressBar.style.width = `${data.percent}%`;
  progressText.textContent = `${data.percent}%`;
});

electronAPI.onProcessingDone((data) => {
  outputFilePath = data.outputPath;
  progressBar.style.width = '100%';
  progressText.textContent = 'Done!';
  statusText.textContent = 'Video processed successfully!';

  processingActions.innerHTML = `
    <button id="btn-open-result" class="btn-success">
      Open Output
    </button>
  `;

  document.getElementById('btn-open-result').addEventListener('click', () => {
    electronAPI.openOutput(outputFilePath);
  });
});

electronAPI.onProcessingError((data) => {
  progressText.textContent = `Error: ${data.error}`;
});

// ─── Event Log ──────────────────────────────────────────────────────

function showEventLog(events) {
  if (!events || events.length === 0) {
    eventLogSection.classList.add('hidden');
    return;
  }

  eventLogSection.classList.remove('hidden');
  eventList.innerHTML = '';

  for (const evt of events) {
    const li = document.createElement('li');
    if (evt.type === 'click') {
      li.textContent = `🖱 Click (${evt.x}, ${evt.y}) at ${evt.timestamp.toFixed(2)}s`;
    } else if (evt.type === 'scroll') {
      const dir = evt.rotation > 0 ? '↓' : '↑';
      li.textContent = `${dir} Scroll (${evt.x}, ${evt.y}) rot=${evt.rotation} at ${evt.timestamp.toFixed(2)}s`;
    }
    eventList.appendChild(li);
  }
}

// ─── Timer ──────────────────────────────────────────────────────────

function startTimer() {
  const start = Date.now();
  timerEl.textContent = '00:00';

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

})();
