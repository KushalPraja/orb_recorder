// RippleOverlay.tsx — SVG overlay for click ripple animations.

import React from 'react';
import type { RippleDrawParams } from '../../lib/zoom-engine';

export interface RippleOverlayProps {
  width: number;
  height: number;
  ripples: RippleDrawParams[];
}

export const RippleOverlay: React.FC<RippleOverlayProps> = ({
  width,
  height,
  ripples,
}) => {
  if (ripples.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      viewBox={`0 0 ${width} ${height}`}
    >
      {ripples.map((r, i) => (
        <g key={i}>
          {/* Outer ring */}
          <circle
            cx={r.dx}
            cy={r.dy}
            r={r.radius}
            fill="none"
            stroke="rgba(255, 130, 180, 1)"
            strokeWidth={r.thickness}
            opacity={r.alpha * 0.65}
          />
          {/* Inner dot */}
          {r.showDot && (
            <circle
              cx={r.dx}
              cy={r.dy}
              r={4}
              fill="rgba(255, 200, 220, 1)"
              opacity={r.dotAlpha}
            />
          )}
        </g>
      ))}
    </svg>
  );
};
