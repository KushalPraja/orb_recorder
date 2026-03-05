"""
background.py – Background frame builder and rounded-corner mask.

Builds a single background image (solid / gradient / wallpaper) that is
reused every frame.  Also provides a corner-radius alpha mask that is used
for both the recording stamp AND the drop shadow, so the shadow correctly
follows the rounded shape.
"""

from __future__ import annotations

import os
from typing import Literal

import cv2
import numpy as np


# ─── Colour helpers ──────────────────────────────────────────────────────────

def hex_to_bgr(hex_colour: str) -> tuple[int, int, int]:
    """Convert '#RRGGBB' → (B, G, R)."""
    h = hex_colour.lstrip("#")
    return int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)


# ─── Background frame ────────────────────────────────────────────────────────

def build_background(
    width: int,
    height: int,
    bg_type: Literal["solid", "gradient", "image"] = "solid",
    bg_colour: str = "#6366f1",
    gradient_start: str = "#667eea",
    gradient_end: str = "#764ba2",
    wallpaper_path: str | None = None,
    image_blur: Literal["none", "moderate", "strong"] = "none",
) -> np.ndarray:
    """Return a (height, width, 3) uint8 BGR frame for the canvas background.

    Called once before the frame loop — never inside the hot path.
    """
    # ── Image / wallpaper ──
    if bg_type == "image" and wallpaper_path and os.path.exists(wallpaper_path):
        img = cv2.imread(wallpaper_path)
        if img is not None:
            ih, iw = img.shape[:2]
            scale = max(width / iw, height / ih)
            nw, nh = int(iw * scale), int(ih * scale)
            img = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
            y0, x0 = (nh - height) // 2, (nw - width) // 2
            img = img[y0 : y0 + height, x0 : x0 + width]
            if image_blur == "moderate":
                img = cv2.GaussianBlur(img, (0, 0), sigmaX=10, sigmaY=10)
            elif image_blur == "strong":
                img = cv2.GaussianBlur(img, (0, 0), sigmaX=25, sigmaY=25)
            return img
        # fall through to solid if load failed

    # ── Gradient ──
    if bg_type == "gradient":
        top = np.array(hex_to_bgr(gradient_start), dtype=np.float32)
        bot = np.array(hex_to_bgr(gradient_end), dtype=np.float32)
        col = np.linspace(top, bot, height, dtype=np.float32).reshape(height, 1, 3)
        return np.broadcast_to(col, (height, width, 3)).copy().astype(np.uint8)

    # ── Solid (default) ──
    return np.full((height, width, 3), hex_to_bgr(bg_colour), dtype=np.uint8)


# ─── Rounded-corner alpha mask ───────────────────────────────────────────────

def build_corner_mask(width: int, height: int, radius: int) -> np.ndarray:
    """Return a (height, width) float32 mask in [0, 1].

    1.0 = fully opaque (inside the rounded shape),
    0.0 = transparent (outside the corners).

    Uses anti-aliased circles so edges look clean at any scale.
    """
    if radius <= 0:
        return np.ones((height, width), dtype=np.float32)

    r = min(radius, min(width, height) // 2)
    mask = np.ones((height, width), dtype=np.uint8) * 255

    # Blank out each corner square, then draw a filled AA circle to round it.
    corners = [
        ((0, 0, r, r), (r, r)),                             # top-left
        ((width - r, 0, width, r), (width - r, r)),          # top-right
        ((0, height - r, r, height), (r, height - r)),       # bottom-left
        ((width - r, height - r, width, height), (width - r, height - r)),  # bottom-right
    ]
    for (x1, y1, x2, y2), (cx, cy) in corners:
        mask[y1:y2, x1:x2] = 0
        cv2.circle(mask, (cx, cy), r, 255, -1, cv2.LINE_AA)

    return mask.astype(np.float32) / 255.0


def precompute_corner_patches(
    mask: np.ndarray, radius: int, frame_w: int, frame_h: int
) -> list[tuple[slice, slice, np.ndarray]]:
    """Extract the four small corner patches where mask < 1.0.

    Returns a list of (y_slice, x_slice, mask_patch_3ch) so the frame loop
    only needs to alpha-blend these tiny regions — not the full frame.
    """
    if radius <= 0:
        return []

    r = min(radius, min(frame_w, frame_h) // 2)
    patches: list[tuple[slice, slice, np.ndarray]] = []

    slices = [
        (slice(0, r), slice(0, r)),
        (slice(0, r), slice(frame_w - r, frame_w)),
        (slice(frame_h - r, frame_h), slice(0, r)),
        (slice(frame_h - r, frame_h), slice(frame_w - r, frame_w)),
    ]
    for ys, xs in slices:
        m = mask[ys, xs][:, :, np.newaxis]  # (r, r, 1) float32
        patches.append((ys, xs, m))

    return patches
