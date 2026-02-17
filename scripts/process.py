#!/usr/bin/env python3
"""
Screen Studio-style video post-processor.

Reads a raw screen recording + events.json and produces a polished video with:
  - Smooth auto-zoom on clicks (exponential smoothing, no keyframes)
  - Buttery camera panning between click targets
  - Click highlight ripple animation
  - Scroll-based panning

The camera uses spring-like exponential smoothing so all transitions look
natural without any keyframe/segment complexity.

Usage:
  python process.py input.webm events.json output.mp4 [options]
"""

import argparse
import json
import math
import os
import subprocess
import sys
import time

try:
    import cv2
    import numpy as np
except ImportError:
    print("Installing required packages...", file=sys.stderr)
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "opencv-python", "numpy"],
        stdout=subprocess.DEVNULL,
    )
    import cv2
    import numpy as np


# ─── Smooth Camera ──────────────────────────────────────────────────


class SmoothCamera:
    """
    Virtual camera with exponential-smoothing physics.

    Instead of hard keyframes, just set a target and call update() each frame.
    The camera converges smoothly — like Screen Studio's auto-zoom.

    Smoothing is frame-rate-independent: results look the same at 30 or 60 fps.
    """

    def __init__(self, frame_w, frame_h, fps=30):
        self.frame_w = frame_w
        self.frame_h = frame_h
        self.fps = fps

        # Current state
        self.x = frame_w / 2
        self.y = frame_h / 2
        self.zoom = 1.0

        # Targets
        self.tx = frame_w / 2
        self.ty = frame_h / 2
        self.tz = 1.0

        # Smoothing bases (tuned for 30 fps, auto-scaled for other rates)
        self._snap_base  = 0.12   # click snap:    ~250ms converge
        self._follow_base = 0.04  # cursor follow:  ~700ms converge (gentle)
        self._recenter_base = 0.03 # zoom-out drift: ~1s converge (very lazy)
        self._zoom_base  = 0.07   # zoom level:    ~400ms converge

        # Active smoothing mode (set by update_camera_for_frame)
        self._pos_mode = 'recenter'  # 'snap' | 'follow' | 'recenter'

    def _alpha(self, base):
        """Frame-rate independent smoothing factor."""
        return 1.0 - (1.0 - base) ** (30.0 / max(1, self.fps))

    def set_target(self, x, y, mode='snap'):
        self.tx = max(0, min(self.frame_w, x))
        self.ty = max(0, min(self.frame_h, y))
        self._pos_mode = mode

    def set_zoom(self, z):
        self.tz = max(1.0, z)

    def reset_zoom(self):
        self.tz = 1.0

    def update(self):
        """Advance one frame."""
        if self._pos_mode == 'snap':
            pa = self._alpha(self._snap_base)
        elif self._pos_mode == 'follow':
            pa = self._alpha(self._follow_base)
        else:  # recenter
            pa = self._alpha(self._recenter_base)

        za = self._alpha(self._zoom_base)

        self.x += (self.tx - self.x) * pa
        self.y += (self.ty - self.y) * pa
        self.zoom += (self.tz - self.zoom) * za

        # Snap to 1.0 when very close (avoid perpetual micro-zoom)
        if abs(self.zoom - 1.0) < 0.008:
            self.zoom = 1.0

    def get_crop(self):
        """Return (x, y, w, h) integer crop rectangle, clamped to frame."""
        cw = self.frame_w / self.zoom
        ch = self.frame_h / self.zoom

        cx = self.x - cw / 2
        cy = self.y - ch / 2

        cx = max(0, min(self.frame_w - cw, cx))
        cy = max(0, min(self.frame_h - ch, cy))

        return (
            int(round(cx)),
            int(round(cy)),
            int(round(cw)),
            int(round(ch)),
        )


# ─── Click Ripple ───────────────────────────────────────────────────


class ClickRipple:
    """Expanding ring + dot at click position. Fades over ~0.45s."""

    DURATION = 0.45
    MAX_RADIUS = 28

    def __init__(self, x, y, timestamp):
        self.x = x
        self.y = y
        self.t0 = timestamp

    def draw(self, frame, t, crop_rect, out_size):
        if t < self.t0 or t > self.t0 + self.DURATION:
            return

        progress = (t - self.t0) / self.DURATION  # 0 → 1
        cx, cy, cw, ch = crop_rect
        out_w, out_h = out_size

        # Map click position into the cropped+scaled output frame
        draw_x = int((self.x - cx) / cw * out_w)
        draw_y = int((self.y - cy) / ch * out_h)

        if draw_x < 0 or draw_x >= out_w or draw_y < 0 or draw_y >= out_h:
            return

        alpha = 1.0 - progress
        radius = int(8 + self.MAX_RADIUS * progress)
        thickness = max(1, int(2.5 * (1 - progress)))

        # Outer ring — warm highlight
        overlay = frame.copy()
        color = (180, 130, 255)  # light purple-pink (BGR)
        cv2.circle(overlay, (draw_x, draw_y), radius, color, thickness, cv2.LINE_AA)
        cv2.addWeighted(overlay, alpha * 0.65, frame, 1 - alpha * 0.65, 0, frame)

        # Inner dot — brighter, fades earlier
        if progress < 0.6:
            dot_a = 0.7 * (1 - progress / 0.6)
            dot_ov = frame.copy()
            cv2.circle(dot_ov, (draw_x, draw_y), 4, (220, 200, 255), -1, cv2.LINE_AA)
            cv2.addWeighted(dot_ov, dot_a, frame, 1 - dot_a, 0, frame)


# ─── Zoom Scheduler ─────────────────────────────────────────────────


def _interpolate_cursor(moves, t):
    """
    Given sorted move events, return interpolated (x, y) at time t.
    Returns None if no move events exist.
    """
    if not moves:
        return None

    # Before first move → use first position
    if t <= moves[0]["timestamp"]:
        return moves[0]["x"], moves[0]["y"]

    # After last move → use last position
    if t >= moves[-1]["timestamp"]:
        return moves[-1]["x"], moves[-1]["y"]

    # Binary search for bracketing pair
    lo, hi = 0, len(moves) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if moves[mid]["timestamp"] <= t:
            lo = mid
        else:
            hi = mid

    a, b = moves[lo], moves[hi]
    dt = b["timestamp"] - a["timestamp"]
    if dt <= 0:
        return a["x"], a["y"]

    frac = (t - a["timestamp"]) / dt
    x = a["x"] + (b["x"] - a["x"]) * frac
    y = a["y"] + (b["y"] - a["y"]) * frac
    return x, y


def update_camera_for_frame(camera, clicks, scrolls, moves, t, zoom_factor, hold_duration):
    """
    Decide camera target + zoom level for time t.

    Logic:
      - Click within [t, t + hold_duration]:  zoom in + snap to click position.
        After 0.3s of the hold, transition to following cursor (gentle).
      - No active click:  zoom out + slowly recenter. Do NOT chase cursor
        at zoom=1.0 — the whole screen is visible, no need to pan.
      - Scroll events add a temporary vertical offset.
    """
    active_click = None
    click_age = 0.0

    for click in clicks:
        ct = click["timestamp"]
        if ct <= t <= ct + hold_duration:
            active_click = click
            click_age = t - ct

    if active_click:
        camera.set_zoom(zoom_factor)

        settle = 0.35  # seconds to lock on click before following cursor
        if click_age < settle:
            # Snap to click target (fast)
            camera.set_target(active_click["x"], active_click["y"], mode='snap')
        else:
            # While still zoomed, gently follow cursor so view stays useful
            cursor = _interpolate_cursor(moves, t)
            if cursor:
                camera.set_target(cursor[0], cursor[1], mode='follow')
            else:
                camera.set_target(active_click["x"], active_click["y"], mode='snap')
    else:
        # Zoomed out — gently recenter, do NOT chase cursor
        camera.set_target(camera.frame_w / 2, camera.frame_h / 2, mode='recenter')
        camera.reset_zoom()

    # Scroll panning: add temporary offset near scroll event
    for scroll in scrolls:
        st = scroll["timestamp"]
        dur = 0.6
        if st <= t <= st + dur:
            progress = (t - st) / dur
            ease = progress * progress * (3 - 2 * progress)  # smoothstep
            offset = scroll.get("rotation", 0) * 55 * (1 - ease)
            camera.ty = max(0, min(camera.frame_h, camera.ty + offset))


# ─── Main processor ─────────────────────────────────────────────────


def process_video(
    input_path,
    events_path,
    output_path,
    zoom_factor=2.0,
    hold_duration=1.5,
    ffmpeg_path="ffmpeg",
):
    # ── Load events ──────────────────────────────────────────────
    events = []
    if os.path.exists(events_path):
        with open(events_path, "r") as f:
            events = json.load(f)

    clicks = sorted(
        [e for e in events if e.get("type") == "click"],
        key=lambda e: e["timestamp"],
    )
    scrolls = sorted(
        [e for e in events if e.get("type") == "scroll"],
        key=lambda e: e["timestamp"],
    )
    moves = sorted(
        [e for e in events if e.get("type") == "move"],
        key=lambda e: e["timestamp"],
    )

    print(f"[Processor] {len(clicks)} clicks, {len(scrolls)} scrolls, {len(moves)} moves", file=sys.stderr)

    # ── Open video ───────────────────────────────────────────────
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
        total_frames = 0  # unknown

    # Ensure even output dimensions (H.264 requirement)
    out_w = frame_w if frame_w % 2 == 0 else frame_w - 1
    out_h = frame_h if frame_h % 2 == 0 else frame_h - 1

    print(
        f"[Processor] Video: {frame_w}x{frame_h} @ {fps:.1f}fps, "
        f"~{total_frames} frames → {out_w}x{out_h}",
        file=sys.stderr,
    )

    if not clicks and not moves:
        print("[Processor] No clicks or moves — simple re-encode", file=sys.stderr)
        subprocess.run(
            [
                ffmpeg_path, "-y", "-i", input_path,
                "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                "-an", output_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return output_path

    # ── Initialize camera + ripples ──────────────────────────────
    camera = SmoothCamera(frame_w, frame_h, fps)
    ripples = [ClickRipple(c["x"], c["y"], c["timestamp"]) for c in clicks]

    # ── Start ffmpeg writer pipe ─────────────────────────────────
    ffmpeg_cmd = [
        ffmpeg_path, "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{out_w}x{out_h}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        output_path,
    ]

    writer = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # ── Frame loop ───────────────────────────────────────────────
    frame_idx = 0
    video_t0 = None
    last_t = 0.0
    last_pct = -1
    t0 = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Use actual frame timestamp from container when available.
        # This avoids large sync drift when CAP_PROP_FPS is inaccurate (common with WebM/VFR).
        pos_msec = cap.get(cv2.CAP_PROP_POS_MSEC)
        t_from_pos = None
        if pos_msec is not None and math.isfinite(pos_msec) and pos_msec >= 0:
            t_from_pos = pos_msec / 1000.0

        if t_from_pos is not None:
            if video_t0 is None:
                video_t0 = t_from_pos
            t = max(0.0, t_from_pos - video_t0)
        else:
            # Fallback clock if timestamp is unavailable
            t = frame_idx / fps

        # Keep effect timeline monotonic for bad/missing timestamps.
        if t < last_t:
            t = last_t
        last_t = t

        # Camera logic
        update_camera_for_frame(camera, clicks, scrolls, moves, t, zoom_factor, hold_duration)
        camera.update()

        # Crop + scale
        cx, cy, cw, ch = camera.get_crop()

        # Safety clamp
        cy2 = min(cy + ch, frame_h)
        cx2 = min(cx + cw, frame_w)
        cropped = frame[cy:cy2, cx:cx2]

        if cropped.size == 0:
            cropped = frame

        scaled = cv2.resize(cropped, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)

        # Draw click ripples
        for ripple in ripples:
            ripple.draw(scaled, t, (cx, cy, cw, ch), (out_w, out_h))

        # Write frame
        try:
            writer.stdin.write(scaled.tobytes())
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

    # ── Cleanup ──────────────────────────────────────────────────
    cap.release()
    if writer.stdin and not writer.stdin.closed:
        writer.stdin.close()
    writer.wait()

    elapsed = time.time() - t0
    print(
        f"[Processor] Done → {output_path} ({frame_idx} frames in {elapsed:.1f}s)",
        file=sys.stderr,
    )

    if writer.returncode != 0:
        raise RuntimeError(f"FFmpeg exited with code {writer.returncode}")

    return output_path


# ─── CLI ─────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Screen Studio-style video post-processor"
    )
    parser.add_argument("input", help="Input video (webm/mp4)")
    parser.add_argument("events", help="Events JSON file")
    parser.add_argument("output", help="Output MP4 path")
    parser.add_argument(
        "--zoom", type=float, default=2.0, help="Zoom factor on clicks (default: 2.0)"
    )
    parser.add_argument(
        "--hold", type=float, default=1.5, help="Seconds to hold zoom (default: 1.5)"
    )
    parser.add_argument(
        "--ffmpeg", default="ffmpeg", help="Path to ffmpeg binary"
    )

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    process_video(
        input_path=args.input,
        events_path=args.events,
        output_path=args.output,
        zoom_factor=args.zoom,
        hold_duration=args.hold,
        ffmpeg_path=args.ffmpeg,
    )


if __name__ == "__main__":
    main()
