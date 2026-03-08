import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Download,
  Loader2,
  Film,
  Layers,
  Play,
  Pause,
  Scissors,
  Sparkles,
  SkipBack,
  SkipForward,
  ArrowLeft,
  RotateCcw,
  FolderOpen,
  Trash2,
  X,
} from 'lucide-react';
import { Player, type PlayerRef } from '@remotion/player';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { ZoomTimeline } from '@/components/ZoomTimeline';
import { ZoomComposition, type ZoomCompositionProps } from '@/components/remotion/ZoomComposition';
import type { NavigateFunction, ReviewData } from '../types';
import type { ImageBlur, InputEvent, RecordingMeta } from '../../shared/types';

const api = window.electronAPI;

interface GradientPreset { name: string; start: string; end: string; }

const GRADIENT_PRESETS: GradientPreset[] = [
  { name: 'Graphite', start: '#1a1a1a', end: '#0f0f0f' },
  { name: 'Steel', start: '#2a2a2a', end: '#111111' },
  { name: 'Charcoal', start: '#232323', end: '#161616' },
  { name: 'Ocean', start: '#0f2027', end: '#203a43' },
  { name: 'Violet', start: '#16001e', end: '#30115e' },
  { name: 'Forest', start: '#0a1a0f', end: '#1a3a1f' },
  { name: 'Dusk', start: '#1a0a1a', end: '#3a102a' },
  { name: 'Ember', start: '#1a0a00', end: '#2d1200' },
];

const COLOR_PRESETS: string[] = ['#1e293b','#18181b','#2a2a2a','#3a3a3a','#d4d4d4','#f8fafc','#0f172a','#450a0a'];

const WALLPAPERS: string[] = [
  '10-14-Day-Thumb.jpg','10-15-Day-thumb.jpg','10-15-Night-thumb.jpg',
  '11-0-Color-Day-thumbnails.jpg','11-0-Day-thumbnail.jpg','12-Light-thumbnail.jpg',
  '13-Ventura-Light-thumb.jpg','14-Sonoma-Horizon-thumb.jpeg','14-Sonoma-Light-thumb.jpg',
  '15-Sequoia-Dark-thumbnail.jpg','15-Sequoia-Light-thumbnail.jpg',
  '26-Tahoe-Beach-Day-thumb.jpeg','26-Tahoe-Beach-Dusk-thumb.jpeg',
  '26-Tahoe-Dark-6K-thumb.jpeg','26-Tahoe-Light-6K-thumb.jpeg',
];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${ms}`;
}

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ═══════════════════════════════════════════════════════════════════
   VideoTrimmer — professional NLE-style timeline
   ═══════════════════════════════════════════════════════════════════ */

type DragTarget = 'start' | 'end' | 'playhead';

interface VideoTrimmerProps {
  videoSrc: string | null;
  duration: number;
  trimStart: number;
  trimEnd: number;
  onTrimChange: (start: number, end: number) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  events?: InputEvent[];
  autoZoom?: boolean;
  holdDuration?: number;
}

const HANDLE_W = 10; // px width of each trim handle

function VideoTrimmer({
  videoSrc, duration, trimStart, trimEnd, onTrimChange,
  currentTime, onSeek, isPlaying, onPlayPause, onSkipBack, onSkipForward,
  events, autoZoom, holdDuration = 1.5,
}: VideoTrimmerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<DragTarget | null>(null);
  const [thumbnails, setThumbnails] = useState<(string | null)[]>([]);
  const [thumbsLoaded, setThumbsLoaded] = useState(false);

  useEffect(() => {
    if (!videoSrc || !duration || duration <= 0) return;
    let cancelled = false;
    setThumbsLoaded(false);
    const video = document.createElement('video');
    video.src = videoSrc; video.muted = true; video.preload = 'auto';
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    const THUMB_COUNT = 40;
    const thumbs: (string | null)[] = [];

    video.addEventListener('loadeddata', async () => {
      for (let i = 0; i < THUMB_COUNT && !cancelled; i++) {
        const time = ((i + 0.5) / THUMB_COUNT) * duration;
        video.currentTime = Math.min(time, duration - 0.05);
        await new Promise<void>((resolve) => { video.onseeked = () => resolve(); setTimeout(resolve, 600); });
        if (cancelled) break;
        try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); thumbs.push(canvas.toDataURL('image/jpeg', 0.5)); }
        catch { thumbs.push(null); }
      }
      if (!cancelled) { setThumbnails([...thumbs]); setThumbsLoaded(true); }
      video.src = '';
    });
    video.addEventListener('error', () => { if (!cancelled) setThumbsLoaded(true); });
    return () => { cancelled = true; video.src = ''; };
  }, [videoSrc, duration]);

  const posToTime = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !duration) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  }, [duration]);

  const handlePointerDown = useCallback((e: React.PointerEvent, type: DragTarget) => {
    e.preventDefault(); e.stopPropagation();
    setDragging(type);
    document.body.style.cursor = type === 'playhead' ? 'grabbing' : 'ew-resize';
  }, []);

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (dragging) return;
    const time = posToTime(e.clientX);
    onSeek(Math.max(trimStart, Math.min(time, trimEnd)));
  }, [dragging, posToTime, trimStart, trimEnd, onSeek]);

  useEffect(() => {
    if (!dragging) return;
    const MIN_CLIP = 0.5;
    const handleMove = (e: PointerEvent) => {
      const time = posToTime(e.clientX);
      if (dragging === 'start') onTrimChange(Math.max(0, Math.min(time, trimEnd - MIN_CLIP)), trimEnd);
      else if (dragging === 'end') onTrimChange(trimStart, Math.min(duration, Math.max(time, trimStart + MIN_CLIP)));
      else if (dragging === 'playhead') onSeek(Math.max(trimStart, Math.min(time, trimEnd)));
    };
    const handleUp = () => { setDragging(null); document.body.style.cursor = ''; };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => { document.removeEventListener('pointermove', handleMove); document.removeEventListener('pointerup', handleUp); };
  }, [dragging, posToTime, trimStart, trimEnd, duration, onTrimChange, onSeek]);

  const startPct = duration > 0 ? (trimStart / duration) * 100 : 0;
  const endPct = duration > 0 ? (trimEnd / duration) * 100 : 100;
  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const clipDuration = trimEnd - trimStart;

  return (
    <div className="shrink-0 flex flex-col bg-card border-t border-border/60">
      {/* Transport controls */}
      <div className="flex items-center justify-between px-3 h-8">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground tabular-nums">
          <Scissors size={9} className="opacity-50" />
          <span>{formatTime(trimStart)}</span>
          <span className="opacity-30">{'\u2013'}</span>
          <span>{formatTime(trimEnd)}</span>
        </div>

        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" className="rounded-sm" onClick={onSkipBack}>
            <SkipBack size={11} />
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            className="rounded-sm"
            onClick={onPlayPause}
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-px" />}
          </Button>
          <Button variant="ghost" size="icon-xs" className="rounded-sm" onClick={onSkipForward}>
            <SkipForward size={11} />
          </Button>
        </div>

        <div className="flex items-center gap-1 font-mono tabular-nums">
          <span className="text-[11px] font-medium text-foreground">
            {formatTime(currentTime)}
          </span>
          <span className="text-[10px] text-muted-foreground/40">/</span>
          <span className="text-[10px] text-muted-foreground">
            {formatTime(clipDuration)}
          </span>
        </div>
      </div>

      {/* Timeline tracks — thumbnail strip + optional zoom bar, with shared scrubber */}
      <div className="px-[10px] pb-1">
        <div
          className="relative bg-muted rounded-sm cursor-pointer select-none"
          ref={trackRef}
          onClick={handleTrackClick}
        >
          {/* Thumbnail strip */}
          <div className="relative h-11">
            <div className="absolute inset-0 flex rounded-t-sm overflow-hidden">
              {thumbsLoaded && thumbnails.length > 0
                ? thumbnails.map((src, i) =>
                    src ? (
                      <img key={i} src={src} className="flex-1 min-w-0 object-cover" draggable={false} alt="" />
                    ) : (
                      <div key={i} className="flex-1 min-w-0 bg-muted" />
                    ),
                  )
                : (
                    <div className="w-full h-full bg-muted flex items-center justify-center gap-2">
                      <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">Loading timeline...</span>
                    </div>
                  )}
            </div>
          </div>

          {/* Zoom segments bar — separate row below thumbnails */}
          {autoZoom && events && events.length > 0 && duration > 0 && (
            <div className="relative h-3 bg-muted-foreground/10 border-t border-border/30">
              <ZoomTimeline events={events} holdDuration={holdDuration} videoDuration={duration} />
            </div>
          )}

          {/* Dimmed regions — span full height of both bars */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/55 z-[4] pointer-events-none rounded-l-sm"
            style={{ width: `${startPct}%` }}
          />
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/55 z-[4] pointer-events-none rounded-r-sm"
            style={{ width: `${100 - endPct}%` }}
          />

          {/* Selected region top/bottom highlight — spans both bars */}
          <div
            className="absolute top-0 bottom-0 border-y-2 border-primary/50 pointer-events-none z-[5]"
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          />

          {/* Start handle — spans both bars */}
          <div
            className={cn(
              'absolute top-0 bottom-0 z-10 cursor-ew-resize flex items-center justify-center bg-primary/80 hover:bg-primary transition-colors rounded-l-sm',
              dragging === 'start' && 'bg-primary'
            )}
            style={{ left: `${startPct}%`, width: `${HANDLE_W}px` }}
            onPointerDown={(e) => handlePointerDown(e, 'start')}
          >
            <div className="flex gap-[2px]">
              <span className="w-px h-3 bg-primary-foreground/50 rounded-full" />
              <span className="w-px h-3 bg-primary-foreground/50 rounded-full" />
            </div>
          </div>

          {/* End handle — spans both bars */}
          <div
            className={cn(
              'absolute top-0 bottom-0 z-10 cursor-ew-resize flex items-center justify-center bg-primary/80 hover:bg-primary transition-colors rounded-r-sm',
              dragging === 'end' && 'bg-primary'
            )}
            style={{ right: `${100 - endPct}%`, width: `${HANDLE_W}px` }}
            onPointerDown={(e) => handlePointerDown(e, 'end')}
          >
            <div className="flex gap-[2px]">
              <span className="w-px h-3 bg-primary-foreground/50 rounded-full" />
              <span className="w-px h-3 bg-primary-foreground/50 rounded-full" />
            </div>
          </div>

          {/* Playhead — spans both bars */}
          <div
            className={cn(
              'absolute top-0 bottom-0 z-[15] cursor-grab pointer-events-auto flex justify-center',
              dragging === 'playhead' && 'cursor-grabbing'
            )}
            style={{ left: `${playheadPct}%`, width: '12px', transform: 'translateX(-50%)' }}
            onPointerDown={(e) => handlePointerDown(e, 'playhead')}
          >
            <div className="w-px h-full bg-foreground shadow-[0_0_3px_rgba(0,0,0,0.5)]" />
            <div
              className="absolute -top-px left-1/2 -translate-x-1/2 w-0 h-0"
              style={{
                borderLeft: '4px solid transparent',
                borderRight: '4px solid transparent',
                borderTop: '5px solid var(--foreground)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Discard Confirmation Modal
   ═══════════════════════════════════════════════════════════════════ */

function DiscardModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-card border border-border rounded-lg p-5 w-[340px] flex flex-col gap-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Discard Recording</h3>
          <Button variant="ghost" size="icon-xs" className="rounded-sm" onClick={onCancel}>
            <X size={12} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          This will permanently delete this recording and all associated files. This action cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" className="rounded-md px-3" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" className="rounded-md px-3" onClick={onConfirm}>
            <Trash2 size={12} />
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ReviewPage
   ═══════════════════════════════════════════════════════════════════ */

type BgType = 'color' | 'gradient' | 'image';
type SideTab = 'trim' | 'background' | 'effects';

interface ReviewPageProps {
  data: ReviewData | null;
  onNavigate: NavigateFunction;
}

export function ReviewPage({ data, onNavigate }: ReviewPageProps) {
  const [remuxing, setRemuxing] = useState(false);
  const [cleanPath, setCleanPath] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [done, setDone] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoZoom, setAutoZoom] = useState(false);
  const [bgEnabled, setBgEnabled] = useState(true);
  const [bgType, setBgType] = useState<BgType>('gradient');
  const [bgColor, setBgColor] = useState('#1e293b');
  const [gradientIdx, setGradientIdx] = useState(0);
  const [wallpaperIdx, setWallpaperIdx] = useState(0);
  const [imageBlur, setImageBlur] = useState<ImageBlur>('none');
  const [cornerRadius, setCornerRadius] = useState(12);
  const [padding, setPadding] = useState(100);
  const [shadowBlur, setShadowBlur] = useState(0);
  const [sideTab, setSideTab] = useState<SideTab>('trim');
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [loadedEvents, setLoadedEvents] = useState<InputEvent[]>([]);
  const [loadedMeta, setLoadedMeta] = useState<RecordingMeta | null>(null);
  const [videoW, setVideoW] = useState(1920);
  const [videoH, setVideoH] = useState(1080);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    if (!data?.sessionDir) return;
    setRemuxing(true); setError(null);
    api.remuxVideo(data.sessionDir)
      .then((p) => { setCleanPath(p); setRemuxing(false); })
      .catch((err: Error) => { setError(`Failed to prepare video: ${err.message}`); setRemuxing(false); });
  }, [data?.sessionDir]);

  // Load events for zoom preview / timeline
  useEffect(() => {
    if (!data?.sessionDir) return;
    api.loadEvents(data.sessionDir)
      .then((result: { events: InputEvent[]; meta: any }) => {
        setLoadedEvents(result.events || []);
        setLoadedMeta(result.meta || null);
      })
      .catch(() => { /* Events are optional */ });
  }, [data?.sessionDir]);

  useEffect(() => {
    if (cleanPath && videoRef.current) {
      videoRef.current.src = `file://${cleanPath}`;
      videoRef.current.load();
    }
  }, [cleanPath]);

  useEffect(() => {
    const off1 = api.onProgress((d) => { setProgress(d.percent); if (d.phase) setPhase(d.phase); });
    const off2 = api.onProcessingDone((d) => { setOutputPath(d.outputPath); setDone(true); setProcessing(false); setProgress(100); });
    const off3 = api.onProcessingError((d) => { setError(d.error); setProcessing(false); });
    return () => { off1(); off2(); off3(); };
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const dur = v.duration || 0;
    if (Number.isFinite(dur) && dur > 0) { setVideoDuration(dur); setTrimEnd(dur); }
    if (v.videoWidth > 0) setVideoW(v.videoWidth);
    if (v.videoHeight > 0) setVideoH(v.videoHeight);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    const frame = p.getCurrentFrame();
    const time = frame / 30;
    setCurrentTime(time);
    if (time >= trimEnd - 0.05) {
      p.pause();
      p.seekTo(Math.round(trimStart * 30));
      setIsPlaying(false);
    }
  }, [trimStart, trimEnd]);

  // Poll Remotion Player for time updates (it doesn't fire onTimeUpdate like <video>)
  useEffect(() => {
    if (!isPlaying) return;
    let rafId: number;
    const tick = () => {
      handleTimeUpdate();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, handleTimeUpdate]);

  const handlePlayPause = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (isPlaying) {
      p.pause();
      setIsPlaying(false);
    } else {
      const frame = p.getCurrentFrame();
      const t = frame / 30;
      if (t >= trimEnd - 0.1 || t < trimStart || t > trimEnd)
        p.seekTo(Math.round(trimStart * 30));
      p.play();
      setIsPlaying(true);
    }
  }, [isPlaying, trimStart, trimEnd]);

  const handleSeek = useCallback((time: number) => {
    const p = playerRef.current;
    if (p) {
      p.seekTo(Math.round(time * 30));
      setCurrentTime(time);
    }
  }, []);

  const handleTrimChange = useCallback((start: number, end: number) => { setTrimStart(start); setTrimEnd(end); }, []);

  const skipBackward = useCallback(() => { handleSeek(Math.max(trimStart, currentTime - 1)); }, [handleSeek, currentTime, trimStart]);
  const skipForward = useCallback(() => { handleSeek(Math.min(trimEnd, currentTime + 1)); }, [handleSeek, currentTime, trimEnd]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (showDiscardModal) return;
      if (e.code === 'Space') { e.preventDefault(); handlePlayPause(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); skipBackward(); }
      if (e.code === 'ArrowRight') { e.preventDefault(); skipForward(); }
      if (e.code === 'KeyJ') { e.preventDefault(); skipBackward(); }
      if (e.code === 'KeyL') { e.preventDefault(); skipForward(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlePlayPause, skipBackward, skipForward, showDiscardModal]);

  const gradient = GRADIENT_PRESETS[gradientIdx];

  const handleExport = async () => {
    if (!data?.sessionDir) return;
    const defaultName = data.name || 'recording';
    const exportPath = await api.pickExportPath(defaultName);
    if (!exportPath) return;
    setProcessing(true); setError(null); setProgress(0); setDone(false); setOutputPath(null);
    const isTrimmed = trimStart > 0.1 || (videoDuration > 0 && trimEnd < videoDuration - 0.1);
    const exportOpts = {
      sessionDir: data.sessionDir, exportPath, autoZoom,
      background: bgEnabled, cornerRadius: bgEnabled ? cornerRadius : 0,
      padding: bgEnabled ? padding : 0, shadowBlur: bgEnabled ? shadowBlur : 0,
      backgroundType: !bgEnabled ? undefined : bgType === 'color' ? ('solid' as const) : bgType === 'gradient' ? ('gradient' as const) : ('image' as const),
      backgroundColor: bgEnabled && bgType === 'color' ? bgColor : undefined,
      gradientStart: bgEnabled && bgType === 'gradient' ? gradient.start : undefined,
      gradientEnd: bgEnabled && bgType === 'gradient' ? gradient.end : undefined,
      wallpaperFile: bgEnabled && bgType === 'image' ? WALLPAPERS[wallpaperIdx] : undefined,
      imageBlur: bgEnabled && bgType === 'image' ? imageBlur : ('none' as const),
      ...(isTrimmed && { trimStart, trimEnd }),
    };
    try { await api.processVideo(exportOpts); }
    catch (err: any) { setError(err.message); setProcessing(false); }
  };

  const handleDiscard = async () => {
    setShowDiscardModal(false);
    if (!data?.sessionDir) { onNavigate('home'); return; }
    try { setProcessing(true); await api.deleteRecording(data.sessionDir); }
    catch (err: any) { setError(err?.message || 'Failed to delete project'); setProcessing(false); return; }
    setProcessing(false); onNavigate('home');
  };

  const handleOpen = () => { if (outputPath) api.openOutput(outputPath); };
  const handleReExport = () => { setDone(false); setOutputPath(null); setProgress(0); setPhase(''); setError(null); };

  const videoSrc = cleanPath ? `file://${cleanPath}` : null;

  // ── Remotion composition props — re-computed when any setting changes ──
  const fps = 30;
  const pad = bgEnabled ? padding : 0;
  const compositionW = videoW + pad * 2 + ((videoW + pad * 2) % 2);
  const compositionH = videoH + pad * 2 + ((videoH + pad * 2) % 2);
  const totalFrames = Math.max(1, Math.round(videoDuration * fps));

  const compositionProps: ZoomCompositionProps = useMemo(() => ({
    videoSrc: videoSrc || '',
    events: autoZoom ? loadedEvents : [],
    meta: autoZoom ? loadedMeta : null,
    frameW: videoW,
    frameH: videoH,
    zoomFactor: 2.0,
    holdDuration: 1.5,
    withBackground: bgEnabled,
    padding,
    cornerRadius: bgEnabled ? cornerRadius : 0,
    shadowBlur: bgEnabled ? shadowBlur : 0,
    backgroundType: bgType === 'color' ? 'solid' : bgType === 'gradient' ? 'gradient' : 'image',
    backgroundColor: bgColor,
    gradientStart: gradient.start,
    gradientEnd: gradient.end,
    wallpaperFile: bgType === 'image' ? WALLPAPERS[wallpaperIdx] : undefined,
    imageBlur: bgType === 'image' ? imageBlur : 'none',
    isPlaying,
  }), [videoSrc, loadedEvents, loadedMeta, videoW, videoH, autoZoom, bgEnabled, padding,
    cornerRadius, shadowBlur, bgType, bgColor, gradient, wallpaperIdx, imageBlur, isPlaying]);

  if (!data) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-3 flex-1 text-muted-foreground text-sm">
          <p>No recording to review</p>
          <Button variant="outline" size="sm" className="rounded-md" onClick={() => onNavigate('home')}>Go Home</Button>
        </div>
      </div>
    );
  }

  if (remuxing) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Preparing preview...</p>
          <span className="text-xs text-muted-foreground">Converting to seekable format</span>
        </div>
      </div>
    );
  }

  const sideTabItems = [
    { id: 'trim' as const, icon: Scissors, label: 'Trim' },
    { id: 'background' as const, icon: Layers, label: 'Background' },
    { id: 'effects' as const, icon: Sparkles, label: 'Effects' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Discard confirmation modal */}
      {showDiscardModal && (
        <DiscardModal
          onConfirm={handleDiscard}
          onCancel={() => setShowDiscardModal(false)}
        />
      )}

      {/* Header with export/discard actions */}
      <div className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-border/50 bg-card/30">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon-xs" className="rounded-sm shrink-0" onClick={() => onNavigate('home')}>
            <ArrowLeft size={13} />
          </Button>
          <h2 className="text-xs font-semibold text-foreground truncate">{data.name || 'Export'}</h2>
          <div className="flex items-center gap-1 shrink-0">
            {data.size && (
              <Badge variant="secondary" className="text-[10px] font-mono rounded-sm px-1.5 py-0">
                {(data.size / (1024 * 1024)).toFixed(1)} MB
              </Badge>
            )}
            {videoDuration > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono rounded-sm px-1.5 py-0">
                {formatTimecode(videoDuration)}
              </Badge>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {processing && (
            <div className="flex items-center gap-2 mr-1">
              <div className="w-24">
                <Progress value={progress} className="h-1" />
              </div>
              <span className="text-[10px] text-muted-foreground font-mono tabular-nums whitespace-nowrap">
                {phase || 'Processing'} {progress}%
              </span>
            </div>
          )}
          {done ? (
            <>
              <Button size="sm" className="rounded-md gap-1 h-6 text-[11px] px-2.5" onClick={handleOpen}>
                <FolderOpen size={11} /> Open
              </Button>
              <Button variant="outline" size="sm" className="rounded-md gap-1 h-6 text-[11px] px-2.5" onClick={handleReExport}>
                <RotateCcw size={11} /> Re-export
              </Button>
              <Button variant="outline" size="sm" className="rounded-md h-6 text-[11px] px-2.5" onClick={() => onNavigate('home')}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-md gap-1 h-6 text-[11px] px-2 text-muted-foreground hover:text-destructive"
                onClick={() => setShowDiscardModal(true)}
                disabled={processing}
              >
                <Trash2 size={11} />
                Discard
              </Button>
              <Button size="sm" className="rounded-md gap-1 h-6 text-[11px] px-3" onClick={handleExport} disabled={processing}>
                {processing ? (<><Loader2 size={11} className="animate-spin" /> Exporting...</>) : (<><Download size={11} /> Export</>)}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Hidden video element — used only for duration detection + thumbnail generation */}
      <video
        ref={videoRef}
        className="hidden"
        onLoadedMetadata={handleLoadedMetadata}
        muted
      />

      {/* Body: video + sidebar */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        {/* Left: Remotion Player preview — renders the actual composition */}
        <div className="flex-1 min-w-0 flex items-center justify-center bg-background overflow-hidden">
          {videoSrc && videoDuration > 0 ? (
            <Player
              ref={playerRef}
              component={ZoomComposition}
              inputProps={compositionProps}
              compositionWidth={compositionW}
              compositionHeight={compositionH}
              durationInFrames={totalFrames}
              fps={fps}
              style={{
                width: '100%',
                height: '100%',
                maxWidth: '100%',
                maxHeight: '100%',
              }}
              controls={false}
              autoPlay={false}
              loop={false}
            />
          ) : (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">Loading preview...</span>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-[270px] shrink-0 flex flex-row bg-card/50 border-l border-border/50 h-full overflow-hidden">
          {/* Tab strip */}
          <div className="w-9 shrink-0 flex flex-col items-center bg-background/50 pt-1.5 gap-0.5">
            {sideTabItems.map(({ id, icon: Icon, label }) => (
              <Button
                key={id}
                variant="ghost"
                size="icon-sm"
                className={cn(
                  'rounded-sm transition-colors duration-100',
                  sideTab === id
                    ? 'text-foreground bg-secondary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setSideTab(id)}
                title={label}
              >
                <Icon size={13} />
              </Button>
            ))}
          </div>

          {/* Tab content */}
          <ScrollArea className="flex-1 min-w-0 h-full">
            {sideTab === 'trim' && (
              <div className="flex flex-col">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trim</div>
                <div className="mx-3 bg-secondary/30 rounded-md overflow-hidden divide-y divide-border/30">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-[11px] text-muted-foreground">Start</span>
                    <span className="text-[11px] text-foreground font-medium font-mono tabular-nums">{formatTime(trimStart)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-[11px] text-muted-foreground">End</span>
                    <span className="text-[11px] text-foreground font-medium font-mono tabular-nums">{formatTime(trimEnd)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-[11px] text-muted-foreground">Duration</span>
                    <span className="text-[11px] text-foreground font-semibold font-mono tabular-nums">{formatTime(trimEnd - trimStart)}</span>
                  </div>
                </div>
              </div>
            )}

            {sideTab === 'background' && (
              <div className="flex flex-col">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Background</div>
                <div className="mx-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-medium text-foreground">Enable</span>
                      <span className="text-[9px] text-muted-foreground">Canvas behind video</span>
                    </div>
                    <Switch checked={bgEnabled} onCheckedChange={setBgEnabled} />
                  </div>

                  <div className={cn('flex flex-col gap-2.5 overflow-hidden transition-all duration-200', bgEnabled ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0')}>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Style</span>
                      <ToggleGroup
                        value={[bgType]}
                        onValueChange={(v) => { const val = v[v.length - 1]; if (val) setBgType(val as BgType); }}
                        className="w-full"
                      >
                        <ToggleGroupItem value="color" className="flex-1 text-[10px] rounded-sm">Color</ToggleGroupItem>
                        <ToggleGroupItem value="gradient" className="flex-1 text-[10px] rounded-sm">Gradient</ToggleGroupItem>
                        <ToggleGroupItem value="image" className="flex-1 text-[10px] rounded-sm">Image</ToggleGroupItem>
                      </ToggleGroup>
                    </div>

                    {bgType === 'color' && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Color</span>
                          <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)}
                            className="w-6 h-5 p-0 border border-border rounded-sm bg-transparent cursor-pointer shrink-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm" />
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {COLOR_PRESETS.map((c, i) => (
                            <button key={i}
                              className={cn('w-5 h-5 rounded-sm border-2 border-transparent cursor-pointer transition-all hover:scale-110', bgColor === c && 'border-foreground/40 ring-1 ring-foreground/10')}
                              style={{ background: c }} title={c} onClick={() => setBgColor(c)} />
                          ))}
                        </div>
                      </div>
                    )}

                    {bgType === 'gradient' && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Preset</span>
                        <div className="flex gap-1.5 flex-wrap">
                          {GRADIENT_PRESETS.map((g, i) => (
                            <button key={i}
                              className={cn('w-5 h-5 rounded-sm border-2 border-transparent cursor-pointer transition-all hover:scale-110', gradientIdx === i && 'border-foreground/40 ring-1 ring-foreground/10')}
                              style={{ background: `linear-gradient(135deg, ${g.start}, ${g.end})` }} title={g.name} onClick={() => setGradientIdx(i)} />
                          ))}
                        </div>
                      </div>
                    )}

                    {bgType === 'image' && (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Wallpaper</span>
                          <div className="grid grid-cols-4 gap-1.5">
                            {WALLPAPERS.map((w, i) => (
                              <button key={i}
                                className={cn('aspect-[16/10] bg-cover bg-center rounded-sm border-2 border-transparent cursor-pointer transition-all p-0 hover:scale-105', wallpaperIdx === i && 'border-foreground/40 ring-1 ring-foreground/10')}
                                style={{ backgroundImage: `url(./Wallpapers/${w})` }}
                                title={w.replace(/-thumb\.(jpg|jpeg)$/i, '').replace(/-thumbnail\.(jpg|jpeg)$/i, '')}
                                onClick={() => setWallpaperIdx(i)} />
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Blur</span>
                          <ToggleGroup value={[imageBlur]} onValueChange={(v) => { const val = v[v.length - 1]; if (val) setImageBlur(val as ImageBlur); }} className="w-full">
                            <ToggleGroupItem value="none" className="flex-1 text-[10px] rounded-sm">None</ToggleGroupItem>
                            <ToggleGroupItem value="moderate" className="flex-1 text-[10px] rounded-sm">Moderate</ToggleGroupItem>
                            <ToggleGroupItem value="strong" className="flex-1 text-[10px] rounded-sm">Strong</ToggleGroupItem>
                          </ToggleGroup>
                        </div>
                      </>
                    )}

                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between px-1">
                          <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Radius</Label>
                          <span className="text-[10px] font-medium text-foreground/60 font-mono tabular-nums">{cornerRadius}px</span>
                        </div>
                        <div className="px-1">
                          <Slider min={0} max={32} value={[cornerRadius]} onValueChange={(v) => setCornerRadius(Array.isArray(v) ? v[0] : v)} />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between px-1">
                          <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Padding</Label>
                          <span className="text-[10px] font-medium text-foreground/60 font-mono tabular-nums">{padding}px</span>
                        </div>
                        <div className="px-1">
                          <Slider min={16} max={150} value={[padding]} onValueChange={(v) => setPadding(Array.isArray(v) ? v[0] : v)} />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between px-1">
                          <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Shadow</Label>
                          <span className="text-[10px] font-medium text-foreground/60 font-mono tabular-nums">{shadowBlur === 0 ? 'None' : `${shadowBlur}px`}</span>
                        </div>
                        <div className="px-1">
                          <Slider min={0} max={40} value={[shadowBlur]} onValueChange={(v) => setShadowBlur(Array.isArray(v) ? v[0] : v)} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {sideTab === 'effects' && (
              <div className="flex flex-col">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Effects</div>
                <div className="mx-3 bg-secondary/30 rounded-md overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Film size={12} className="text-muted-foreground" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-medium text-foreground">Auto-Zoom</span>
                        <span className="text-[9px] text-muted-foreground">Follow cursor clicks</span>
                      </div>
                    </div>
                    <Switch checked={autoZoom} onCheckedChange={setAutoZoom} />
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Timeline — full width at bottom */}
      {videoDuration > 0 && (
        <VideoTrimmer
          videoSrc={videoSrc}
          duration={videoDuration}
          trimStart={trimStart}
          trimEnd={trimEnd}
          onTrimChange={handleTrimChange}
          currentTime={currentTime}
          onSeek={handleSeek}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onSkipBack={skipBackward}
          onSkipForward={skipForward}
          events={loadedEvents}
          autoZoom={autoZoom}
        />
      )}

      {/* Error display */}
      {error && (
        <div className="mx-3 my-1 px-3 py-1.5 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-[11px] shrink-0">
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
