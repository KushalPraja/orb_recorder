// spring.ts — Lerp-based smooth camera for Screen Studio-style zoom.
//
// Uses exponential interpolation for frame-rate independent smoothing.
// No spring physics, no overshoot, no wobble — just clean, cinematic motion.

// ─── Lerp speeds ─────────────────────────────────────────────────────────
// How fast the camera reaches its target (95% arrival time shown).
// Tuned so zoom-in is punchy, zoom-out is cinematic but finishes cleanly,
// and recenter speed matches zoom-out so they arrive together (no wobble).
export const SPEED_SNAP = 0.06;       // click snap: ~0.8s arrival
export const SPEED_FOLLOW = 0.025;    // cursor follow: ~2s lazy pan
export const SPEED_RECENTER = 0.024;  // drift to center: ~2s (matches zoom-out)
export const SPEED_ZOOM_IN = 0.045;   // zoom in: ~1s
export const SPEED_ZOOM_OUT = 0.045;  // zoom out: ~2s (was 5s — way too slow)

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Frame-rate independent exponential lerp. */
function smoothLerp(current: number, target: number, speed: number, dt: number): number {
  // Normalize to 60fps baseline so speeds behave consistently at any framerate
  const t = 1 - Math.pow(1 - speed, dt * 60);
  return current + (target - current) * t;
}


// ─── SmoothCamera ──────────────────────────────────────────────────────────

export type TargetMode = 'snap' | 'follow' | 'recenter';

export class SmoothCamera {
  canvasW: number;
  canvasH: number;
  fps: number;

  private _x: number;
  private _y: number;
  private _zoom: number;

  targetX: number;
  targetY: number;
  private _targetZoom: number;
  private _posSpeed: number;

  constructor(canvasW: number, canvasH: number, fps = 30) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.fps = fps;

    const cx = canvasW / 2;
    const cy = canvasH / 2;
    this._x = cx;
    this._y = cy;
    this._zoom = 1;
    this.targetX = cx;
    this.targetY = cy;
    this._targetZoom = 1;
    this._posSpeed = SPEED_RECENTER;
  }

  setTarget(x: number, y: number, mode: TargetMode = 'snap'): void {
    this.targetX = Math.max(0, Math.min(this.canvasW, x));
    this.targetY = Math.max(0, Math.min(this.canvasH, y));

    if (mode === 'snap') this._posSpeed = SPEED_SNAP;
    else if (mode === 'follow') this._posSpeed = SPEED_FOLLOW;
    else this._posSpeed = SPEED_RECENTER;
  }

  setZoom(z: number): void {
    this._targetZoom = Math.max(1, z);
  }

  resetZoom(): void {
    this._targetZoom = 1;
  }

  update(): void {
    const dt = 1 / Math.max(1, this.fps);

    // Lerp position
    this._x = smoothLerp(this._x, this.targetX, this._posSpeed, dt);
    this._y = smoothLerp(this._y, this.targetY, this._posSpeed, dt);

    // Lerp zoom — slower out than in for cinematic feel
    const zoomSpeed = this._targetZoom > this._zoom ? SPEED_ZOOM_IN : SPEED_ZOOM_OUT;
    this._zoom = smoothLerp(this._zoom, this._targetZoom, zoomSpeed, dt);

    if (Math.abs(this._zoom - this._targetZoom) < 0.003) this._zoom = this._targetZoom;
    if (Math.abs(this._x - this.targetX) < 0.5) this._x = this.targetX;
    if (Math.abs(this._y - this.targetY) < 0.5) this._y = this.targetY;
    if (this._zoom < 1) this._zoom = 1;
  }

  getCrop(): { x: number; y: number; w: number; h: number } {
    const zoom = Math.max(1, this._zoom);
    const cw = this.canvasW / zoom;
    const ch = this.canvasH / zoom;

    let cx = this._x - cw / 2;
    let cy = this._y - ch / 2;
    cx = Math.max(0, Math.min(this.canvasW - cw, cx));
    cy = Math.max(0, Math.min(this.canvasH - ch, cy));

    return { x: cx, y: cy, w: cw, h: ch };
  }

  get zoom(): number { return this._zoom; }
  get x(): number { return this._x; }
  get y(): number { return this._y; }

  clone(): SmoothCamera {
    const cam = new SmoothCamera(this.canvasW, this.canvasH, this.fps);
    cam._x = this._x;
    cam._y = this._y;
    cam._zoom = this._zoom;
    cam.targetX = this.targetX;
    cam.targetY = this.targetY;
    cam._targetZoom = this._targetZoom;
    cam._posSpeed = this._posSpeed;
    return cam;
  }

  restoreFrom(other: SmoothCamera): void {
    this._x = other._x;
    this._y = other._y;
    this._zoom = other._zoom;
    this.targetX = other.targetX;
    this.targetY = other.targetY;
    this._targetZoom = other._targetZoom;
    this._posSpeed = other._posSpeed;
  }
}
