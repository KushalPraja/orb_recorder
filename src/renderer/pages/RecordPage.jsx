import React, { useState, useRef, useEffect, useCallback } from "react";
import { Monitor, Circle, Loader2 } from "lucide-react";
import "./RecordPage.css";

const api = window.electronAPI;

export function RecordPage({ onNavigate }) {
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("Select a screen to record");
  const [loading, setLoading] = useState(true);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const sessionRef = useRef(null);

  // Load available screen sources
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const srcs = await api.getSources();
        if (!cancelled) {
          setSources(srcs || []);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const selectSource = useCallback(async (source) => {
    setSelectedSource(source);
    setPreviewing(false); // no live preview, just select
    setStatus("Source selected — click Record to start");
  }, []);

  const startRecording = useCallback(async () => {
    if (!selectedSource) return;

    let stream = streamRef.current;
    await api.setCaptureSource(selectedSource.id);

    // If no stream, acquire one
    if (!stream || stream.getTracks().every((t) => t.readyState !== "live")) {
      try {
        const settings = await api.getSettings();
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: settings.fps || 30 } },
          audio: false,
        });
        streamRef.current = stream;
      } catch (err) {
        setStatus("Screen access denied");
        return;
      }
    }

    // Countdown
    setStatus("Starting in 3...");
    await api.prepareRecordingUi();

    // Check track still alive
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      setStatus("Screen capture ended. Try again.");
      return;
    }

    try {
      const session = await api.startRecording();
      sessionRef.current = session;
      chunksRef.current = [];

      let mimeType = "video/webm;codecs=vp9";
      if (!MediaRecorder.isTypeSupported(mimeType))
        mimeType = "video/webm;codecs=vp8";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        await handleRecordingStopped();
      };

      track.addEventListener("ended", () => {
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state !== "inactive"
        ) {
          stopRecording();
        }
      });

      recorder.start(1000);
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
  }, [selectedSource]);

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
      await api.stopRecording();
      await api.finishRecordingUi();
      setStatus("Saving recording...");
    } catch (err) {
      console.error("Failed to stop tracking:", err);
      await api.finishRecordingUi();
    }
  }

  useEffect(() => {
    const unsubOverlayStop = api.onOverlayStopRequest(() => {
      stopRecording();
    });
    return () => {
      unsubOverlayStop();
    };
  }, []);

  const handleRecordingStopped = useCallback(async () => {
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
            <h2>Select Screen</h2>
            <p className="record-subtitle">{status}</p>
          </div>

          <div className="source-grid">
            {loading ? (
              <div className="source-loading">
                <Loader2 size={20} className="spinner" />
                <span>Detecting screens...</span>
              </div>
            ) : sources.length === 0 ? (
              <div className="source-loading">
                <Monitor size={20} />
                <span>No screens detected</span>
              </div>
            ) : (
              sources.map((src) => (
                <button
                  key={src.id}
                  className={`source-card ${selectedSource?.id === src.id ? "selected" : ""}`}
                  onClick={() => selectSource(src)}
                >
                  <div className="source-preview">
                    {src.thumbnail ? (
                      <img src={src.thumbnail} alt={src.name} />
                    ) : (
                      <Monitor size={24} strokeWidth={1.5} />
                    )}
                  </div>
                  <span className="source-name">{src.name}</span>
                </button>
              ))
            )}
          </div>

          {previewing && selectedSource && (
            <div className="selected-source-info">
              <Monitor size={14} />
              <span>{selectedSource.name}</span>
            </div>
          )}

          <div className="record-footer">
            <button
              className="btn-record-start"
              disabled={!selectedSource}
              onClick={startRecording}
            >
              <Circle size={14} fill="currentColor" />
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
