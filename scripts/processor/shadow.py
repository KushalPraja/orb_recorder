"""
shadow.py – Drop shadow that respects rounded corners.

Builds a pre-computed shadow layer from the same rounded-corner mask used
for the recording stamp.  The shadow is Gaussian-blurred so it naturally
follows the rounded shape — no square artefacts.

The shadow is stored as a float32 alpha map and blending slices.  During
the frame loop the pipeline just does one small multiply to darken the
background beneath the recording.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class ShadowLayer:
    """
    Attributes:
        alpha   (H, W, 1) float32 in [0, opacity].  Multiply against
                  the background region to darken it.
        dst_y1, dst_x1, dst_y2, dst_x2 destination slice on the canvas.
        src_y1, src_x1, src_y2, src_x2  matching source slice into *alpha*.
    """

    alpha: np.ndarray

    dst_y1: int
    dst_x1: int
    dst_y2: int
    dst_x2: int

    src_y1: int
    src_x1: int
    src_y2: int
    src_x2: int


def build_shadow(
    corner_mask: np.ndarray,
    frame_w: int,
    frame_h: int,
    padding: int,
    canvas_w: int,
    canvas_h: int,
    blur_radius: float,
    opacity: float = 0.55,
    offset_y_factor: float = 0.3,
) -> ShadowLayer | None:
    """Create a shadow from the recording's rounded-corner mask.

    Args:
        corner_mask : (frame_h, frame_w) float32 [0,1] – the recording shape.
        frame_w, frame_h : source recording dimensions.
        padding     : padding around the recording on the canvas.
        canvas_w, canvas_h : full canvas dimensions.
        blur_radius : Gaussian sigma.  0 = no shadow.
        opacity     : peak shadow darkness [0, 1].
        offset_y_factor : shadow vertical offset as fraction of sigma.

    Returns:
        A ShadowLayer ready for per-frame use, or *None* when disabled.
    """
    if blur_radius <= 0:
        return None

    sigma = float(blur_radius)
    offset_y = max(2, int(sigma * offset_y_factor))
    offset_x = 0

    # Pad the mask so the Gaussian spreads beyond the shape edge.
    spread = int(sigma * 3) + 1
    src_u8 = (corner_mask * 255).astype(np.uint8)

    padded = cv2.copyMakeBorder(
        src_u8, spread, spread, spread, spread,
        cv2.BORDER_CONSTANT, value=0,
    )
    ksize = max(3, int(sigma * 6)) | 1  # must be odd
    blurred = cv2.GaussianBlur(padded, (ksize, ksize), sigma)

    alpha = (blurred.astype(np.float32) / 255.0 * opacity)[:, :, np.newaxis]

    # Canvas placement (centred on recording position + offset)
    dx1 = padding + offset_x - spread
    dy1 = padding + offset_y - spread
    dx2 = dx1 + padded.shape[1]
    dy2 = dy1 + padded.shape[0]

    # Clip to canvas
    sx1 = max(0, -dx1)
    sy1 = max(0, -dy1)
    sx2 = alpha.shape[1] - max(0, dx2 - canvas_w)
    sy2 = alpha.shape[0] - max(0, dy2 - canvas_h)
    dx1 = max(0, dx1)
    dy1 = max(0, dy1)
    dx2 = min(canvas_w, dx2)
    dy2 = min(canvas_h, dy2)

    if dx2 <= dx1 or dy2 <= dy1:
        return None

    return ShadowLayer(
        alpha=alpha,
        dst_y1=dy1, dst_x1=dx1, dst_y2=dy2, dst_x2=dx2,
        src_y1=sy1, src_x1=sx1, src_y2=sy2, src_x2=sx2,
    )


def apply_shadow(canvas: np.ndarray, shadow: ShadowLayer) -> None:
    """Darken the background region under the shadow — in-place, fast."""
    sa = shadow.alpha[
        shadow.src_y1 : shadow.src_y2,
        shadow.src_x1 : shadow.src_x2,
    ]
    region = canvas[
        shadow.dst_y1 : shadow.dst_y2,
        shadow.dst_x1 : shadow.dst_x2,
    ]
    # result = bg * (1 - shadow)
    np.multiply(region, (1.0 - sa), out=region, casting="unsafe")
