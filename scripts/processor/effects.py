"""
effects.py – Visual click-ripple animation.

Draws an expanding ring + dot at each click position.
All drawing happens on the *output* (post-crop, post-scale) frame so the
ripple size is consistent regardless of zoom level.
"""

from __future__ import annotations

import cv2
import numpy as np


# ─── Tuning ──────────────────────────────────────────────────────────────────

RIPPLE_DURATION = 0.45   # seconds
RIPPLE_MAX_RADIUS = 28   # pixels (at output resolution)
RIPPLE_COLOUR = (180, 130, 255)   # warm purple-pink (BGR)
RIPPLE_DOT_COLOUR = (220, 200, 255)


class ClickRipple:
    """Single expanding ripple at a click location (canvas coordinates)."""

    __slots__ = ("cx", "cy", "t0")

    def __init__(self, x: float, y: float, timestamp: float) -> None:
        self.cx = x
        self.cy = y
        self.t0 = timestamp

    def is_alive(self, t: float) -> bool:
        return self.t0 <= t <= self.t0 + RIPPLE_DURATION

    def draw(
        self,
        frame: np.ndarray,
        t: float,
        crop: tuple[float, float, float, float],
        out_w: int,
        out_h: int,
    ) -> None:
        """Draw the ripple onto *frame* (mutates in-place).

        Args:
            frame : output-resolution BGR frame.
            t     : current video time (seconds).
            crop  : (cx, cy, cw, ch) float camera crop in canvas space.
            out_w, out_h : output frame dimensions.
        """
        if not self.is_alive(t):
            return

        progress = (t - self.t0) / RIPPLE_DURATION  # 0 → 1
        crop_x, crop_y, crop_w, crop_h = crop

        # Map canvas coords → output frame coords
        dx = int((self.cx - crop_x) / crop_w * out_w)
        dy = int((self.cy - crop_y) / crop_h * out_h)

        if not (0 <= dx < out_w and 0 <= dy < out_h):
            return

        alpha = 1.0 - progress
        radius = int(8 + RIPPLE_MAX_RADIUS * progress)
        thickness = max(1, int(2.5 * (1.0 - progress)))

        # Outer ring
        overlay = frame.copy()
        cv2.circle(overlay, (dx, dy), radius, RIPPLE_COLOUR, thickness, cv2.LINE_AA)
        cv2.addWeighted(overlay, alpha * 0.65, frame, 1.0 - alpha * 0.65, 0, frame)

        # Inner dot (fades faster)
        if progress < 0.6:
            dot_alpha = 0.7 * (1.0 - progress / 0.6)
            dot_ov = frame.copy()
            cv2.circle(dot_ov, (dx, dy), 4, RIPPLE_DOT_COLOUR, -1, cv2.LINE_AA)
            cv2.addWeighted(dot_ov, dot_alpha, frame, 1.0 - dot_alpha, 0, frame)
