// ZoomTimeline.tsx — Visual timeline showing zoom segments.
// Renders as a row of colored blocks overlaid on the timeline track.

import React, { useMemo } from 'react';
import { computeZoomSegments, debounceClicks, splitEvents, type ZoomSegment } from '../lib/zoom-engine';
import type { InputEvent } from '../../shared/types';

interface ZoomTimelineProps {
  events: InputEvent[];
  holdDuration: number;
  videoDuration: number;
}

export function ZoomTimeline({ events, holdDuration, videoDuration }: ZoomTimelineProps) {
  const segments = useMemo(() => {
    if (!events.length || !videoDuration) return [];
    const { clicks } = splitEvents(events);
    const debounced = debounceClicks(clicks, 0.4);
    return computeZoomSegments(debounced, holdDuration);
  }, [events, holdDuration, videoDuration]);

  if (segments.length === 0 || videoDuration <= 0) return null;

  return (
    <div className="absolute inset-0 z-[3] pointer-events-none">
      {segments.map((seg, i) => {
        const leftPct = (seg.startTime / videoDuration) * 100;
        const widthPct = ((seg.endTime - seg.startTime) / videoDuration) * 100;

        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 bg-primary/20 border-x border-primary/30"
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
            }}
            title={`Zoom: ${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s`}
          >
            {/* Click marker */}
            <div
              className="absolute top-0 w-px h-full bg-primary/50"
              style={{
                left: `${((seg.peakTime - seg.startTime) / (seg.endTime - seg.startTime)) * 100}%`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
