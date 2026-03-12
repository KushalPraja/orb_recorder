// events.ts — Event processing, coordinate mapping, cursor interpolation,
// and Screen-Studio-style camera scheduling.

import type { InputEvent, ClickEvent, ScrollEvent, MoveEvent } from '../../../shared/types';
import type { ZoomSegment } from './segments';

// ─── Splitting ─────────────────────────────────────────────────────────────

export function splitEvents(events: InputEvent[]): {
  clicks: ClickEvent[];
  scrolls: ScrollEvent[];
  moves: MoveEvent[];
} {
  const clicks: ClickEvent[] = [];
  const scrolls: ScrollEvent[] = [];
  const moves: MoveEvent[] = [];

  for (const e of events) {
    if (e.type === 'click') clicks.push(e);
    else if (e.type === 'scroll') scrolls.push(e);
    else if (e.type === 'move') moves.push(e);
  }

  clicks.sort((a, b) => a.timestamp - b.timestamp);
  scrolls.sort((a, b) => a.timestamp - b.timestamp);
  moves.sort((a, b) => a.timestamp - b.timestamp);

  return { clicks, scrolls, moves };
}

// ─── Click debouncing ──────────────────────────────────────────────────────

export function debounceClicks(clicks: ClickEvent[], gap = 0.4): ClickEvent[] {
  if (clicks.length === 0) return [];

  const result: ClickEvent[] = [];
  let burst: ClickEvent[] = [clicks[0]];

  for (let i = 1; i < clicks.length; i++) {
    if (clicks[i].timestamp - burst[burst.length - 1].timestamp <= gap) {
      burst.push(clicks[i]);
    } else {
      result.push(burst[burst.length - 1]);
      burst = [clicks[i]];
    }
  }
  result.push(burst[burst.length - 1]);
  return result;
}

// ─── Coordinate mapping ───────────────────────────────────────────────────

export function toCanvasCoords<T extends InputEvent>(
  events: T[],
  originX: number,
  originY: number,
  scale: number,
  padding: number,
  frameW: number,
  frameH: number,
): T[] {
  return events.map((e) => {
    const ne = { ...e };
    if ('x' in ne && typeof ne.x === 'number') {
      ne.x = (ne.x - originX) * scale + padding;
      ne.x = Math.max(padding, Math.min(frameW + padding, ne.x));
    }
    if ('y' in ne && typeof ne.y === 'number') {
      ne.y = (ne.y - originY) * scale + padding;
      ne.y = Math.max(padding, Math.min(frameH + padding, ne.y));
    }
    return ne;
  });
}

// ─── Meta loading ──────────────────────────────────────────────────────────

export interface MetaInfo {
  originX: number;
  originY: number;
  scaleFactor: number;
}

export function parseMeta(
  meta: { originX?: number; originY?: number; scaleFactor?: number; captureWidth?: number } | null,
  frameW: number,
): MetaInfo {
  if (!meta) return { originX: 0, originY: 0, scaleFactor: 1 };

  const originX = meta.originX ?? 0;
  const originY = meta.originY ?? 0;

  let scaleFactor = 1;
  if (meta.scaleFactor && meta.scaleFactor > 0) {
    scaleFactor = meta.scaleFactor;
  } else if (meta.captureWidth && meta.captureWidth > 0) {
    scaleFactor = frameW / meta.captureWidth;
  }

  return { originX, originY, scaleFactor };
}

// ─── Cursor interpolation ──────────────────────────────────────────────────

export class CursorInterpolator {
  private _moves: MoveEvent[];
  private _times: number[];

  constructor(moves: MoveEvent[]) {
    this._moves = moves;
    this._times = moves.map((m) => m.timestamp);
  }

  at(t: number): { x: number; y: number } | null {
    if (this._moves.length === 0) return null;

    if (t <= this._times[0]) {
      return { x: this._moves[0].x, y: this._moves[0].y };
    }

    if (t >= this._times[this._times.length - 1]) {
      const last = this._moves[this._moves.length - 1];
      return { x: last.x, y: last.y };
    }

    // Binary search for insertion point
    let lo = 0;
    let hi = this._times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }

    let idx = lo;
    if (idx <= 0) idx = 1;
    if (idx >= this._moves.length) idx = this._moves.length - 1;

    const a = this._moves[idx - 1];
    const b = this._moves[idx];
    const dt = b.timestamp - a.timestamp;
    if (dt <= 0) return { x: a.x, y: a.y };

    const frac = (t - a.timestamp) / dt;
    return {
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac,
    };
  }
}

// ─── Camera scheduling (Screen Studio style) ──────────────────────────────
//
// Uses pre-computed zoom segments for smart zoom decisions:
//   1. Zoom in when entering a segment → snap camera to click position
//   2. While zoomed, follow cursor with lazy lerp + dead zone
//   3. Zoom out smoothly when leaving a segment
//   4. Anticipate upcoming segments — don't zoom out if one is close
//   5. Scroll nudges camera vertically while zoomed
//
// The key: fewer, longer zoom holds with slow transitions = Screen Studio feel.

const DEAD_ZONE = 45;      // px — ignore cursor movements smaller than this (relative to actual cam position)
const SNAP_PHASE = 0.4;    // seconds — snap to click position on new click
const ANTICIPATION = 0.8;  // seconds — don't zoom out if next segment is this close

export function scheduleCamera(
  camera: import('./spring').SmoothCamera,
  segments: ZoomSegment[],
  clicks: ClickEvent[],
  scrolls: ScrollEvent[],
  cursor: CursorInterpolator,
  t: number,
  zoomFactor: number,
): void {
  // ── Find active segment and next upcoming segment ────────────
  let activeSegment: ZoomSegment | null = null;
  let nextSegment: ZoomSegment | null = null;

  for (const seg of segments) {
    if (t >= seg.startTime && t <= seg.endTime) {
      activeSegment = seg;
    } else if (seg.startTime > t && !nextSegment) {
      nextSegment = seg;
    }
  }

  // ── Find most recent click within current segment ────────────
  let latestClick: ClickEvent | null = null;
  if (activeSegment) {
    for (const click of clicks) {
      if (click.timestamp <= t && click.timestamp >= activeSegment.startTime) {
        latestClick = click;
      }
    }
  }

  if (activeSegment) {
    // ── Zoomed in ─────────────────────────────────────────────
    camera.setZoom(zoomFactor);

    const timeSinceClick = latestClick ? t - latestClick.timestamp : Infinity;

    if (latestClick && timeSinceClick < SNAP_PHASE) {
      // Just clicked — move toward click position
      camera.setTarget(latestClick.x, latestClick.y, 'snap');
    } else {
      // Follow cursor with lazy lerp + dead zone against ACTUAL camera position
      const pos = cursor.at(t);
      if (pos) {
        // Compare to actual camera position, not target — prevents dead zone oscillation
        const dx = pos.x - camera.x;
        const dy = pos.y - camera.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > DEAD_ZONE) {
          camera.setTarget(pos.x, pos.y, 'follow');
        }
      } else if (latestClick) {
        camera.setTarget(latestClick.x, latestClick.y, 'follow');
      }
    }

    // ── Scroll offset (computed once, not additive) ────────────
    // Find the strongest active scroll and apply a single offset
    let scrollOffset = 0;
    for (const scroll of scrolls) {
      const dur = 0.8;
      if (scroll.timestamp <= t && t <= scroll.timestamp + dur) {
        const progress = (t - scroll.timestamp) / dur;
        const ease = progress * progress * (3 - 2 * progress);
        const offset = (scroll.rotation ?? 0) * 12 * (1 - ease);
        // Keep the largest magnitude offset (not cumulative)
        if (Math.abs(offset) > Math.abs(scrollOffset)) scrollOffset = offset;
      }
    }
    if (scrollOffset !== 0) {
      camera.targetY = Math.max(0, Math.min(camera.canvasH, camera.targetY + scrollOffset));
    }
  } else if (nextSegment && (nextSegment.startTime - t) < ANTICIPATION) {
    // ── About to enter a segment — hold position, don't zoom out
  } else {
    // ── Not zoomed — drift back to center ─────────────────────
    camera.resetZoom();
    camera.setTarget(camera.canvasW / 2, camera.canvasH / 2, 'recenter');
  }
}
