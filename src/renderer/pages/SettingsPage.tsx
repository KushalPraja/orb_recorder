import React, { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettings } from '../contexts/SettingsContext';
import type { NavigateFunction } from '../types';
import type { OverlayPosition, ThemeName } from '../../shared/types';

interface SettingsPageProps {
  onNavigate: NavigateFunction;
}

export function SettingsPage({ onNavigate }: SettingsPageProps) {
  const { settings, isLoading, updateSetting, pickOutputDir, openSettingsFile } =
    useSettings();
  const [savedKey, setSavedKey] = useState<string | null>(null);

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  const handleUpdate = (key: keyof typeof settings, value: any) => {
    updateSetting(key, value);
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 1500);
  };

  const handlePickDir = async () => {
    await pickOutputDir();
    setSavedKey('outputDir');
    setTimeout(() => setSavedKey(null), 1500);
  };

  const shortenPath = (p: string | undefined): string => {
    if (!p) return '-';
    const parts = p.split(/[/\\]/);
    return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : p;
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex-1 flex flex-col items-center py-8 px-6">
        {/* Header */}
        <div className="w-full max-w-md flex items-center justify-between mb-6">
          <h2 className="text-base font-semibold text-foreground">Settings</h2>
          {savedKey && (
            <span className="text-xs text-primary font-medium animate-in fade-in duration-200">
              Saved
            </span>
          )}
        </div>

        <div className="w-full max-w-md flex flex-col gap-5">
          {/* Appearance */}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
              Appearance
            </Label>
            <div className="bg-card rounded-lg border border-border/60 divide-y divide-border/60">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[13px] font-medium text-foreground">Theme</span>
                <Select
                  value={settings.theme || 'dark'}
                  onValueChange={(v) => v && handleUpdate('theme', v as ThemeName)}
                >
                  <SelectTrigger className="w-[140px] h-8 rounded-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dark">Standard Dark</SelectItem>
                    <SelectItem value="light">Standard Light</SelectItem>
                    <SelectItem value="onedark">One Dark</SelectItem>
                    <SelectItem value="gruvbox">Gruvbox</SelectItem>
                    <SelectItem value="everforest">Everforest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Recording */}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
              Recording
            </Label>
            <div className="bg-card rounded-lg border border-border/60 divide-y divide-border/60">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[13px] font-medium text-foreground">Frame Rate</span>
                <Select
                  value={String(settings.fps)}
                  onValueChange={(v) => v && handleUpdate('fps', parseInt(v, 10))}
                >
                  <SelectTrigger className="w-[110px] h-8 rounded-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 fps</SelectItem>
                    <SelectItem value="24">24 fps</SelectItem>
                    <SelectItem value="30">30 fps</SelectItem>
                    <SelectItem value="60">60 fps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-foreground">Output Folder</span>
                  <span className="text-[11px] text-muted-foreground truncate max-w-[200px]" title={settings.outputDir}>
                    {shortenPath(settings.outputDir)}
                  </span>
                </div>
                <Button variant="outline" size="sm" className="rounded-md" onClick={handlePickDir}>
                  <FolderOpen size={13} />
                  Change
                </Button>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[13px] font-medium text-foreground">Overlay Position</span>
                <Select
                  value={settings.overlayPosition ?? 'bottom-center'}
                  onValueChange={(v) => v && handleUpdate('overlayPosition', v as OverlayPosition)}
                >
                  <SelectTrigger className="w-[145px] h-8 rounded-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom-center">Bottom Center</SelectItem>
                    <SelectItem value="bottom-left">Bottom Left</SelectItem>
                    <SelectItem value="bottom-right">Bottom Right</SelectItem>
                    <SelectItem value="top-center">Top Center</SelectItem>
                    <SelectItem value="top-left">Top Left</SelectItem>
                    <SelectItem value="top-right">Top Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Post-processing */}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
              Post-Processing
            </Label>
            <div className="bg-card rounded-lg border border-border/60 divide-y divide-border/60">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-foreground">Zoom Level</span>
                  <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                    {settings.zoomFactor.toFixed(1)}x
                  </span>
                </div>
                <div className="w-[120px] px-1">
                  <Slider
                    min={1.5} max={3} step={0.1}
                    value={[settings.zoomFactor]}
                    onValueChange={(v) => handleUpdate('zoomFactor', Array.isArray(v) ? v[0] : v)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-foreground">Hold Duration</span>
                  <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                    {settings.zoomDuration.toFixed(1)}s
                  </span>
                </div>
                <div className="w-[120px] px-1">
                  <Slider
                    min={0.5} max={3} step={0.1}
                    value={[settings.zoomDuration]}
                    onValueChange={(v) => handleUpdate('zoomDuration', Array.isArray(v) ? v[0] : v)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* About */}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
              About
            </Label>
            <div className="bg-card rounded-lg border border-border/60 divide-y divide-border/60">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[13px] font-medium text-foreground">Version</span>
                <span className="text-xs text-muted-foreground font-mono">1.0.0</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-foreground">Settings file</span>
                  <span className="text-[11px] text-muted-foreground">settings.json</span>
                </div>
                <Button variant="outline" size="sm" className="rounded-md" onClick={openSettingsFile}>
                  <FolderOpen size={13} />
                  Edit
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
