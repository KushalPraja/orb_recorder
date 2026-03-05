import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Video,
  Plus,
  Trash2,
  FolderOpen,
  Clock,
  HardDrive,
  Pencil,
  Check,
  ChevronRight,
} from 'lucide-react';
import type { RecordingInfo } from '../../shared/types';
import type { NavigateFunction } from '../types';
import './HomePage.css';

const api = window.electronAPI;

/* ─── Helpers ─────────────────────────────────────────────────────── */

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatSize(bytes: number | undefined): string {
  if (!bytes) return '\u2014';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ─── Inline Rename Input ─────────────────────────────────────────── */

interface InlineRenameProps {
  value: string;
  onSave: (newName: string) => void;
  onCancel: () => void;
}

function InlineRename({ value, onSave, onCancel }: InlineRenameProps) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="hp-rename-wrap" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="hp-rename-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        maxLength={120}
        autoFocus
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ProjectCard — single recording in the list
   ═══════════════════════════════════════════════════════════════════ */

interface ProjectCardProps {
  rec: RecordingInfo;
  onOpen: (rec: RecordingInfo) => void;
  onDelete: (sessionDir: string) => void;
  onRename: (sessionDir: string, newName: string) => Promise<void>;
}

function ProjectCard({ rec, onOpen, onDelete, onRename }: ProjectCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleRename = async (newName: string) => {
    setRenaming(false);
    await onRename(rec.sessionDir, newName);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(rec.sessionDir);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div className="hp-card" onClick={() => !renaming && onOpen(rec)}>
      {/* Left: icon + info */}
      <div className="hp-card-body">
        {renaming ? (
          <InlineRename
            value={rec.name}
            onSave={handleRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="hp-card-name">{rec.name || 'Untitled'}</span>
        )}
        <div className="hp-card-meta">
          <span className="hp-meta-item">
            <Clock size={10} />
            {formatDate(rec.timestamp)}
          </span>
          {rec.duration && (
            <span className="hp-meta-item">{formatDuration(rec.duration)}</span>
          )}
          <span className="hp-meta-item">
            <HardDrive size={10} />
            {formatSize(rec.size)}
          </span>
        </div>
      </div>

      {/* Right: actions */}
      <div className="hp-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="hp-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            setRenaming(true);
          }}
          title="Rename"
        >
          <Pencil size={12} />
        </button>
        {rec.outputPath && (
          <button
            className="hp-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              api.openOutput(rec.outputPath!);
            }}
            title="Show in folder"
          >
            <FolderOpen size={12} />
          </button>
        )}
        <button
          className={`hp-action-btn ${confirmDelete ? 'hp-action-btn--danger-active' : 'hp-action-btn--danger'}`}
          onClick={handleDeleteClick}
          title={confirmDelete ? 'Click again to confirm' : 'Delete'}
        >
          {confirmDelete ? <Check size={12} /> : <Trash2 size={12} />}
        </button>
      </div>

      <ChevronRight size={14} className="hp-card-chevron" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HomePage — projects list
   ═══════════════════════════════════════════════════════════════════ */

interface HomePageProps {
  onNavigate: NavigateFunction;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
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

  const handleDelete = async (sessionDir: string) => {
    try {
      await api.deleteRecording(sessionDir);
      setRecordings((prev) => prev.filter((r) => r.sessionDir !== sessionDir));
    } catch (err) {
      console.error('Failed to delete recording:', err);
    }
  };

  const handleRename = async (sessionDir: string, newName: string) => {
    try {
      const saved = await api.renameRecording(sessionDir, newName);
      setRecordings((prev) =>
        prev.map((r) =>
          r.sessionDir === sessionDir ? { ...r, name: saved } : r,
        ),
      );
    } catch (err) {
      console.error('Failed to rename recording:', err);
    }
  };

  const handleOpenProject = (rec: RecordingInfo) => {
    onNavigate('review', {
      sessionDir: rec.sessionDir,
      name: rec.name,
      size: rec.size,
      filePath: rec.filePath,
      fromHome: true,
    });
  };

  return (
    <div className="home-page">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="hp-header">
        <div className="hp-header-left">
          <h2>Projects</h2>
          <span className="hp-count">{recordings.length}</span>
        </div>
        <button className="hp-new-btn" onClick={() => onNavigate('record')}>
          <Plus size={14} />
          <span>New Recording</span>
        </button>
      </div>

      {/* ── List ────────────────────────────────────────────────── */}
      <div className="hp-list">
        {loading ? (
          <div className="hp-empty">
            <span className="hp-empty-text">Loading\u2026</span>
          </div>
        ) : recordings.length === 0 ? (
          <div className="hp-empty">
            <Video size={28} strokeWidth={1.5} className="hp-empty-icon" />
            <span className="hp-empty-title">No projects yet</span>
            <span className="hp-empty-text">
              Create a new recording to get started
            </span>
            <button
              className="hp-new-btn hp-new-btn--ghost"
              onClick={() => onNavigate('record')}
            >
              <Plus size={14} />
              <span>New Recording</span>
            </button>
          </div>
        ) : (
          recordings.map((rec) => (
            <ProjectCard
              key={rec.sessionDir}
              rec={rec}
              onOpen={handleOpenProject}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          ))
        )}
      </div>
    </div>
  );
}
