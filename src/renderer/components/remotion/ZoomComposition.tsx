// ZoomComposition.tsx — Main Remotion composition for zoom/pan/background.
//
// The full canvas (background + video) is rendered at native size, then
// the zoom crop is applied as a CSS transform on the entire composition.
// This matches the export pipeline where background is composed first,
// then the zoom engine crops the full canvas — so background zooms with video.

import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { ZoomEngine, type ZoomEngineConfig } from '../../lib/zoom-engine';
import { BackgroundLayer } from './BackgroundLayer';
import { RippleOverlay } from './RippleOverlay';
import type { InputEvent } from '../../../shared/types';

export interface ZoomCompositionProps extends Record<string, unknown> {
  videoSrc: string;
  events: InputEvent[];
  meta?: { originX?: number; originY?: number; scaleFactor?: number; captureWidth?: number } | null;
  frameW: number;
  frameH: number;
  zoomFactor: number;
  holdDuration: number;
  customZoomSegments?: import('../../../shared/types').ZoomSegment[];

  // Background settings
  withBackground: boolean;
  padding: number;
  cornerRadius: number;
  shadowBlur: number;
  backgroundType: 'solid' | 'gradient' | 'image';
  backgroundColor?: string;
  gradientStart?: string;
  gradientEnd?: string;
  wallpaperFile?: string;
  imageBlur?: 'none' | 'moderate' | 'strong';

  /** Whether the player is currently playing (for audio sync) */
  isPlaying?: boolean;
}

export const ZoomComposition: React.FC<ZoomCompositionProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const {
    videoSrc,
    events,
    meta,
    frameW,
    frameH,
    zoomFactor,
    holdDuration,
    withBackground,
    padding,
    cornerRadius,
    shadowBlur,
    backgroundType,
    backgroundColor,
    gradientStart,
    gradientEnd,
    wallpaperFile,
    imageBlur,
    isPlaying = false,
    customZoomSegments,
  } = props;

  const pad = withBackground ? padding : 0;
  const canvasW = width;
  const canvasH = height;

  // Build zoom engine once (memoized on stable inputs)
  const engine = useMemo(() => {
    const config: ZoomEngineConfig = {
      canvasW,
      canvasH,
      frameW,
      frameH,
      fps,
      zoomFactor,
      holdDuration,
      padding: pad,
      meta,
      customSegments: customZoomSegments,
    };
    return new ZoomEngine(config, events);
  }, [canvasW, canvasH, frameW, frameH, fps, zoomFactor, holdDuration, pad, meta, events, customZoomSegments]);

  const state = engine.computeFrameState(frame);
  const { crop } = state;

  // Zoom transform: scale the full canvas so the crop region fills the output.
  // This is identical to what the export does (cropAndScale on the full canvas).
  const scaleX = canvasW / crop.w;
  const scaleY = canvasH / crop.h;
  const scale = Math.min(scaleX, scaleY);
  const translateX = -crop.x * scale;
  const translateY = -crop.y * scale;

  const shadowCss =
    shadowBlur > 0
      ? `0 ${Math.max(1, Math.round(shadowBlur * 0.4))}px ${shadowBlur}px rgba(0,0,0,0.65)`
      : 'none';

  // Sync video element with Remotion Player (time + play/pause for audio)
  const currentTime = frame / fps;
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    if (isPlaying) {
      // When playing, let the video play naturally for smooth audio.
      // Only correct if it drifts too far from expected time.
      if (vid.paused) {
        vid.currentTime = currentTime;
        vid.play().catch(() => {});
      } else if (Math.abs(vid.currentTime - currentTime) > 0.15) {
        vid.currentTime = currentTime;
      }
    } else {
      // When paused, seek to exact frame
      if (!vid.paused) vid.pause();
      if (Math.abs(vid.currentTime - currentTime) > 0.05) {
        vid.currentTime = currentTime;
      }
    }
  }, [currentTime, isPlaying]);

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', backgroundColor: '#000' }}>
      {/* Apply zoom crop as a transform on the ENTIRE canvas (bg + video).
          This matches the export pipeline where cropAndScale operates on
          the full composed frame. */}
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
        {/* Background layer — part of the zoomed canvas */}
        {withBackground && (
          <BackgroundLayer
            width={canvasW}
            height={canvasH}
            backgroundType={backgroundType}
            backgroundColor={backgroundColor}
            gradientStart={gradientStart}
            gradientEnd={gradientEnd}
            wallpaperFile={wallpaperFile}
            imageBlur={imageBlur}
          />
        )}

        {/* Video with rounded corners + shadow */}
        <div
          style={{
            position: 'absolute',
            top: pad,
            left: pad,
            width: frameW,
            height: frameH,
            borderRadius: withBackground ? cornerRadius : 0,
            overflow: 'hidden',
            boxShadow: withBackground ? shadowCss : 'none',
          }}
        >
          <video
            ref={videoRef}
            src={videoSrc}
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

      {/* Click ripple overlay (on top of zoom, in output space) */}
      <RippleOverlay
        width={width}
        height={height}
        ripples={state.activeRipples}
      />
    </div>
  );
};
