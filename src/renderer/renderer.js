// Renderer process — handles MediaRecorder, UI state, and IPC communication.

(() => {
  const electronAPI = window.electronAPI;

  // ─── DOM ─────────────────────────────────────────────────────────────

  const btnRecord = document.getElementById("btn-record");
  const recordRing = document.querySelector(".record-ring");
  const statusText = document.getElementById("status-text");
  const timerEl = document.getElementById("timer");

  const processingSection = document.getElementById("processing");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const processingActions = document.getElementById("processing-actions");

  const settingFps = document.getElementById("setting-fps");
  const settingZoom = document.getElementById("setting-zoom");
  const zoomValueEl = document.getElementById("zoom-value");
  const settingDuration = document.getElementById("setting-duration");
  const durationValueEl = document.getElementById("duration-value");
  const btnOutputDir = document.getElementById("btn-output-dir");
  const outputDirText = document.getElementById("output-dir-text");

  const eventLogSection = document.getElementById("event-log");
  const eventList = document.getElementById("event-list");

  // ─── State ───────────────────────────────────────────────────────────

  let isRecording = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let timerInterval = null;
  let currentSessionDir = null;
  let outputFilePath = null;
  let countdownActive = false;

  // ─── Helpers ─────────────────────────────────────────────────────────

  const log = (...args) =>
    console.log(`[Renderer ${new Date().toLocaleTimeString()}]`, ...args);

  function setStatus(msg) {
    statusText.textContent = msg;
  }

  function setProgress(percent, msg) {
    progressBar.style.width = `${percent}%`;
    progressText.textContent = msg ?? `${percent}%`;
  }

  function setOutputDirLabel(dir) {
    const parts = dir.split(/[/\\]/);
    outputDirText.textContent =
      parts.length > 3 ? `.../${parts.slice(-2).join("/")}` : dir;
    outputDirText.title = dir;
  }

  function setRecordingUiState(recording) {
    btnRecord.classList.toggle("recording", recording);
    recordRing.classList.toggle("recording", recording);
  }

  function startTimer() {
    const start = Date.now();
    timerEl.textContent = "00:00";
    timerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      timerEl.textContent = `${mm}:${ss}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // ─── Settings ────────────────────────────────────────────────────────

  async function loadSettings() {
    try {
      const s = await electronAPI.getSettings();
      settingFps.value = String(s.fps);
      settingZoom.value = String(s.zoomFactor);
      zoomValueEl.textContent = `${s.zoomFactor}x`;
      settingDuration.value = String(s.zoomDuration);
      durationValueEl.textContent = `${s.zoomDuration}s`;
      setOutputDirLabel(s.outputDir);
      log("Settings loaded:", s);
    } catch (err) {
      log("Failed to load settings:", err);
    }
  }

  settingFps.addEventListener("change", () =>
    electronAPI.setSettings({ fps: parseInt(settingFps.value, 10) }),
  );

  settingZoom.addEventListener("input", () => {
    const val = parseFloat(settingZoom.value).toFixed(1);
    zoomValueEl.textContent = `${val}x`;
    electronAPI.setSettings({ zoomFactor: parseFloat(val) });
  });

  settingDuration.addEventListener("input", () => {
    const val = parseFloat(settingDuration.value).toFixed(1);
    durationValueEl.textContent = `${val}s`;
    electronAPI.setSettings({ zoomDuration: parseFloat(val) });
  });

  btnOutputDir.addEventListener("click", async () => {
    const dir = await electronAPI.pickOutputDir();
    if (dir) setOutputDirLabel(dir);
  });

  // ─── Recording ───────────────────────────────────────────────────────

  btnRecord.addEventListener("click", async () => {
    if (countdownActive) return;
    if (isRecording) await stopRecording();
    else await startRecording();
  });

  async function startRecording() {
    let stream;
    try {
      setStatus("Requesting screen access…");
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: parseInt(settingFps.value, 10) } },
        audio: false,
      });
    } catch (err) {
      setStatus(
        err.name === "NotAllowedError"
          ? "Screen access denied. Click record to try again."
          : `Error: ${err.message}`,
      );
      return;
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== "live") {
      setStatus("Failed to capture screen. Try again.");
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // Countdown + hide app window
    countdownActive = true;
    btnRecord.disabled = true;
    setStatus("Starting in 3…");
    await electronAPI.prepareRecordingUi();
    countdownActive = false;
    btnRecord.disabled = false;

    if (videoTrack.readyState !== "live") {
      setStatus("Screen capture ended. Try again.");
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    try {
      const session = await electronAPI.startRecording();
      currentSessionDir = session.sessionDir;
      log("Session created:", currentSessionDir);

      recordedChunks = [];

      // Pick best supported codec
      const mimeType = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      log("Using MIME type:", mimeType);

      mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data?.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await handleRecordingStopped();
      };

      mediaRecorder.onerror = (e) =>
        setStatus(`Recorder error: ${e.error?.name ?? "unknown"}`);

      videoTrack.addEventListener("ended", () => {
        if (isRecording) stopRecording();
      });

      mediaRecorder.start(1000);
      isRecording = true;

      setRecordingUiState(true);
      setStatus("Recording screen…");
      processingSection.classList.add("hidden");
      processingActions.innerHTML = "";
      eventLogSection.classList.add("hidden");
      startTimer();
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function stopRecording() {
    if (!isRecording || !mediaRecorder) return;

    isRecording = false;
    stopTimer();

    if (mediaRecorder.state === "recording") {
      try {
        mediaRecorder.requestData();
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();

    try {
      const result = await electronAPI.stopRecording();
      log("Events captured:", result.eventCount);
      showEventLog(result.events);
    } catch (err) {
      log("Failed to stop input tracking:", err);
    } finally {
      await electronAPI.finishRecordingUi();
    }

    setRecordingUiState(false);
    setStatus("Saving recording…");
  }

  async function handleRecordingStopped() {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    log("Blob size:", (blob.size / 1024 / 1024).toFixed(2), "MB");

    if (blob.size === 0) {
      setStatus("Recording is empty. Try again.");
      return;
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();
      await electronAPI.saveRecording(arrayBuffer);
      setStatus(
        `Saved (${(blob.size / 1024 / 1024).toFixed(1)} MB) — Ready to process`,
      );
      showProcessingPanel();
    } catch (err) {
      setStatus(`Save error: ${err.message}`);
    }
  }

  // ─── Processing ──────────────────────────────────────────────────────

  function showProcessingPanel() {
    processingSection.classList.remove("hidden");
    setProgress(0, "Click below to auto-edit with zoom/pan effects");
    processingActions.innerHTML = `
    <button id="btn-process" class="btn-primary" ${currentSessionDir ? "" : 'disabled title="Record once to enable"'}>
      Auto-Edit Video
    </button>
  `;
    document
      .getElementById("btn-process")
      ?.addEventListener("click", startProcessing);
  }

  async function startProcessing() {
    processingActions.innerHTML = "";
    setProgress(0, "Processing…");

    try {
      outputFilePath = await electronAPI.processVideo({
        sessionDir: currentSessionDir,
        fps: parseInt(settingFps.value, 10),
      });
    } catch (err) {
      setProgress(0, `Error: ${err.message}`);
    }
  }

  electronAPI.onProgress((data) => setProgress(data.percent));

  electronAPI.onProcessingDone((data) => {
    outputFilePath = data.outputPath;
    setProgress(100, "Done!");
    setStatus("Video processed successfully!");
    processingActions.innerHTML = `<button id="btn-open-result" class="btn-success">Open Output</button>`;
    document
      .getElementById("btn-open-result")
      .addEventListener("click", () => electronAPI.openOutput(outputFilePath));
  });

  electronAPI.onProcessingError((data) =>
    setProgress(0, `Error: ${data.error}`),
  );

  // ─── Event Log ───────────────────────────────────────────────────────

  function showEventLog(events) {
    if (!events?.length) {
      eventLogSection.classList.add("hidden");
      return;
    }

    eventLogSection.classList.remove("hidden");
    eventList.innerHTML = "";

    for (const evt of events) {
      const li = document.createElement("li");
      if (evt.type === "click") {
        li.textContent = `🖱 Click (${evt.x}, ${evt.y}) at ${evt.timestamp.toFixed(2)}s`;
      } else if (evt.type === "scroll") {
        li.textContent = `${evt.rotation > 0 ? "↓" : "↑"} Scroll (${evt.x}, ${evt.y}) rot=${evt.rotation} at ${evt.timestamp.toFixed(2)}s`;
      }
      eventList.appendChild(li);
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────

  loadSettings();
  showProcessingPanel();
})();
