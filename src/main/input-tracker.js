// Global mouse click + scroll tracker using uiohook-napi
// Runs in the main process to capture events even when the app window is unfocused.

const { uIOhook } = require("uiohook-napi");
const { SCROLL_COOLDOWN } = require("../shared/constants");

class InputTracker {
  constructor() {
    this.events = [];
    this.recording = false;
    this.startTime = 0;

    // Scroll event batching — merge rapid scroll events
    this._lastScrollTime = 0;
    this._lastScrollY = 0;
    this._lastScrollX = 0;
    this._scrollAccumulator = 0;
    this._scrollTimer = null;

    // Mouse-move throttling (capture ~20 samples/sec to avoid flooding)
    this._lastMoveTime = 0;
    this._moveInterval = 50; // ms between recorded move samples

    // Bind handlers so we can remove them later
    this._onMouseClick = this._onMouseClick.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
  }

  /**
   * Start tracking mouse clicks and scroll events.
   * @param {number} startTime  Recording start timestamp (Date.now())
   */
  start(startTime) {
    this.events = [];
    this.startTime = startTime || Date.now();
    this.recording = true;
    this._scrollAccumulator = 0;

    uIOhook.on("click", this._onMouseClick);
    uIOhook.on("wheel", this._onWheel);
    uIOhook.on("mousemove", this._onMouseMove);
    uIOhook.start();

    console.log("[InputTracker] Started tracking");
  }

  /**
   * Stop tracking and return the collected events.
   * @returns {Array} Array of event objects
   */
  stop() {
    this.recording = false;

    // Flush any pending accumulated scroll
    this._flushScroll();

    uIOhook.off("click", this._onMouseClick);
    uIOhook.off("wheel", this._onWheel);
    uIOhook.off("mousemove", this._onMouseMove);
    uIOhook.stop();

    console.log(
      `[InputTracker] Stopped — captured ${this.events.length} events`,
    );
    return this.events;
  }

  // ─── Internal Handlers ────────────────────────────────────────────────

  _onMouseClick(e) {
    if (!this.recording) return;

    const timestamp = (Date.now() - this.startTime) / 1000; // seconds into recording

    this.events.push({
      type: "click",
      x: e.x,
      y: e.y,
      button: e.button, // 1 = left, 2 = right, 3 = middle
      clicks: e.clicks || 1, // single vs double click
      timestamp,
    });

    console.log(
      `[InputTracker] Click at (${e.x}, ${e.y}) t=${timestamp.toFixed(2)}s`,
    );
  }

  _onMouseMove(e) {
    if (!this.recording) return;

    const now = Date.now();
    if (now - this._lastMoveTime < this._moveInterval) return;
    this._lastMoveTime = now;

    const timestamp = (now - this.startTime) / 1000;

    this.events.push({
      type: "move",
      x: e.x,
      y: e.y,
      timestamp,
    });
  }

  _onWheel(e) {
    if (!this.recording) return;

    const now = Date.now();
    const timestamp = (now - this.startTime) / 1000;

    // Merge rapid scroll events within the cooldown window
    if (now - this._lastScrollTime < SCROLL_COOLDOWN * 1000) {
      this._scrollAccumulator += e.rotation;
      this._lastScrollX = e.x;
      this._lastScrollY = e.y;
      this._lastScrollTime = now;

      // Reset the flush timer
      if (this._scrollTimer) clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(
        () => this._flushScroll(),
        SCROLL_COOLDOWN * 1000,
      );
      return;
    }

    // New scroll burst — flush any previous accumulated scroll first
    this._flushScroll();

    this._scrollAccumulator = e.rotation;
    this._lastScrollX = e.x;
    this._lastScrollY = e.y;
    this._lastScrollTime = now;

    this._scrollTimer = setTimeout(
      () => this._flushScroll(),
      SCROLL_COOLDOWN * 1000,
    );
  }

  _flushScroll() {
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }

    if (this._scrollAccumulator === 0) return;
    if (!this.recording && this.events.length === 0) return;

    const timestamp = (this._lastScrollTime - this.startTime) / 1000;

    this.events.push({
      type: "scroll",
      x: this._lastScrollX,
      y: this._lastScrollY,
      rotation: this._scrollAccumulator, // positive = down, negative = up
      direction: "vertical",
      timestamp,
    });

    console.log(
      `[InputTracker] Scroll at (${this._lastScrollX}, ${this._lastScrollY})` +
        ` rotation=${this._scrollAccumulator} t=${timestamp.toFixed(2)}s`,
    );

    this._scrollAccumulator = 0;
  }
}

module.exports = new InputTracker();
