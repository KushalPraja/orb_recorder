// spring.ts — Critically-damped spring virtual camera (ported from camera.py)
//
// Second-order critically-damped spring for position and zoom.
// Semi-implicit Euler integration, frame-rate independent via dt.
// All coordinates are in canvas space (recording + padding).

// ─── Tuning presets (ω values) ─────────────────────────────────────────────
// Tuned for Screen-Studio-style feel:
//   - Snap is fast but not jarring
//   - Follow is smooth and cinematic (the "pan" feel)
//   - Recenter is lazy so zoom-out feels natural
//   - Zoom spring is brisk but not instant
export const OMEGA_SNAP = 12.0;       // click-snap: quick arrival ~140ms
export const OMEGA_FOLLOW = 4.5;      // cursor-follow: smooth pan ~450ms
export const OMEGA_RECENTER = 3.0;    // zoom-out drift: lazy ~700ms
export const OMEGA_ZOOM = 7.0;        // zoom level change: ~250ms

// ─── Spring1D ──────────────────────────────────────────────────────────────

export class Spring1D {
  pos: number;
  vel: number;

  constructor(pos = 0, vel = 0) {
    this.pos = pos;
    this.vel = vel;
  }

  /** Advance one time-step with semi-implicit Euler (critical damping ζ=1). */
  step(target: number, omega: number, dt: number): void {
    const diff = this.pos - target;
    const accel = -2.0 * omega * this.vel - omega * omega * diff;
    this.vel += accel * dt;
    this.pos += this.vel * dt;
  }

  /** Instantly teleport (used for first-frame init). */
  snap(value: number): void {
    this.pos = value;
    this.vel = 0;
  }

  /** Create a deep copy of this spring. */
  clone(): Spring1D {
    return new Spring1D(this.pos, this.vel);
  }
}

// ─── SmoothCamera ──────────────────────────────────────────────────────────

export type TargetMode = 'snap' | 'follow' | 'recenter';

export class SmoothCamera {
  canvasW: number;
  canvasH: number;
  fps: number;

  private _sx: Spring1D;
  private _sy: Spring1D;
  private _sz: Spring1D;

  targetX: number;
  targetY: number;
  private _targetZ: number;
  private _posOmega: number;

  constructor(canvasW: number, canvasH: number, fps = 30) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.fps = fps;

    const cx = canvasW / 2;
    const cy = canvasH / 2;
    this._sx = new Spring1D(cx, 0);
    this._sy = new Spring1D(cy, 0);
    this._sz = new Spring1D(1, 0);
    this.targetX = cx;
    this.targetY = cy;
    this._targetZ = 1;
    this._posOmega = OMEGA_RECENTER;
  }

  setTarget(x: number, y: number, mode: TargetMode = 'snap'): void {
    this.targetX = Math.max(0, Math.min(this.canvasW, x));
    this.targetY = Math.max(0, Math.min(this.canvasH, y));

    if (mode === 'snap') this._posOmega = OMEGA_SNAP;
    else if (mode === 'follow') this._posOmega = OMEGA_FOLLOW;
    else this._posOmega = OMEGA_RECENTER;
  }

  setZoom(z: number): void {
    this._targetZ = Math.max(1, z);
  }

  resetZoom(): void {
    this._targetZ = 1;
  }

  update(): void {
    const dt = 1 / Math.max(1, this.fps);

    this._sx.step(this.targetX, this._posOmega, dt);
    this._sy.step(this.targetY, this._posOmega, dt);
    this._sz.step(this._targetZ, OMEGA_ZOOM, dt);

    // Snap zoom to 1.0 when essentially there
    if (Math.abs(this._sz.pos - 1) < 0.005 && Math.abs(this._sz.vel) < 0.05) {
      this._sz.pos = 1;
      this._sz.vel = 0;
    }

    // Clamp zoom floor
    if (this._sz.pos < 1) {
      this._sz.pos = 1;
      this._sz.vel = 0;
    }
  }

  /** Return (x, y, w, h) crop in float canvas coords. */
  getCrop(): { x: number; y: number; w: number; h: number } {
    const zoom = Math.max(1, this._sz.pos);
    const cw = this.canvasW / zoom;
    const ch = this.canvasH / zoom;

    let cx = this._sx.pos - cw / 2;
    let cy = this._sy.pos - ch / 2;

    // Clamp to canvas bounds
    cx = Math.max(0, Math.min(this.canvasW - cw, cx));
    cy = Math.max(0, Math.min(this.canvasH - ch, cy));

    return { x: cx, y: cy, w: cw, h: ch };
  }

  get zoom(): number {
    return this._sz.pos;
  }

  get x(): number {
    return this._sx.pos;
  }

  get y(): number {
    return this._sy.pos;
  }

  /** Create a deep copy for checkpointing. */
  clone(): SmoothCamera {
    const cam = new SmoothCamera(this.canvasW, this.canvasH, this.fps);
    cam._sx = this._sx.clone();
    cam._sy = this._sy.clone();
    cam._sz = this._sz.clone();
    cam.targetX = this.targetX;
    cam.targetY = this.targetY;
    cam._targetZ = this._targetZ;
    cam._posOmega = this._posOmega;
    return cam;
  }

  /** Restore state from another camera (used for checkpoint replay). */
  restoreFrom(other: SmoothCamera): void {
    this._sx = other._sx.clone();
    this._sy = other._sy.clone();
    this._sz = other._sz.clone();
    this.targetX = other.targetX;
    this.targetY = other.targetY;
    this._targetZ = other._targetZ;
    this._posOmega = other._posOmega;
  }
}
