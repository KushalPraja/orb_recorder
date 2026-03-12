// effects.ts — Click ripple animation parameters.
// Ported from effects.py. Returns draw params instead of OpenCV drawing.

export const RIPPLE_DURATION = 0.45;
export const RIPPLE_MAX_RADIUS = 28;
export const RIPPLE_COLOUR = 'rgba(255, 130, 180, 1)';       // warm purple-pink
export const RIPPLE_DOT_COLOUR = 'rgba(255, 200, 220, 1)';

export interface RippleDrawParams {
  /** Output-space X coordinate */
  dx: number;
  /** Output-space Y coordinate */
  dy: number;
  /** Progress 0→1 */
  progress: number;
  /** Ring opacity (0→1) */
  alpha: number;
  /** Ring radius in pixels */
  radius: number;
  /** Ring stroke thickness */
  thickness: number;
  /** Whether to draw the inner dot */
  showDot: boolean;
  /** Inner dot opacity */
  dotAlpha: number;
}

export class ClickRipple {
  readonly cx: number;
  readonly cy: number;
  readonly t0: number;

  constructor(x: number, y: number, timestamp: number) {
    this.cx = x;
    this.cy = y;
    this.t0 = timestamp;
  }

  isAlive(t: number): boolean {
    return this.t0 <= t && t <= this.t0 + RIPPLE_DURATION;
  }

  /**
   * Compute draw parameters for this ripple at time t.
   * Returns null if ripple is not alive or outside the visible crop.
   */
  getDrawParams(
    t: number,
    crop: { x: number; y: number; w: number; h: number },
    outW: number,
    outH: number,
  ): RippleDrawParams | null {
    if (!this.isAlive(t)) return null;

    const progress = (t - this.t0) / RIPPLE_DURATION;

    // Map canvas coords → output frame coords
    const dx = ((this.cx - crop.x) / crop.w) * outW;
    const dy = ((this.cy - crop.y) / crop.h) * outH;

    if (dx < 0 || dx >= outW || dy < 0 || dy >= outH) return null;

    const alpha = 1 - progress;
    const radius = 8 + RIPPLE_MAX_RADIUS * progress;
    const thickness = Math.max(1, 2.5 * (1 - progress));

    const showDot = progress < 0.6;
    const dotAlpha = showDot ? 0.7 * (1 - progress / 0.6) : 0;

    return { dx, dy, progress, alpha, radius, thickness, showDot, dotAlpha };
  }
}
