#!/usr/bin/env python3
"""
Screen Studio-style video post-processor (v2).

Reads a raw screen recording + events.json and produces a polished video with:
  - Smooth auto-zoom on clicks (critically-damped spring physics)
  - Buttery sub-pixel camera panning between click targets
  - Click highlight ripple animation
  - Scroll-based panning
  - Optional background compositing with rounded-corner shadows

Usage:
  python process.py input.webm events.json output.mp4 [options]

The implementation lives in the ``processor/`` package.  This file is a
thin CLI entry point so that the Node/Electron integration and PyInstaller
bundling continue to work unchanged.
"""

import argparse
import os
import subprocess
import sys

# Auto-install dependencies when running from source
try:
    import cv2
    import numpy as np
except ImportError:
    print("Installing required packages...", file=sys.stderr)
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "opencv-python", "numpy"],
        stdout=subprocess.DEVNULL,
    )

# Ensure the scripts/ directory is on sys.path so ``processor`` resolves
# both when invoked as ``python process.py`` and when frozen by PyInstaller.
_scripts_dir = os.path.dirname(os.path.abspath(__file__))
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)

from processor.pipeline import process_video  # noqa: E402

print(f"Screen Studio Post-Processor v{process_video.__module__} (Python {sys.version.split()[0]})")

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Screen Studio-style video post-processor"
    )
    parser.add_argument("input", help="Input video (webm/mp4)")
    parser.add_argument("events", help="Events JSON file")
    parser.add_argument("output", help="Output MP4 path")
    parser.add_argument(
        "--zoom", type=float, default=2.0,
        help="Zoom factor on clicks (default: 2.0)",
    )
    parser.add_argument(
        "--hold", type=float, default=1.5,
        help="Seconds to hold zoom (default: 1.5)",
    )
    parser.add_argument(
        "--ffmpeg", default="ffmpeg",
        help="Path to ffmpeg binary",
    )
    # Background / composite flags
    parser.add_argument(
        "--background", action="store_true",
        help="Composite recording onto a background before zoom",
    )
    parser.add_argument(
        "--padding", type=int, default=48,
        help="Padding in pixels around the recording (default: 48)",
    )
    parser.add_argument(
        "--corner-radius", type=int, default=12,
        help="Corner radius in pixels for the recording frame (default: 12)",
    )
    parser.add_argument(
        "--bg-type", default="solid", choices=["solid", "gradient", "image"],
        help="Background type (default: solid)",
    )
    parser.add_argument(
        "--bg-color", default="#6366f1",
        help="Solid background colour hex (default: #6366f1)",
    )
    parser.add_argument(
        "--gradient-start", default="#667eea",
        help="Gradient start colour hex (default: #667eea)",
    )
    parser.add_argument(
        "--gradient-end", default="#764ba2",
        help="Gradient end colour hex (default: #764ba2)",
    )
    parser.add_argument(
        "--wallpaper", default=None,
        help="Path to wallpaper image (used when --bg-type=image)",
    )
    parser.add_argument(
        "--encoder", default="libx264",
        help="FFmpeg video encoder (default: libx264)",
    )
    parser.add_argument(
        "--meta", default=None,
        help="Path to meta.json for coordinate normalisation",
    )
    parser.add_argument(
        "--shadow-blur", type=int, default=0,
        help="Shadow blur radius in pixels (0 = disabled)",
    )
    parser.add_argument(
        "--image-blur", default="none", choices=["none", "moderate", "strong"],
        help="Blur strength for image background (default: none)",
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
        ffmpeg_encoder=args.encoder,
        meta_path=args.meta,
        with_background=args.background,
        padding=args.padding,
        corner_radius=args.corner_radius,
        shadow_blur=args.shadow_blur,
        bg_type=args.bg_type,
        bg_colour=args.bg_color,
        gradient_start=args.gradient_start,
        gradient_end=args.gradient_end,
        wallpaper_path=args.wallpaper,
        image_blur=args.image_blur,
    )


if __name__ == "__main__":
    main()
