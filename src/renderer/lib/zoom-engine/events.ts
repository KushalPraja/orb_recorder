// events.ts — Event processing, debouncing, coordinate mapping, interpolation,
// and Screen-Studio-style camera scheduling.

import type { InputEvent, ClickEvent, ScrollEvent, MoveEvent } from '../../../shared/types';

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

  /** Check if cursor is moving significantly in a time window around t. */
  isActive(t: number, window = 0.8, threshold = 30): boolean {
    const before = this.at(t - window * 0.5);
    const after = this.at(t + window * 0.5);
    if (!before || !after) return false;
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    return Math.sqrt(dx * dx + dy * dy) > threshold;
  }
}

// ─── Camera scheduling (Screen Studio style) ──────────────────────────────
//
// Behaviour:
//   1. Click → fast snap-zoom to click position
//   2. While zoomed, continuously follow the cursor with gentle spring
//   3. Stay zoomed as long as there's cursor activity or new clicks
//   4. Zoom out smoothly after inactivity (no clicks for holdDuration AND
//      cursor is idle for a bit)
//   5. Scrolls add a temporary vertical offset while zoomed
//
// The key difference from the old approach: the camera ALWAYS follows the
// cursor while zoomed in, giving that smooth "Screen Studio" panning feel.

export function scheduleCamera(
  camera: import('./spring').SmoothCamera,
  clicks: ClickEvent[],
  scrolls: ScrollEvent[],
  cursor: CursorInterpolator,
  t: number,
  zoomFactor: number,
  holdDuration: number,
): void {
  // Find the most recent active click (within hold window)
  let activeClick: ClickEvent | null = null;
  let clickAge = 0;

  for (const click of clicks) {
    const ct = click.timestamp;
    if (ct <= t && t <= ct + holdDuration) {
      activeClick = click;
      clickAge = t - ct;
    }
  }

  // Check if cursor is still actively moving (extend zoom window)
  const cursorActive = cursor.isActive(t, 0.6, 20);

  // Find next upcoming click (for anticipation — don't zoom out if a click
  // is about to happen within 0.3s)
  let nextClickSoon = false;
  for (const click of clicks) {
    const gap = click.timestamp - t;
    if (gap > 0 && gap < 0.3) {
      nextClickSoon = true;
      break;
    }
  }

  if (activeClick !== null) {
    // ── Zoomed in ─────────────────────────────────────────────────

    // Gradual zoom ramp: ease into zoom over first 0.3s to avoid jarring punch-in
    const ZOOM_RAMP = 0.3;
    const zoomEase = Math.min(1, clickAge / ZOOM_RAMP);
    // Smooth ease-out curve for gentle zoom entry
    const easedZoom = 1 + (zoomFactor - 1) * (1 - (1 - zoomEase) * (1 - zoomEase));
    camera.setZoom(easedZoom);

    const SNAP_SETTLE = 0.35; // slightly longer snap settle for gentler arrival
    const FOLLOW_BLEND = 0.7; // longer blend for smoother transition to cursor follow

    // Dead zone radius: don't chase cursor if it's very close to current target
    const DEAD_ZONE = 25; // px — ignore micro-movements

    if (clickAge < SNAP_SETTLE) {
      // Phase 1: Gentle snap to the click location
      camera.setTarget(activeClick.x, activeClick.y, 'snap');
    } else {
      // Phase 2: Follow the cursor smoothly — the Screen Studio feel
      const pos = cursor.at(t);
      if (pos) {
        // Smooth ease-in-out blend curve
        const rawBlend = Math.min(1, (clickAge - SNAP_SETTLE) / FOLLOW_BLEND);
        const blendT = rawBlend * rawBlend * (3 - 2 * rawBlend); // smoothstep

        const rawX = activeClick.x + (pos.x - activeClick.x) * blendT;
        const rawY = activeClick.y + (pos.y - activeClick.y) * blendT;

        // Apply dead zone: only update target if cursor moved significantly
        const dx = rawX - camera.targetX;
        const dy = rawY - camera.targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > DEAD_ZONE) {
          camera.setTarget(rawX, rawY, 'follow');
        }
        // else: keep current target — prevents micro-wobble from tiny cursor jitter
      } else {
        camera.setTarget(activeClick.x, activeClick.y, 'follow');
      }
    }
  } else if (nextClickSoon) {
    // About to click — hold position, don't start zooming out
    // Keep current target, just maintain
  } else {
    // ── No active click — zoom out ────────────────────────────────
    camera.setTarget(camera.canvasW / 2, camera.canvasH / 2, 'recenter');
    camera.resetZoom();
  }

  // ── Scroll offset ────────────────────────────────────────────────
  // Scrolls nudge the camera vertically while zoomed, fading over time
  // Reduced strength and longer duration for less jarring scroll nudges
  for (const scroll of scrolls) {
    const st = scroll.timestamp;
    const dur = 0.7; // longer fade for smoother feel
    if (st <= t && t <= st + dur) {
      const progress = (t - st) / dur;
      const ease = progress * progress * (3 - 2 * progress); // smoothstep
      const strength = activeClick ? 0.6 : 0.15; // reduced strength to avoid nausea
      const offset = (scroll.rotation ?? 0) * 30 * strength * (1 - ease);
      camera.targetY = Math.max(0, Math.min(camera.canvasH, camera.targetY + offset));
    }
  }
}
