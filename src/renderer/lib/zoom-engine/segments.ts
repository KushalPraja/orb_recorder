// segments.ts — Compute zoom segments for timeline and camera scheduling.
//
// Two-click activation: zoom only triggers when 2+ clicks land within a
// CLUSTER_WINDOW. Once active, zoom stays as long as clicks keep coming.
// Single isolated clicks are ignored — prevents overwhelming zoom cycling
// and motion sickness.

import type { ClickEvent } from '../../../shared/types';

export interface ZoomSegment {
  startTime: number;
  endTime: number;
  peakTime: number;
  clickX: number;
  clickY: number;
}

/** Two clicks must land within this window to trigger a zoom session. */
const CLUSTER_WINDOW = 3.0;

/**
 * Group clicks into clusters where each click is within CLUSTER_WINDOW
 * of the previous one. Only clusters with 2+ clicks become zoom segments.
 * This avoids zooming on isolated single clicks.
 */
export function computeZoomSegments(
  clicks: ClickEvent[],
  holdDuration: number,
): ZoomSegment[] {
  if (clicks.length < 2) return [];

  const sorted = [...clicks].sort((a, b) => a.timestamp - b.timestamp);

  // Step 1: Group clicks into clusters (each click within CLUSTER_WINDOW of the previous)
  const clusters: ClickEvent[][] = [];
  let current: ClickEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timestamp - current[current.length - 1].timestamp <= CLUSTER_WINDOW) {
      current.push(sorted[i]);
    } else {
      clusters.push(current);
      current = [sorted[i]];
    }
  }
  clusters.push(current);

  // Step 2: Only clusters with 2+ clicks become zoom segments
  const segments: ZoomSegment[] = [];
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;

    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    segments.push({
      startTime: first.timestamp,
      endTime: last.timestamp + holdDuration,
      peakTime: first.timestamp,
      clickX: first.x,
      clickY: first.y,
    });
  }

  return segments;
}
