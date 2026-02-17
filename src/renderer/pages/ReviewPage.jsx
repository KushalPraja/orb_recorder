import React, { useState, useRef, useEffect } from 'react';
import { Play, Trash2, Download, Check, Loader2 } from 'lucide-react';
import './ReviewPage.css';

const api = window.electronAPI;

export function ReviewPage({ data, onNavigate }) {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [outputPath, setOutputPath] = useState(null);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

  // Listen for processing progress
  useEffect(() => {
    const unsubProgress = api.onProgress((d) => {
      setProgress(d.percent);
    });

    const unsubDone = api.onProcessingDone((d) => {
      setOutputPath(d.outputPath);
      setDone(true);
      setProcessing(false);
      setProgress(100);
    });

    const unsubError = api.onProcessingError((d) => {
      setError(d.error);
      setProcessing(false);
    });

    return () => {
      unsubProgress();
      unsubDone();
      unsubError();
    };
  }, []);

  // Load video preview
  useEffect(() => {
    if (data?.filePath && videoRef.current) {
      videoRef.current.src = `file://${data.filePath}`;
    }
  }, [data]);

  const handleProcess = async () => {
    if (!data?.sessionDir) return;
    setProcessing(true);
    setError(null);
    setProgress(0);
    try {
      await api.processVideo({ sessionDir: data.sessionDir });
    } catch (err) {
      setError(err.message);
      setProcessing(false);
    }
  };

  const handleDiscard = async () => {
    if (data?.sessionDir) {
      try {
        await api.deleteRecording(data.sessionDir);
      } catch {}
    }
    onNavigate('home');
  };

  const handleOpen = () => {
    if (outputPath) api.openOutput(outputPath);
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!data) {
    return (
      <div className="review-page">
        <div className="review-empty">
          <p>No recording to review</p>
          <button className="btn-secondary" onClick={() => onNavigate('home')}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-page">
      <div className="review-header">
        <h2>Review Recording</h2>
        {data.size && (
          <span className="review-meta">{formatSize(data.size)}</span>
        )}
      </div>

      <div className="review-preview">
        <video
          ref={videoRef}
          controls
          className="review-video"
        />
      </div>

      {processing && (
        <div className="review-progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="progress-label">Processing... {progress}%</span>
        </div>
      )}

      {error && (
        <div className="review-error">
          <p>{error}</p>
        </div>
      )}

      <div className="review-actions">
        {done ? (
          <>
            <button className="btn-primary" onClick={handleOpen}>
              <Check size={14} />
              <span>Open Output</span>
            </button>
            <button className="btn-secondary" onClick={() => onNavigate('home')}>
              Done
            </button>
          </>
        ) : (
          <>
            <button
              className="btn-primary"
              onClick={handleProcess}
              disabled={processing}
            >
              {processing ? (
                <>
                  <Loader2 size={14} className="spinner" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Download size={14} />
                  <span>Auto-Edit & Export</span>
                </>
              )}
            </button>
            <button
              className="btn-danger"
              onClick={handleDiscard}
              disabled={processing}
            >
              <Trash2 size={14} />
              <span>Discard</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
