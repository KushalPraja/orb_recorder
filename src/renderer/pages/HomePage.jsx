import React, { useState, useEffect, useCallback } from 'react';
import { Video, Plus, Trash2, FolderOpen, Clock, HardDrive } from 'lucide-react';
import './HomePage.css';

const api = window.electronAPI;

export function HomePage({ onNavigate }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadRecordings = useCallback(async () => {
    try {
      setLoading(true);
      const list = await api.getRecordings();
      setRecordings(list || []);
    } catch (err) {
      console.error('Failed to load recordings:', err);
      setRecordings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  const handleDelete = async (sessionDir) => {
    try {
      await api.deleteRecording(sessionDir);
      setRecordings((prev) => prev.filter((r) => r.sessionDir !== sessionDir));
    } catch (err) {
      console.error('Failed to delete recording:', err);
    }
  };

  const handleOpen = (filePath) => {
    api.openOutput(filePath);
  };

  const formatDate = (timestamp) => {
    const d = new Date(timestamp);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="home-page">
      <div className="home-header">
        <div className="home-header-left">
          <h1>Recordings</h1>
          <span className="recording-count">{recordings.length}</span>
        </div>
        <button className="btn-new-recording" onClick={() => onNavigate('record')}>
          <Plus size={16} />
          <span>New Recording</span>
        </button>
      </div>

      <div className="recordings-list">
        {loading ? (
          <div className="empty-state">
            <p className="empty-text">Loading...</p>
          </div>
        ) : recordings.length === 0 ? (
          <div className="empty-state">
            <Video size={32} strokeWidth={1.5} className="empty-icon" />
            <p className="empty-title">No recordings yet</p>
            <p className="empty-text">
              Click "New Recording" to capture your screen
            </p>
          </div>
        ) : (
          recordings.map((rec) => (
            <div key={rec.sessionDir} className="recording-item">
              <div className="recording-thumbnail">
                {rec.thumbnailPath ? (
                  <img src={`file://${rec.thumbnailPath}`} alt="" />
                ) : (
                  <Video size={20} strokeWidth={1.5} />
                )}
              </div>
              <div className="recording-info">
                <span className="recording-name">{rec.name || 'Untitled Recording'}</span>
                <div className="recording-meta">
                  <span className="meta-item">
                    <Clock size={11} />
                    {formatDate(rec.timestamp)}
                  </span>
                  {rec.duration && (
                    <span className="meta-item">
                      {formatDuration(rec.duration)}
                    </span>
                  )}
                  {rec.size && (
                    <span className="meta-item">
                      <HardDrive size={11} />
                      {formatSize(rec.size)}
                    </span>
                  )}
                </div>
              </div>
              <div className="recording-actions">
                {rec.outputPath && (
                  <button
                    className="icon-btn"
                    onClick={() => handleOpen(rec.outputPath)}
                    title="Show in folder"
                  >
                    <FolderOpen size={14} />
                  </button>
                )}
                <button
                  className="icon-btn icon-btn-danger"
                  onClick={() => handleDelete(rec.sessionDir)}
                  title="Delete recording"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
