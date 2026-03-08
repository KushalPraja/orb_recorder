// VideoLayer.tsx — Renders the video with zoom/pan CSS transforms.
// Uses GPU-accelerated CSS transforms for smooth sub-pixel rendering.
// Uses plain <video> element instead of Remotion's <Video> for Electron file:// compatibility.

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export interface VideoLayerProps {
  videoSrc: string;
  canvasW: number;
  canvasH: number;
  frameW: number;
  frameH: number;
  padding: number;
  cornerRadius: number;
  shadowBlur: number;
  crop: { x: number; y: number; w: number; h: number };
  /** Use OffthreadVideo for export (better perf), Video for preview */
  useOffthread?: boolean;
}

export const VideoLayer: React.FC<VideoLayerProps> = ({
  videoSrc,
  canvasW,
  canvasH,
  frameW,
  frameH,
  padding,
  cornerRadius,
  shadowBlur,
  crop,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Scale factor: how much to scale the canvas to fill the output
  const scaleX = canvasW / crop.w;
  const scaleY = canvasH / crop.h;
  const scale = Math.min(scaleX, scaleY);

  // Translation to center the crop region
  const translateX = -crop.x * scale;
  const translateY = -crop.y * scale;

  const shadowCss =
    shadowBlur > 0
      ? `0 ${Math.max(1, Math.round(shadowBlur * 0.4))}px ${shadowBlur}px rgba(0,0,0,0.65)`
      : 'none';

  // Seek the video to the correct time based on the current frame
  const currentTime = frame / fps;
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    // Only seek if needed (avoid constant re-seeks when paused)
    if (Math.abs(vid.currentTime - currentTime) > 0.05) {
      vid.currentTime = currentTime;
    }
  }, [currentTime]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: canvasW,
        height: canvasH,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: canvasW,
          height: canvasH,
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {/* Background area (padding) is transparent — BackgroundLayer shows through */}
        <div
          style={{
            position: 'absolute',
            top: padding,
            left: padding,
            width: frameW,
            height: frameH,
            borderRadius: cornerRadius,
            overflow: 'hidden',
            boxShadow: shadowCss,
          }}
        >
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            playsInline
            style={{
              width: frameW,
              height: frameH,
              objectFit: 'cover',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
};
