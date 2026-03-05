// Recording overlay pill — floating draggable window with stop/pause/discard controls.

import { BrowserWindow, screen } from 'electron';
import path from 'path';
import type { OverlayPosition } from '../../shared/types';

let overlayWindow: BrowserWindow | null = null;

/** Close the overlay window if it exists. */
export function closeOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
}

/** Get the current overlay window (or null). */
export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

/**
 * Convert an anchor name to absolute screen coordinates for the overlay.
 */
function resolvePosition(
  anchor: OverlayPosition,
  dBounds: Electron.Rectangle,
  W: number,
  H: number,
): { x: number; y: number } {
  const MARGIN = 28;
  const cx = Math.round(dBounds.x + (dBounds.width - W) / 2);
  const positions: Record<string, { x: number; y: number }> = {
    'bottom-center': { x: cx, y: dBounds.y + dBounds.height - H - MARGIN },
    'bottom-left': { x: dBounds.x + MARGIN, y: dBounds.y + dBounds.height - H - MARGIN },
    'bottom-right': { x: dBounds.x + dBounds.width - W - MARGIN, y: dBounds.y + dBounds.height - H - MARGIN },
    'top-center': { x: cx, y: dBounds.y + MARGIN },
    'top-left': { x: dBounds.x + MARGIN, y: dBounds.y + MARGIN },
    'top-right': { x: dBounds.x + dBounds.width - W - MARGIN, y: dBounds.y + MARGIN },
  };
  return positions[anchor] || positions['bottom-center'];
}

/**
 * Show the recording overlay pill.
 */
export function showOverlay(position: OverlayPosition): void {
  closeOverlay();

  const W = 260;
  const H = 64;

  overlayWindow = new BrowserWindow({
    width: W,
    height: H,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    movable: true,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  overlayWindow.setContentProtection(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(false);

  overlayWindow.loadFile(path.join(__dirname, 'recording-overlay.html'));

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  const d = screen.getPrimaryDisplay().bounds;
  const pos = resolvePosition(position, d, W, H);
  overlayWindow.setPosition(pos.x, pos.y, false);
}
