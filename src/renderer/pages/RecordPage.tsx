import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Monitor, AppWindow, Loader2, Volume2, VolumeX, Square, Pause as PauseIcon, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import type { CaptureSource } from '../../shared/types';
import type { NavigateFunction } from '../types';

const api = window.electronAPI;

interface RecordPageProps {
  onNavigate: NavigateFunction;
}

type SourceTab = 'screens' | 'windows';

export function RecordPage({ onNavigate }: RecordPageProps) {
  const { settings } = useSettings();

  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<CaptureSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SourceTab>('screens');
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(true);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState('Select a screen to record');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<{ sessionDir: string; startTime: number } | null>(null);
  const discardingRef = useRef(false);
  const videoStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const srcs = await api.getSources();
        if (!cancelled) { setSources(Array.isArray(srcs) ? srcs : []); setLoading(false); }
      } catch (err) {
        console.error('Failed to get sources:', err);
        if (!cancelled) { setLoading(false); setStatus('Failed to detect screens'); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const selectSource = useCallback((source: CaptureSource) => {
    setSelectedSource(source);
    setStatus('Ready to record');
  }, []);

  const displaySources = sources.filter((s) => s.type === 'screen');
  const windowSources = sources.filter((s) => s.type === 'window');
  const visibleSources = activeTab === 'screens' ? displaySources : windowSources;

  const startRecording = useCallback(async () => {
    if (!selectedSource) return;
    let stream = streamRef.current;
    await api.setCaptureSource(selectedSource.id);

    if (!stream || stream.getTracks().every((t) => t.readyState !== 'live')) {
      try {
        const constraints: any = {
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selectedSource.id, minFrameRate: settings?.fps ?? 30, maxFrameRate: settings?.fps ?? 30 } },
          audio: systemAudioEnabled ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
      } catch { setStatus('Screen access denied'); return; }
    }

    setStatus('Starting...');
    await api.prepareRecordingUi();
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') { setStatus('Screen capture ended. Try again.'); return; }

    try {
      const session = await api.startRecording();
      sessionRef.current = session;
      chunksRef.current = [];
      let mimeType = 'video/webm; codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
      recorder.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => { stream!.getTracks().forEach((t) => t.stop()); streamRef.current = null; await handleRecordingStopped(); };
      track.addEventListener('ended', () => { if (mediaRecorderRef.current?.state !== 'inactive') stopRecording(); });

      recorder.start(1000);
      videoStartTimeRef.current = Date.now();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setPaused(false);
      setElapsed(0);
      setStatus('Recording...');

      const start = Date.now();
      timerRef.current = setInterval(() => { setElapsed(Math.floor((Date.now() - start) / 1000)); }, 1000);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
      stream.getTracks().forEach((t) => t.stop());
    }
  }, [selectedSource, settings, systemAudioEnabled]);

  async function stopRecording() {
    if (!mediaRecorderRef.current) return;
    setRecording(false);
    setPaused(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const recorder = mediaRecorderRef.current;
    if (recorder.state !== 'inactive') {
      if (recorder.state === 'recording') { try { recorder.requestData(); } catch {} await new Promise((r) => setTimeout(r, 200)); }
      recorder.stop();
    }
    try { await api.stopRecording(videoStartTimeRef.current ?? undefined); await api.finishRecordingUi(); setStatus('Saving recording...'); }
    catch (err) { console.error('Failed to stop tracking:', err); await api.finishRecordingUi(); }
  }

  function togglePause() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      try { recorder.pause(); } catch {}
      setPaused(true);
    } else if (recorder.state === 'paused') {
      try { recorder.resume(); } catch {}
      setPaused(false);
    }
  }

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      if (e.code === 'Escape') { e.preventDefault(); stopRecording(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [recording]);

  useEffect(() => {
    const unsubStop = api.onOverlayStopRequest(() => { stopRecording(); });
    const unsubPause = api.onOverlayPauseRequest(() => { if (mediaRecorderRef.current?.state === 'recording') { try { mediaRecorderRef.current.pause(); } catch {} setPaused(true); } });
    const unsubResume = api.onOverlayResumeRequest(() => { if (mediaRecorderRef.current?.state === 'paused') { try { mediaRecorderRef.current.resume(); } catch {} setPaused(false); } });
    const unsubDiscard = api.onOverlayDiscardRequest(() => { discardRecording(); });
    return () => { unsubStop(); unsubPause(); unsubResume(); unsubDiscard(); };
  }, []);

  async function discardRecording() {
    if (!mediaRecorderRef.current) return;
    discardingRef.current = true;
    setRecording(false);
    setPaused(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const recorder = mediaRecorderRef.current;
    if (recorder.state !== 'inactive') { try { recorder.stop(); } catch {} }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    try { await api.stopRecording(videoStartTimeRef.current ?? undefined); await api.finishRecordingUi(); } catch {}
    chunksRef.current = [];
    setElapsed(0);
    setStatus('Recording discarded. Select a screen to record.');
  }

  const handleRecordingStopped = useCallback(async () => {
    if (discardingRef.current) { discardingRef.current = false; return; }
    try {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      if (blob.size === 0) { setStatus('Recording is empty. Try again.'); return; }
      const arrayBuffer = await blob.arrayBuffer();
      const savedPath = await api.saveRecording(arrayBuffer);
      onNavigate('review', { sessionDir: sessionRef.current?.sessionDir ?? '', filePath: savedPath, size: blob.size, duration: elapsed });
    } catch (err: any) { setStatus(`Save error: ${err.message}`); }
  }, [onNavigate, elapsed]);

  const formatTime = (secs: number): string => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {!recording && (
        <>
          <div className="px-5 pt-4 pb-2.5 shrink-0">
            <h2 className="text-sm font-semibold text-foreground">Select Source</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{status}</p>
          </div>

          <div className="px-5 pb-2.5 shrink-0">
            <Tabs
              value={activeTab}
              onValueChange={(v) => { setActiveTab(v as SourceTab); setSelectedSource(null); }}
            >
              <TabsList className="rounded-md">
                <TabsTrigger value="screens" className="gap-1.5 rounded-sm">
                  <Monitor size={13} />
                  Displays ({displaySources.length})
                </TabsTrigger>
                <TabsTrigger value="windows" className="gap-1.5 rounded-sm">
                  <AppWindow size={13} />
                  Windows ({windowSources.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5 px-5 pb-3">
            {loading ? (
              <div className="col-span-full flex flex-col items-center gap-2 py-10 text-muted-foreground text-xs">
                <Loader2 size={18} className="animate-spin" />
                <span>Detecting sources...</span>
              </div>
            ) : visibleSources.length === 0 ? (
              <div className="col-span-full flex flex-col items-center gap-2 py-10 text-muted-foreground text-xs">
                <Monitor size={18} />
                <span>No {activeTab === 'screens' ? 'displays' : 'windows'} detected</span>
              </div>
            ) : (
              visibleSources.map((src) => (
                <button
                  key={src.id}
                  className={cn(
                    'bg-card border border-border rounded-lg p-2 cursor-pointer flex flex-col gap-1.5 transition-all duration-100',
                    'hover:border-foreground/20 hover:bg-card/80',
                    selectedSource?.id === src.id && 'border-foreground/40 ring-1 ring-foreground/10 bg-secondary/30'
                  )}
                  onClick={() => selectSource(src)}
                >
                  <div className="w-full aspect-[16/10] bg-background rounded-md flex items-center justify-center overflow-hidden text-muted-foreground">
                    {src.thumbnail ? (
                      <img src={src.thumbnail} alt={src.name} className="w-full h-full object-cover rounded-md" />
                    ) : activeTab === 'windows' ? (
                      <AppWindow size={20} strokeWidth={1.5} />
                    ) : (
                      <Monitor size={20} strokeWidth={1.5} />
                    )}
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground truncate px-0.5">
                    {src.name}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="px-5 py-3 flex items-center gap-3 shrink-0 mt-auto border-t border-border/50">
            <div className="flex items-center gap-2">
              <Switch id="system-audio" checked={systemAudioEnabled} onCheckedChange={setSystemAudioEnabled} />
              <Label htmlFor="system-audio" className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                {systemAudioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                System Audio
              </Label>
            </div>
            <Button className="ml-auto rounded-md px-5" disabled={!selectedSource} onClick={startRecording}>
              Start Recording
            </Button>
          </div>
        </>
      )}

      {recording && (
        <div className="flex flex-col items-center justify-center gap-4 flex-1 px-5 py-8">
          <div
            className="w-2.5 h-2.5 rounded-full bg-destructive"
            style={{ animation: paused ? 'none' : 'pulse-dot 2s ease-in-out infinite' }}
          />
          <span className="text-5xl font-semibold font-mono tabular-nums text-foreground tracking-wider">
            {formatTime(elapsed)}
          </span>
          <p className="text-sm text-muted-foreground">
            {paused ? 'Paused' : 'Recording in progress'}
          </p>
          <div className="flex items-center gap-2.5 mt-1">
            <Button
              variant="outline"
              size="lg"
              className="rounded-md gap-2 px-4"
              onClick={togglePause}
            >
              {paused ? <Play size={15} /> : <PauseIcon size={15} />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="rounded-md gap-2 px-4"
              onClick={stopRecording}
            >
              <Square size={13} />
              Stop
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
