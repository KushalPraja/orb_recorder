// segments.ts — Compute zoom segments for timeline visualization.

import type { ClickEvent } from '../../../shared/types';

export interface ZoomSegment {
  startTime: number;
  endTime: number;
  peakTime: number;
  clickX: number;
  clickY: number;
}

/**
 * Convert debounced clicks into zoom segments for the timeline.
 * Each click creates a zoom-in window of `holdDuration` seconds.
 * Overlapping segments are merged.
 */
export function computeZoomSegments(
  clicks: ClickEvent[],
  holdDuration: number,
): ZoomSegment[] {
  if (clicks.length === 0) return [];

  const raw: ZoomSegment[] = clicks.map((c) => ({
    startTime: c.timestamp,
    endTime: c.timestamp + holdDuration,
    peakTime: c.timestamp,
    clickX: c.x,
    clickY: c.y,
  }));

  // Merge overlapping segments
  const merged: ZoomSegment[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = raw[i];
    if (curr.startTime <= prev.endTime) {
      // Extend the previous segment
      prev.endTime = Math.max(prev.endTime, curr.endTime);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}
