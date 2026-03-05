"""
camera.py – Critically-damped spring virtual camera.

Instead of raw exponential smoothing (which oscillates or feels sluggish),
this module uses a **second-order critically-damped spring** for both
position and zoom.  The result is Screen-Studio-quality motion: quick
arrival with no overshoot and a natural deceleration.

The maths:
    x'' = -2ζω·x' - ω²·(x - target)
where ζ = 1 (critical damping) and ω controls response speed.

We integrate with the semi-implicit Euler method each frame, which is
stable and cheap.

All coordinates are in *canvas space* (recording + padding).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


# ─── Tuning presets (ω values at 60 fps) ────────────────────────────────────
# Higher ω = faster response.  These are tuned empirically to feel
# like Screen Studio's auto-zoom.

OMEGA_SNAP = 14.0       # click-snap:   fast arrival, ~120 ms settle
OMEGA_FOLLOW = 6.0      # cursor-follow: gentle, ~350 ms
OMEGA_RECENTER = 3.5    # zoom-out drift: lazy, ~600 ms
OMEGA_ZOOM = 9.0        # zoom level change: ~200 ms


@dataclass
class _Spring1D:
    """One-dimensional critically-damped spring state."""

    pos: float = 0.0
    vel: float = 0.0

    def step(self, target: float, omega: float, dt: float) -> None:
        """Advance one time-step with semi-implicit Euler integration.

        For critical damping (ζ = 1):
            accel = -2ω·vel - ω²·(pos - target)
        """
        diff = self.pos - target
        accel = -2.0 * omega * self.vel - omega * omega * diff
        self.vel += accel * dt
        self.pos += self.vel * dt

    def snap(self, value: float) -> None:
        """Instantly teleport (used for first-frame init)."""
        self.pos = value
        self.vel = 0.0


@dataclass
class SmoothCamera:
    """Virtual camera with critically-damped spring physics.

    Usage:
        cam = SmoothCamera(canvas_w, canvas_h, fps=30)
        cam.set_target(x, y, mode='snap')  # on click
        cam.set_zoom(2.0)
        cam.update()                        # each frame
        crop = cam.get_crop()               # (x, y, w, h)
    """

    canvas_w: int
    canvas_h: int
    fps: float = 30.0

    # ── internal spring state (created in __post_init__) ──
    _sx: _Spring1D = field(default_factory=_Spring1D, repr=False)
    _sy: _Spring1D = field(default_factory=_Spring1D, repr=False)
    _sz: _Spring1D = field(default_factory=_Spring1D, repr=False)

    _target_x: float = 0.0
    _target_y: float = 0.0
    _target_z: float = 1.0
    _pos_omega: float = OMEGA_RECENTER
    _initialised: bool = False

    def __post_init__(self) -> None:
        cx = self.canvas_w / 2.0
        cy = self.canvas_h / 2.0
        self._sx = _Spring1D(pos=cx, vel=0.0)
        self._sy = _Spring1D(pos=cy, vel=0.0)
        self._sz = _Spring1D(pos=1.0, vel=0.0)
        self._target_x = cx
        self._target_y = cy
        self._target_z = 1.0
        self._initialised = True

    # ── public API ──────────────────────────────────────────────

    def set_target(self, x: float, y: float, mode: str = "snap") -> None:
        """Set position target.  *mode* selects responsiveness:
        'snap'      – fast arrival (click events)
        'follow'    – gentle tracking (cursor follow while zoomed)
        'recenter'  – lazy drift back to centre
        """
        self._target_x = max(0.0, min(float(self.canvas_w), x))
        self._target_y = max(0.0, min(float(self.canvas_h), y))

        if mode == "snap":
            self._pos_omega = OMEGA_SNAP
        elif mode == "follow":
            self._pos_omega = OMEGA_FOLLOW
        else:
            self._pos_omega = OMEGA_RECENTER

    def set_zoom(self, z: float) -> None:
        self._target_z = max(1.0, z)

    def reset_zoom(self) -> None:
        self._target_z = 1.0

    def update(self) -> None:
        """Advance one frame.  Frame-rate independent via dt."""
        dt = 1.0 / max(1.0, self.fps)

        self._sx.step(self._target_x, self._pos_omega, dt)
        self._sy.step(self._target_y, self._pos_omega, dt)
        self._sz.step(self._target_z, OMEGA_ZOOM, dt)

        # Snap zoom to 1.0 when essentially there (avoids perpetual micro-zoom)
        if abs(self._sz.pos - 1.0) < 0.005 and abs(self._sz.vel) < 0.05:
            self._sz.pos = 1.0
            self._sz.vel = 0.0

        # Clamp zoom floor
        if self._sz.pos < 1.0:
            self._sz.pos = 1.0
            self._sz.vel = 0.0

    def get_crop(self) -> tuple[float, float, float, float]:
        """Return (x, y, w, h) crop in *float* canvas coords.

        The pipeline uses floating-point crops and sub-pixel interpolation
        so the camera motion is perfectly smooth — no pixel-snapping jitter.
        """
        zoom = max(1.0, self._sz.pos)
        cw = self.canvas_w / zoom
        ch = self.canvas_h / zoom

        cx = self._sx.pos - cw / 2.0
        cy = self._sy.pos - ch / 2.0

        # Clamp to canvas bounds
        cx = max(0.0, min(float(self.canvas_w) - cw, cx))
        cy = max(0.0, min(float(self.canvas_h) - ch, cy))

        return (cx, cy, cw, ch)

    @property
    def zoom(self) -> float:
        return self._sz.pos

    @property
    def x(self) -> float:
        return self._sx.pos

    @property
    def y(self) -> float:
        return self._sy.pos
