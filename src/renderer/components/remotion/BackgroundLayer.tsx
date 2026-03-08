// BackgroundLayer.tsx — Renders the canvas background behind the video.
// Supports solid color, gradient, and image with optional blur.

import React from 'react';

export interface BackgroundLayerProps {
  width: number;
  height: number;
  backgroundType: 'solid' | 'gradient' | 'image';
  backgroundColor?: string;
  gradientStart?: string;
  gradientEnd?: string;
  wallpaperFile?: string;
  imageBlur?: 'none' | 'moderate' | 'strong';
}

export const BackgroundLayer: React.FC<BackgroundLayerProps> = ({
  width,
  height,
  backgroundType,
  backgroundColor = '#1e293b',
  gradientStart = '#667eea',
  gradientEnd = '#764ba2',
  wallpaperFile,
  imageBlur = 'none',
}) => {
  const blurPx = imageBlur === 'moderate' ? 10 : imageBlur === 'strong' ? 24 : 0;

  const style: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width,
    height,
  };

  if (backgroundType === 'solid') {
    return <div style={{ ...style, backgroundColor }} />;
  }

  if (backgroundType === 'gradient') {
    return (
      <div
        style={{
          ...style,
          background: `linear-gradient(135deg, ${gradientStart}, ${gradientEnd})`,
        }}
      />
    );
  }

  if (backgroundType === 'image' && wallpaperFile) {
    // Use relative path — works in Electron's renderer (served from public/)
    const imgSrc = `./Wallpapers/${wallpaperFile}`;
    return (
      <div style={{ ...style, overflow: 'hidden' }}>
        <img
          src={imgSrc}
          style={{
            objectFit: 'cover',
            filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
            position: 'absolute',
            top: blurPx > 0 ? -blurPx : 0,
            left: blurPx > 0 ? -blurPx : 0,
            width: blurPx > 0 ? width + blurPx * 2 : width,
            height: blurPx > 0 ? height + blurPx * 2 : height,
          }}
        />
      </div>
    );
  }

  // Fallback
  return <div style={{ ...style, backgroundColor: '#000' }} />;
};
