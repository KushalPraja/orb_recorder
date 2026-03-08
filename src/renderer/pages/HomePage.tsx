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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { RecordingInfo } from '../../shared/types';
import type { NavigateFunction } from '../types';

const api = window.electronAPI;

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
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

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

  return (
    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <Input
        ref={inputRef}
        className="h-7 text-xs font-medium rounded-md"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={commit}
        maxLength={120}
        autoFocus
      />
    </div>
  );
}

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
    <div
      className="group flex items-center gap-3 mx-2 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-100 hover:bg-secondary/50 active:bg-secondary/70"
      onClick={() => !renaming && onOpen(rec)}
    >
      <div className="w-8 h-8 rounded-md bg-secondary/70 flex items-center justify-center shrink-0">
        <Video size={14} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {renaming ? (
          <InlineRename
            value={rec.name}
            onSave={handleRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="text-[13px] font-medium text-foreground truncate">
            {rec.name || 'Untitled'}
          </span>
        )}
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock size={10} />
            {formatDate(rec.timestamp)}
          </span>
          {rec.duration && (
            <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
              {formatDuration(rec.duration)}
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <HardDrive size={10} />
            {formatSize(rec.size)}
          </span>
        </div>
      </div>

      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-md"
          onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
          title="Rename"
        >
          <Pencil size={12} />
        </Button>
        {rec.outputPath && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-md"
            onClick={(e) => { e.stopPropagation(); api.openOutput(rec.outputPath!); }}
            title="Show in folder"
          >
            <FolderOpen size={12} />
          </Button>
        )}
        <Button
          variant={confirmDelete ? 'destructive' : 'ghost'}
          size="icon-xs"
          className="rounded-md"
          onClick={handleDeleteClick}
          title={confirmDelete ? 'Click again to confirm' : 'Delete'}
        >
          {confirmDelete ? <Check size={12} /> : <Trash2 size={12} />}
        </Button>
      </div>

      <ChevronRight
        size={13}
        className="shrink-0 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
}

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

  useEffect(() => { loadRecordings(); }, [loadRecordings]);

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
        prev.map((r) => r.sessionDir === sessionDir ? { ...r, name: saved } : r),
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Projects</h2>
          <Badge variant="secondary" className="text-[10px] font-mono rounded-full px-1.5 py-0">
            {recordings.length}
          </Badge>
        </div>
        <Button size="sm" className="rounded-md gap-1.5" onClick={() => onNavigate('record')}>
          <Plus size={13} />
          New Recording
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-0.5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : recordings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2.5">
              <div className="w-10 h-10 rounded-lg bg-secondary/60 flex items-center justify-center">
                <Video size={18} strokeWidth={1.5} className="text-muted-foreground" />
              </div>
              <span className="text-sm text-muted-foreground">
                No projects yet
              </span>
              <Button variant="outline" size="sm" className="rounded-md gap-1.5" onClick={() => onNavigate('record')}>
                <Plus size={13} />
                New Recording
              </Button>
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
      </ScrollArea>
    </div>
  );
}
