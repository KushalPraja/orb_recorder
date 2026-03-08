// ZoomComposition.tsx — Main Remotion composition for zoom/pan/background.
//
// Layers: Background → Video (with CSS transform zoom/crop) → Ripple overlay

import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { ZoomEngine, type ZoomEngineConfig } from '../../lib/zoom-engine';
import { BackgroundLayer } from './BackgroundLayer';
import { VideoLayer } from './VideoLayer';
import { RippleOverlay } from './RippleOverlay';
import type { InputEvent } from '../../../shared/types';

export interface ZoomCompositionProps {
  videoSrc: string;
  events: InputEvent[];
  meta?: { originX?: number; originY?: number; scaleFactor?: number; captureWidth?: number } | null;
  frameW: number;
  frameH: number;
  zoomFactor: number;
  holdDuration: number;

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

  /** Use OffthreadVideo for export renders */
  useOffthread?: boolean;
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
    useOffthread = false,
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
    };
    return new ZoomEngine(config, events);
  }, [canvasW, canvasH, frameW, frameH, fps, zoomFactor, holdDuration, pad, meta, events]);

  const state = engine.computeFrameState(frame);

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', backgroundColor: '#000' }}>
      {/* Background layer */}
      {withBackground && (
        <BackgroundLayer
          width={width}
          height={height}
          backgroundType={backgroundType}
          backgroundColor={backgroundColor}
          gradientStart={gradientStart}
          gradientEnd={gradientEnd}
          wallpaperFile={wallpaperFile}
          imageBlur={imageBlur}
        />
      )}

      {/* Video layer with zoom/pan transform */}
      <VideoLayer
        videoSrc={videoSrc}
        canvasW={canvasW}
        canvasH={canvasH}
        frameW={frameW}
        frameH={frameH}
        padding={pad}
        cornerRadius={withBackground ? cornerRadius : 0}
        shadowBlur={withBackground ? shadowBlur : 0}
        crop={state.crop}
        useOffthread={useOffthread}
      />

      {/* Click ripple overlay */}
      <RippleOverlay
        width={width}
        height={height}
        ripples={state.activeRipples}
      />
    </div>
  );
};
