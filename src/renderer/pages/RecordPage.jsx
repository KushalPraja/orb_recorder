import React, { useState, useRef, useEffect, useCallback } from "react";
import { Monitor, AppWindow, Loader2, Volume2, VolumeX } from "lucide-react";

import { useSettings } from "../contexts/SettingsContext";
import "./RecordPage.css";

const api = window.electronAPI;

export function RecordPage({ onNavigate }) {
  const { settings } = useSettings();

  // ── Source picker state ───────────────────────────────────────────────────
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [loading, setLoading] = useState(true);
  /** Active tab: show display sources or window sources */
  const [activeTab, setActiveTab] = useState(
    /** @type {"screens"|"windows"} */ ("screens"),
  );

  // ── Audio state ───────────────────────────────────────────────────────────
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(true);

  // ── Recording state ───────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("Select a screen to record");

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const sessionRef = useRef(null);
  const discardingRef = useRef(false);
  const videoStartTimeRef = useRef(null);

  // ── Load screen/window sources ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const srcs = await api.getSources();
        if (!cancelled) {
          setSources(Array.isArray(srcs) ? srcs : []);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to get sources:", err);
        if (!cancelled) {
          setLoading(false);
          setStatus("Failed to detect screens");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Source selection ──────────────────────────────────────────────────────
  const selectSource = useCallback((source) => {
    setSelectedSource(source);
    setStatus("Source selected — click Record to start");
  }, []);

  // Derived: split sources into displays vs windows for the two tabs
  const displaySources = sources.filter((s) => s.type === "screen");
  const windowSources = sources.filter((s) => s.type === "window");
  const visibleSources =
    activeTab === "screens" ? displaySources : windowSources;

  const startRecording = useCallback(async () => {
    if (!selectedSource) return;

    let stream = streamRef.current;
    await api.setCaptureSource(selectedSource.id);

    // ── Acquire display/window capture stream ─────────────────────────────
    if (!stream || stream.getTracks().every((t) => t.readyState !== "live")) {
      try {
        // In Electron, getUserMedia with chromeMediaSource/chromeMediaSourceId
        // is the correct way to capture a specific desktopCapturer source.
        // getDisplayMedia would show the system picker and ignore our selection.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: selectedSource.id,
              minFrameRate: settings.fps,
              maxFrameRate: settings.fps,
            },
          },
          // System audio loopback — works on Windows; macOS needs a virtual device.
          audio: systemAudioEnabled
            ? { mandatory: { chromeMediaSource: "desktop" } }
            : false,
        });
        streamRef.current = stream;
      } catch (err) {
        setStatus("Screen access denied");
        return;
      }
    }

    // Countdown overlay (minimises main window, shows 3-2-1)
    setStatus("Starting in 3...");
    await api.prepareRecordingUi();

    // Safety: confirm the video track is still alive after countdown
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      setStatus("Screen capture ended. Try again.");
      return;
    }

    try {
      const session = await api.startRecording();
      sessionRef.current = session;
      chunksRef.current = [];

      // Choose the best supported WebM codec
      let mimeType = "video/webm; codecs=vp9";
      if (!MediaRecorder.isTypeSupported(mimeType))
        mimeType = "video/webm;codecs=vp8";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 6_000_000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        await handleRecordingStopped();
      };

      // Auto-stop if the user closes the captured window/tab
      track.addEventListener("ended", () => {
        if (mediaRecorderRef.current?.state !== "inactive") {
          stopRecording();
        }
      });

      recorder.start(1000); // 1-second timeslice chunks
      videoStartTimeRef.current = Date.now(); // align event timeline with video
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      setStatus("Recording...");

      const start = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      stream.getTracks().forEach((t) => t.stop());
    }
  }, [selectedSource, settings, systemAudioEnabled]);

  async function stopRecording() {
    if (!mediaRecorderRef.current) return;

    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder.state !== "inactive") {
      if (recorder.state === "recording") {
        try {
          recorder.requestData();
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      recorder.stop();
    }

    try {
      await api.stopRecording(videoStartTimeRef.current);
      await api.finishRecordingUi();
      setStatus("Saving recording...");
    } catch (err) {
      console.error("Failed to stop tracking:", err);
      await api.finishRecordingUi();
    }
  }

  useEffect(() => {
    const unsubStop = api.onOverlayStopRequest(() => {
      stopRecording();
    });
    const unsubPause = api.onOverlayPauseRequest(() => {
      if (mediaRecorderRef.current?.state === "recording") {
        try {
          mediaRecorderRef.current.pause();
        } catch {}
      }
    });
    const unsubResume = api.onOverlayResumeRequest(() => {
      if (mediaRecorderRef.current?.state === "paused") {
        try {
          mediaRecorderRef.current.resume();
        } catch {}
      }
    });
    const unsubDiscard = api.onOverlayDiscardRequest(() => {
      discardRecording();
    });
    return () => {
      unsubStop();
      unsubPause();
      unsubResume();
      unsubDiscard();
    };
  }, []);

  async function discardRecording() {
    if (!mediaRecorderRef.current) return;
    discardingRef.current = true;
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    try {
      await api.stopRecording(videoStartTimeRef.current);
      await api.finishRecordingUi();
    } catch {}
    chunksRef.current = [];
    setElapsed(0);
    setStatus("Recording discarded — select a screen to record.");
  }

  const handleRecordingStopped = useCallback(async () => {
    // Discard path — don’t save or navigate
    if (discardingRef.current) {
      discardingRef.current = false;
      return;
    }
    try {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      if (blob.size === 0) {
        setStatus("Recording is empty. Try again.");
        return;
      }

      const arrayBuffer = await blob.arrayBuffer();
      const savedPath = await api.saveRecording(arrayBuffer);

      onNavigate("review", {
        sessionDir: sessionRef.current?.sessionDir,
        filePath: savedPath,
        size: blob.size,
        duration: elapsed,
      });
    } catch (err) {
      setStatus(`Save error: ${err.message}`);
    }
  }, [onNavigate, elapsed]);

  const formatTime = (secs) => {
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="record-page">
      {!recording && (
        <>
          <div className="record-header">
            <h2>Select Source</h2>
            <p className="record-subtitle">{status}</p>
          </div>

          {/* Tab selector — Displays vs Windows */}
          <div className="source-tabs">
            <button
              className={`source-tab ${activeTab === "screens" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("screens");
                setSelectedSource(null);
              }}
            >
              <Monitor size={14} />
              Displays ({displaySources.length})
            </button>
            <button
              className={`source-tab ${activeTab === "windows" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("windows");
                setSelectedSource(null);
              }}
            >
              <AppWindow size={14} />
              Windows ({windowSources.length})
            </button>
          </div>

          <div className="source-grid">
            {loading ? (
              <div className="source-loading">
                <Loader2 size={20} className="spinner" />
                <span>Detecting sources...</span>
              </div>
            ) : visibleSources.length === 0 ? (
              <div className="source-loading">
                <Monitor size={20} />
                <span>
                  No {activeTab === "screens" ? "displays" : "windows"} detected
                </span>
              </div>
            ) : (
              visibleSources.map((src) => (
                <button
                  key={src.id}
                  className={`source-card ${selectedSource?.id === src.id ? "selected" : ""}`}
                  onClick={() => selectSource(src)}
                >
                  <div className="source-preview">
                    {src.thumbnail ? (
                      <img src={src.thumbnail} alt={src.name} />
                    ) : activeTab === "windows" ? (
                      <AppWindow size={24} strokeWidth={1.5} />
                    ) : (
                      <Monitor size={24} strokeWidth={1.5} />
                    )}
                  </div>
                  <span className="source-name">{src.name}</span>
                </button>
              ))
            )}
          </div>

          {/* System audio toggle + Start button */}
          <div className="record-footer">
            <div className="audio-section">
              <button
                className={`audio-toggle ${systemAudioEnabled ? "active" : ""}`}
                onClick={() => setSystemAudioEnabled((e) => !e)}
              >
                {systemAudioEnabled ? (
                  <Volume2 size={14} />
                ) : (
                  <VolumeX size={14} />
                )}
                <span>System Audio</span>
              </button>
            </div>
            <button
              className="btn-record-start"
              disabled={!selectedSource}
              onClick={startRecording}
            >
              <span>Start Recording</span>
            </button>
          </div>
        </>
      )}

      {recording && (
        <div className="recording-active">
          <div className="recording-indicator" />
          <span className="recording-timer">{formatTime(elapsed)}</span>
          <p className="recording-status">Recording in progress</p>
          <button className="btn-record-stop" onClick={stopRecording}>
            Stop Recording
          </button>
        </div>
      )}
    </div>
  );
}
