"""
events.py – Event loading, debouncing, coordinate mapping, and interpolation.

All functions are pure (no side effects, no global state) and operate on
plain dicts / lists, keeping them easy to test and reason about.
"""

from __future__ import annotations

import bisect
import json
import os
import sys
from typing import Any


# ─── Type aliases (plain dicts — we don't need heavy dataclasses here) ───────

Event = dict[str, Any]


# ─── Loading ──────────────────────────────────────────────────────────────────

def load_events(path: str) -> list[Event]:
    """Load events.json.  Returns [] on missing or invalid file."""
    if not path or not os.path.exists(path):
        return []
    try:
        with open(path, "r") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as exc:
        print(f"[Events] Warning: failed to load {path}: {exc}", file=sys.stderr)
        return []


def split_events(
    events: list[Event],
) -> tuple[list[Event], list[Event], list[Event]]:
    """Split raw events into (clicks, scrolls, moves), each sorted by timestamp."""
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
    return clicks, scrolls, moves


# ─── Click debouncing ────────────────────────────────────────────────────────

def debounce_clicks(clicks: list[Event], gap: float = 0.4) -> list[Event]:
    """Merge rapid-fire click bursts into a single event.

    Within each burst (gap ≤ *gap* seconds) the **last** click is kept so
    that the zoom target lands on the final position of the burst.
    """
    if not clicks:
        return []

    result: list[Event] = []
    burst: list[Event] = [clicks[0]]

    for click in clicks[1:]:
        if click["timestamp"] - burst[-1]["timestamp"] <= gap:
            burst.append(click)
        else:
            result.append(burst[-1])
            burst = [click]
    result.append(burst[-1])
    return result


# ─── Coordinate mapping ──────────────────────────────────────────────────────

def to_canvas_coords(
    events: list[Event],
    origin_x: float,
    origin_y: float,
    scale: float,
    padding: int,
    frame_w: int,
    frame_h: int,
) -> list[Event]:
    """Translate global screen coords → canvas-space coords.

    Pipeline:  (event - origin) * scale + padding, clamped to recording area.
    """
    out: list[Event] = []
    for e in events:
        ne = dict(e)
        if "x" in ne:
            ne["x"] = (ne["x"] - origin_x) * scale + padding
            ne["x"] = max(padding, min(frame_w + padding, ne["x"]))
        if "y" in ne:
            ne["y"] = (ne["y"] - origin_y) * scale + padding
            ne["y"] = max(padding, min(frame_h + padding, ne["y"]))
        out.append(ne)
    return out


# ─── Meta loading ────────────────────────────────────────────────────────────

def load_meta(
    meta_path: str | None, frame_w: int
) -> tuple[float, float, float]:
    """Parse meta.json → (origin_x, origin_y, scale_factor).

    Returns (0, 0, 1.0) when meta is unavailable or broken.
    """
    if not meta_path or not os.path.exists(meta_path):
        return 0.0, 0.0, 1.0

    try:
        with open(meta_path, "r") as f:
            meta = json.load(f)

        ox = float(meta.get("originX", 0))
        oy = float(meta.get("originY", 0))

        sf = meta.get("scaleFactor")
        cw = meta.get("captureWidth")

        if sf and float(sf) > 0:
            scale = float(sf)
        elif cw and int(cw) > 0:
            scale = frame_w / int(cw)
        else:
            scale = 1.0

        source = meta.get("sourceType", "unknown")
        print(
            f"[Events] Capture origin=({ox}, {oy}), "
            f"source={source}, scale={scale:.4f}",
            file=sys.stderr,
        )
        return ox, oy, scale
    except Exception as exc:
        print(f"[Events] Warning: meta.json parse failed: {exc}", file=sys.stderr)
        return 0.0, 0.0, 1.0


# ─── Cursor interpolation ────────────────────────────────────────────────────

class CursorInterpolator:
    """Fast cursor-position lookup with pre-built timestamp index.

    Uses bisect for O(log n) timestamp lookup instead of linear scan.
    """

    def __init__(self, moves: list[Event]) -> None:
        self._moves = moves
        self._times = [m["timestamp"] for m in moves]

    def at(self, t: float) -> tuple[float, float] | None:
        """Return interpolated (x, y) at time *t*, or None if no data."""
        if not self._moves:
            return None

        if t <= self._times[0]:
            return self._moves[0]["x"], self._moves[0]["y"]

        if t >= self._times[-1]:
            return self._moves[-1]["x"], self._moves[-1]["y"]

        # Find insertion point → bracketing pair is (idx-1, idx)
        idx = bisect.bisect_right(self._times, t)
        if idx <= 0:
            idx = 1
        if idx >= len(self._moves):
            idx = len(self._moves) - 1

        a = self._moves[idx - 1]
        b = self._moves[idx]
        dt = b["timestamp"] - a["timestamp"]
        if dt <= 0:
            return a["x"], a["y"]

        frac = (t - a["timestamp"]) / dt
        x = a["x"] + (b["x"] - a["x"]) * frac
        y = a["y"] + (b["y"] - a["y"]) * frac
        return x, y


# ─── Camera scheduling ───────────────────────────────────────────────────────

def schedule_camera(
    camera,  # SmoothCamera (avoid circular import)
    clicks: list[Event],
    scrolls: list[Event],
    cursor: CursorInterpolator,
    t: float,
    zoom_factor: float,
    hold_duration: float,
) -> None:
    """Set camera target + zoom for the current time.

    Rules:
      1. If a click is active (within hold window): zoom in, snap to click,
         then gently follow cursor after a short settle period.
      2. Otherwise: zoom out, lazily recenter.
      3. Scroll events add a temporary vertical offset.
    """
    active_click: Event | None = None
    click_age = 0.0

    for click in clicks:
        ct = click["timestamp"]
        if ct <= t <= ct + hold_duration:
            active_click = click
            click_age = t - ct

    if active_click is not None:
        camera.set_zoom(zoom_factor)

        settle = 0.35  # seconds before switching to cursor-follow
        if click_age < settle:
            camera.set_target(active_click["x"], active_click["y"], mode="snap")
        else:
            pos = cursor.at(t)
            if pos:
                camera.set_target(pos[0], pos[1], mode="follow")
            else:
                camera.set_target(active_click["x"], active_click["y"], mode="snap")
    else:
        camera.set_target(camera.canvas_w / 2.0, camera.canvas_h / 2.0, mode="recenter")
        camera.reset_zoom()

    # Scroll offset (temporary vertical nudge)
    for scroll in scrolls:
        st = scroll["timestamp"]
        dur = 0.6
        if st <= t <= st + dur:
            progress = (t - st) / dur
            ease = progress * progress * (3.0 - 2.0 * progress)  # smoothstep
            offset = scroll.get("rotation", 0) * 55.0 * (1.0 - ease)
            camera._target_y = max(
                0.0, min(float(camera.canvas_h), camera._target_y + offset)
            )
