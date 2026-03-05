// Recording lifecycle handlers

import { IpcMainInvokeEvent, screen, desktopCapturer } from 'electron';
import fs from 'fs';
import path from 'path';
import { RAW_RECORDING_FILE } from '../../shared/constants';
import type { RecordingMeta, RecordingSession, InputEvent } from '../../shared/types';
import { inputTracker } from '../services/input-tracker';
import * as sessionManager from '../services/session-manager';
import { getSettings } from '../services/settings';
import { platform } from '../platform';
import { getMainWindow } from '../windows/main-window';
import { showOverlay, closeOverlay } from '../windows/overlay-window';
import { showCountdownOverlay } from '../windows/countdown-window';

// ─── Module state ─────────────────────────────────────────────────────────────

let recordingSession: RecordingSession | null = null;
let selectedCaptureSourceId: string | null = null;

export function getRecordingSession(): RecordingSession | null {
  return recordingSession;
}

export function setSelectedCaptureSource(sourceId: string | null): void {
  selectedCaptureSourceId = sourceId;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function handleSetCaptureSource(
  _event: IpcMainInvokeEvent,
  sourceId: string | null,
): Promise<boolean> {
  selectedCaptureSourceId = sourceId ?? null;
  return true;
}

export async function handleStartRecording(): Promise<{ sessionDir: string; startTime: number }> {
  const settings = getSettings();

  // ── Resolve capture-source origin for coordinate normalization ──
  let meta: RecordingMeta = {};

  if (selectedCaptureSourceId) {
    console.log(`[Recording] Capture source: ${selectedCaptureSourceId}`);
    try {
      const isScreen = selectedCaptureSourceId.startsWith('screen:');
      const allDisplays = screen.getAllDisplays();

      let display: Electron.Display | null = null;

      if (isScreen) {
        const allSources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        });
        const src = allSources.find((s) => s.id === selectedCaptureSourceId);
        if (src) {
          display = allDisplays.find(
            (d) => String(d.id) === String(src.display_id),
          ) || null;
        }
        if (!display && allDisplays.length === 1) display = allDisplays[0];

        if (display) {
          const sf = display.scaleFactor || 1;
          meta = {
            sourceType: 'screen',
            originX: Math.round(display.bounds.x * sf),
            originY: Math.round(display.bounds.y * sf),
            captureWidth: Math.round(display.bounds.width * sf),
            captureHeight: Math.round(display.bounds.height * sf),
            scaleFactor: 1.0,
          };
        }
      } else {
        // ── Window source — get actual window rectangle ──────────
        const cursorPt = screen.getCursorScreenPoint();
        display = screen.getDisplayNearestPoint(cursorPt);
        const sf = display?.scaleFactor || 1;

        const winBounds = await platform.getWindowBounds(selectedCaptureSourceId);
        if (winBounds && winBounds.width > 0 && winBounds.height > 0) {
          meta = {
            sourceType: 'window',
            originX: winBounds.x,
            originY: winBounds.y,
            captureWidth: winBounds.width,
            captureHeight: winBounds.height,
            scaleFactor: 1.0,
          };
          console.log(
            `[Recording] Window origin: (${winBounds.x}, ${winBounds.y}), ` +
            `size: ${winBounds.width}x${winBounds.height}`,
          );
        }
      }

      // Fallback
      if (!meta.sourceType) {
        if (display) {
          meta = {
            sourceType: isScreen ? 'screen' : 'window',
            originX: display.bounds.x,
            originY: display.bounds.y,
            captureWidth: display.bounds.width,
            captureHeight: display.bounds.height,
            scaleFactor: display.scaleFactor || 1,
          };
        } else {
          meta = {
            sourceType: isScreen ? 'screen' : 'window',
            originX: 0,
            originY: 0,
            scaleFactor: 1,
          };
        }
        console.warn('[Recording] Using display-based fallback for origin:', meta);
      }
    } catch (err: any) {
      console.warn('[Recording] Could not resolve capture source bounds:', err.message);
    }
  }

  // Create session
  recordingSession = sessionManager.createSession(settings.outputDir, meta);

  // Start input tracking
  inputTracker.start(recordingSession.startTime);

  // Show recording overlay
  showOverlay(settings.overlayPosition);

  console.log(`[Recording] Started — session: ${recordingSession.sessionDir}`);
  return { sessionDir: recordingSession.sessionDir, startTime: recordingSession.startTime };
}

export async function handleStopRecording(
  _event: IpcMainInvokeEvent,
  videoStartTime?: number,
): Promise<{ sessionDir: string; eventCount: number; events: InputEvent[] }> {
  if (!recordingSession) throw new Error('No active recording session');

  const events = inputTracker.stop();

  // Align event timestamps with the video timeline
  if (videoStartTime && recordingSession.startTime) {
    const offsetSec = (videoStartTime - recordingSession.startTime) / 1000;
    if (offsetSec > 0) {
      for (const e of events) {
        e.timestamp = Math.max(0, e.timestamp - offsetSec);
      }
      console.log(`[Recording] Event timestamps shifted by -${offsetSec.toFixed(3)}s`);
    }
  }

  sessionManager.saveEvents(recordingSession.sessionDir, events);

  const result = {
    sessionDir: recordingSession.sessionDir,
    eventCount: events.length,
    events,
  };

  closeOverlay();
  console.log(`[Recording] Stopped — ${events.length} events captured`);
  return result;
}

export async function handlePrepareRecordingUI(): Promise<boolean> {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.minimize();
  await showCountdownOverlay(3);
  return true;
}

export async function handleFinishRecordingUI(): Promise<boolean> {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.restore();
    win.show();
    win.focus();
  }
  return true;
}

export async function handleSaveRecording(
  _event: IpcMainInvokeEvent,
  buffer: ArrayBuffer,
): Promise<string> {
  if (!recordingSession) throw new Error('No active recording session');
  return sessionManager.saveRecordingBlob(
    recordingSession.sessionDir,
    Buffer.from(buffer),
  );
}
