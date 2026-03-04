"""
pipeline.py  Frame-by-frame processing loop and FFmpeg I/O.
Public entry point:  ``process_video(**kwargs) → output_path``
"""

from __future__ import annotations

import subprocess
import sys
import time
from typing import Literal

import cv2
import numpy as np

from .background import (
    build_background,
    build_corner_mask,
    precompute_corner_patches,
)
from .camera import SmoothCamera
from .effects import ClickRipple
from .events import (
    CursorInterpolator,
    debounce_clicks,
    load_events,
    load_meta,
    schedule_camera,
    split_events,
    to_canvas_coords,
)
from .shadow import apply_shadow, build_shadow


# ─── Encoder helpers ──────────────────────────────────────────────────────────

_HW_ENCODERS = {"h264_nvenc", "h264_amf", "h264_videotoolbox", "hevc_nvenc"}


def _quality_flags(encoder: str) -> list[str]:
    if encoder == "h264_nvenc":
        return ["-rc", "vbr", "-cq", "18", "-preset", "p4"]
    if encoder in _HW_ENCODERS:
        return ["-qp", "18"]
    return ["-crf", "18", "-preset", "medium"]


# ─── Compositor (per-frame canvas building) ───────────────────────────────────

class _Compositor:
    """Stamps source frame onto the canvas with background, rounded corners,
    and (pre-baked) shadow.  Shadow is applied once at init time so the
    hot ``composite()`` call is minimal NumPy work.
    """

    def __init__(
        self,
        frame_w: int,
        frame_h: int,
        padding: int,
        canvas_w: int,
        canvas_h: int,
        baked_bg: np.ndarray,
        corner_patches: list[tuple[slice, slice, np.ndarray]],
    ) -> None:
        self.frame_w = frame_w
        self.frame_h = frame_h
        self.pad = padding
        self._buf = np.empty((canvas_h, canvas_w, 3), dtype=np.uint8)
        self._bg = baked_bg

        # Pre-compute bg_contrib = baked_bg_corner * (1 - mask) for each corner.
        # Hot path only needs: frame_patch * mask + bg_contrib  (one multiply).
        p = padding
        self._patches: list[tuple[slice, slice, np.ndarray, np.ndarray]] = []
        for ys, xs, m in corner_patches:
            bg_patch = baked_bg[
                p + ys.start : p + ys.stop,
                p + xs.start : p + xs.stop,
            ].astype(np.float32)
            self._patches.append((ys, xs, m, bg_patch * (1.0 - m)))

    def composite(self, frame: np.ndarray) -> np.ndarray:
        """Stamp *frame* onto the canvas.  Shadow is already in _bg."""
        canvas = self._buf
        np.copyto(canvas, self._bg)

        p, fh, fw = self.pad, self.frame_h, self.frame_w
        src = frame[:fh, :fw]
        canvas[p : p + fh, p : p + fw] = src            # bulk paste

        for ys, xs, m, bg_c in self._patches:           # fix 4 corners only
            blended = np.add(
                src[ys, xs].astype(np.float32) * m, bg_c, casting="unsafe"
            ).astype(np.uint8)
            canvas[p + ys.start : p + ys.stop, p + xs.start : p + xs.stop] = blended

        return canvas


# ─── Sub-pixel crop + scale ───────────────────────────────────────────────────

def _crop_and_scale(
    canvas: np.ndarray,
    crop: tuple[float, float, float, float],
    out_w: int,
    out_h: int,
) -> np.ndarray:

    """Crop with sub-pixel precision using ``cv2.getRectSubPix``, then scale.

    This eliminates the pixel-snapping jitter that plagued the old int-based
    crop path — the camera can glide smoothly across fractional pixels.
    """
    cx, cy, cw, ch = crop
    canvas_h, canvas_w = canvas.shape[:2]

    icw = max(1, min(canvas_w, int(round(cw))))
    ich = max(1, min(canvas_h, int(round(ch))))
    centre_x = float(cx + cw / 2.0)
    centre_y = float(cy + ch / 2.0)

    centre_x = max(icw / 2.0, min(canvas_w - icw / 2.0, centre_x))
    centre_y = max(ich / 2.0, min(canvas_h - ich / 2.0, centre_y))

    patch = cv2.getRectSubPix(canvas, (icw, ich), (centre_x, centre_y))

    # Scale to output.  INTER_AREA for downscale, INTER_LINEAR for upscale.
    if icw > out_w or ich > out_h:
        interp = cv2.INTER_AREA
    else:
        interp = cv2.INTER_LINEAR
    return cv2.resize(patch, (out_w, out_h), interpolation=interp)


# ─── Main entry point ────────────────────────────────────────────────────────

def process_video(
    input_path: str,
    events_path: str,
    output_path: str,
    zoom_factor: float = 2.0,
    hold_duration: float = 1.5,
    ffmpeg_path: str = "ffmpeg",
    ffmpeg_encoder: str = "libx264",
    meta_path: str | None = None,
    # Background compositing
    with_background: bool = False,
    padding: int = 48,
    corner_radius: int = 12,
    shadow_blur: int = 0,
    bg_type: Literal["solid", "gradient", "image"] = "solid",
    bg_colour: str = "#6366f1",
    gradient_start: str = "#667eea",
    gradient_end: str = "#764ba2",
    wallpaper_path: str | None = None,
    image_blur: Literal["none", "moderate", "strong"] = "none",
) -> str:
    """Process a recording into a polished video.

    Returns *output_path* on success, raises on failure.
    """

    # ── 1. Load events ────────────────────────────────────────────
    raw_events = load_events(events_path)
    clicks, scrolls, moves = split_events(raw_events)
    clicks = debounce_clicks(clicks, gap=0.4)
    print(
        f"[Processor] Events: {len(clicks)} clicks (debounced), "
        f"{len(scrolls)} scrolls, {len(moves)} moves",
        file=sys.stderr,
    )

    # ── 2. Open video ─────────────────────────────────────────────
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {input_path}")

    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if fps <= 0 or fps > 240:
        fps = 30.0
    if total_frames <= 0:
        total_frames = 0

    # ── 3. Coordinate mapping ─────────────────────────────────────
    origin_x, origin_y, scale_factor = load_meta(meta_path, frame_w)

    pad = int(padding) if with_background else 0
    raw_cw = frame_w + pad * 2
    raw_ch = frame_h + pad * 2

    out_w = raw_cw + (raw_cw % 2)
    out_h = raw_ch + (raw_ch % 2)

    clicks_c = to_canvas_coords(clicks, origin_x, origin_y, scale_factor, pad, frame_w, frame_h)
    scrolls_c = to_canvas_coords(scrolls, origin_x, origin_y, scale_factor, pad, frame_w, frame_h)
    moves_c = to_canvas_coords(moves, origin_x, origin_y, scale_factor, pad, frame_w, frame_h)

    print(
        f"[Processor] Video: {frame_w}x{frame_h} @ {fps:.1f} fps, "
        f"~{total_frames} frames → canvas {out_w}x{out_h} (pad={pad})",
        file=sys.stderr,
    )

    # ── 4. Fast path: no events and no background → simple re-encode ──
    if not clicks and not moves and not with_background:
        cap.release()
        subprocess.run(
            [
                ffmpeg_path, "-y", "-i", input_path,
                "-c:v", ffmpeg_encoder, *_quality_flags(ffmpeg_encoder),
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                "-an", output_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return output_path

    # ── 5. Build background / compositor ──────────────────────────
    compositor: _Compositor | None = None
    if with_background:
        r = max(0, min(int(corner_radius), min(frame_w, frame_h) // 4))
        bg_frame = build_background(
            out_w, out_h,
            bg_type=bg_type,
            bg_colour=bg_colour,
            gradient_start=gradient_start,
            gradient_end=gradient_end,
            wallpaper_path=wallpaper_path,
            image_blur=image_blur,
        )
        corner_mask = build_corner_mask(frame_w, frame_h, r)
        patches = precompute_corner_patches(corner_mask, r, frame_w, frame_h)

        # Bake shadow into bg once — removed from the per-frame hot path.
        # Using the rounded corner_mask means the shadow is correctly rounded.
        shadow_layer = build_shadow(
            corner_mask, frame_w, frame_h, pad, out_w, out_h,
            blur_radius=float(shadow_blur),
        )
        if shadow_layer is not None:
            apply_shadow(bg_frame, shadow_layer)          # mutate bg in-place
            print(f"[Processor] Shadow baked: sigma={shadow_blur}, rounded=True", file=sys.stderr)

        compositor = _Compositor(
            frame_w, frame_h, pad, out_w, out_h, bg_frame, patches,
        )

    # ── 6. Camera + ripples ───────────────────────────────────────
    camera = SmoothCamera(out_w, out_h, fps)
    cursor = CursorInterpolator(moves_c)
    ripples = [ClickRipple(c["x"], c["y"], c["timestamp"]) for c in clicks_c]

    # ── 7. FFmpeg writer pipe ─────────────────────────────────────
    ffmpeg_cmd = [
        ffmpeg_path, "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{out_w}x{out_h}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",
        "-c:v", ffmpeg_encoder, *_quality_flags(ffmpeg_encoder),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        output_path,
    ]
    print(
        f"[Processor] Starting → {output_path} "
        f"(zoom={zoom_factor}, hold={hold_duration}s, encoder={ffmpeg_encoder})",
        file=sys.stderr,
    )
    writer = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # ── 8. Frame loop ─────────────────────────────────────────────
    frame_idx = 0
    last_pct = -1
    t0 = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Authoritative timestamp from frame index (not CAP_PROP_POS_MSEC)
        t = frame_idx / fps

        # Camera targeting
        schedule_camera(camera, clicks_c, scrolls_c, cursor, t, zoom_factor, hold_duration)
        camera.update()

        # Build canvas
        if compositor is not None:
            canvas = compositor.composite(frame)
        else:
            canvas = frame

        # Crop + scale (sub-pixel for smooth motion)
        crop = camera.get_crop()
        scaled = _crop_and_scale(canvas, crop, out_w, out_h)

        # Click ripples
        for ripple in ripples:
            if ripple.is_alive(t):
                ripple.draw(scaled, t, crop, out_w, out_h)

        # Write
        try:
            writer.stdin.write(scaled.tobytes())  # type: ignore[union-attr]
        except BrokenPipeError:
            print("[Processor] FFmpeg pipe broke", file=sys.stderr)
            break

        # Progress (stdout — parsed by Node wrapper)
        frame_idx += 1
        if total_frames > 0:
            pct = min(100, int(frame_idx / total_frames * 100))
            if pct != last_pct:
                last_pct = pct
                print(f"PROGRESS:{pct}", flush=True)

    # ── 9. Cleanup ────────────────────────────────────────────────
    cap.release()
    if writer.stdin and not writer.stdin.closed:
        writer.stdin.close()
    writer.wait()

    elapsed = time.time() - t0
    print(
        f"[Processor] Done → {output_path} "
        f"({frame_idx} frames in {elapsed:.1f}s)",
        file=sys.stderr,
    )
    if writer.returncode != 0:
        raise RuntimeError(f"FFmpeg exited with code {writer.returncode}")

    return output_path
