// Global mouse click + scroll tracker using uiohook-napi.
// Runs in the main process to capture events even when the app window is unfocused.

import { uIOhook, UiohookMouseEvent, UiohookWheelEvent } from 'uiohook-napi';
import { SCROLL_COOLDOWN } from '../../shared/constants';
import type { InputEvent } from '../../shared/types';

class InputTracker {
  events: InputEvent[] = [];
  recording = false;
  startTime = 0;

  // Scroll event batching
  private lastScrollTime = 0;
  private lastScrollY = 0;
  private lastScrollX = 0;
  private scrollAccumulator = 0;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;

  // Mouse-move throttling (~20 samples/sec)
  private lastMoveTime = 0;
  private moveInterval = 50; // ms between recorded move samples

  constructor() {
    this.onMouseClick = this.onMouseClick.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
  }

  /** Start tracking mouse clicks, moves, and scroll events. */
  start(startTime?: number): void {
    this.events = [];
    this.startTime = startTime || Date.now();
    this.recording = true;
    this.scrollAccumulator = 0;

    uIOhook.on('click', this.onMouseClick);
    uIOhook.on('wheel', this.onWheel);
    uIOhook.on('mousemove', this.onMouseMove);
    uIOhook.start();

    console.log('[InputTracker] Started tracking');
  }

  /** Stop tracking and return the collected events. */
  stop(): InputEvent[] {
    this.recording = false;
    this.flushScroll();

    uIOhook.off('click', this.onMouseClick);
    uIOhook.off('wheel', this.onWheel);
    uIOhook.off('mousemove', this.onMouseMove);
    uIOhook.stop();

    console.log(`[InputTracker] Stopped — captured ${this.events.length} events`);
    return this.events;
  }

  // ─── Internal Handlers ──────────────────────────────────────────

  private onMouseClick(e: UiohookMouseEvent): void {
    if (!this.recording) return;
    const timestamp = (Date.now() - this.startTime) / 1000;

    this.events.push({
      type: 'click',
      x: e.x,
      y: e.y,
      button: e.button as number,
      clicks: e.clicks || 1,
      timestamp,
    });

    console.log(`[InputTracker] Click at (${e.x}, ${e.y}) t=${timestamp.toFixed(2)}s`);
  }

  private onMouseMove(e: UiohookMouseEvent): void {
    if (!this.recording) return;
    const now = Date.now();
    if (now - this.lastMoveTime < this.moveInterval) return;
    this.lastMoveTime = now;

    const timestamp = (now - this.startTime) / 1000;
    this.events.push({
      type: 'move',
      x: e.x,
      y: e.y,
      timestamp,
    });
  }

  private onWheel(e: UiohookWheelEvent): void {
    if (!this.recording) return;
    const now = Date.now();

    if (now - this.lastScrollTime < SCROLL_COOLDOWN * 1000) {
      this.scrollAccumulator += e.rotation;
      this.lastScrollX = e.x;
      this.lastScrollY = e.y;
      this.lastScrollTime = now;

      if (this.scrollTimer) clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(
        () => this.flushScroll(),
        SCROLL_COOLDOWN * 1000,
      );
      return;
    }

    this.flushScroll();

    this.scrollAccumulator = e.rotation;
    this.lastScrollX = e.x;
    this.lastScrollY = e.y;
    this.lastScrollTime = now;

    this.scrollTimer = setTimeout(
      () => this.flushScroll(),
      SCROLL_COOLDOWN * 1000,
    );
  }

  private flushScroll(): void {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }

    if (this.scrollAccumulator === 0) return;
    if (!this.recording && this.events.length === 0) return;

    const timestamp = (this.lastScrollTime - this.startTime) / 1000;

    this.events.push({
      type: 'scroll',
      x: this.lastScrollX,
      y: this.lastScrollY,
      rotation: this.scrollAccumulator,
      direction: 'vertical',
      timestamp,
    });

    console.log(
      `[InputTracker] Scroll at (${this.lastScrollX}, ${this.lastScrollY})` +
        ` rotation=${this.scrollAccumulator} t=${timestamp.toFixed(2)}s`,
    );

    this.scrollAccumulator = 0;
  }
}

/** Singleton input tracker instance. */
export const inputTracker = new InputTracker();
