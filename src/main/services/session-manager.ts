// Session manager — creates and manages recording session directories,
// reads/writes meta.json and events.json.

import fs from 'fs';
import path from 'path';
import {
  META_FILE,
  EVENTS_FILE,
  RAW_RECORDING_FILE,
  OUTPUT_FILE,
  CLEAN_MP4_FILE,
  ZOOM_KEYFRAMES_FILE,
} from '../../shared/constants';
import type {
  RecordingMeta,
  RecordingSession,
  RecordingInfo,
  InputEvent,
  ZoomKeyframe,
} from '../../shared/types';

/** Create a new session directory and write initial meta.json. */
export function createSession(
  outputDir: string,
  meta: RecordingMeta,
): RecordingSession {
  const timestamp = Date.now();
  const sessionId = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
  const sessionDir = path.join(outputDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  // Write initial meta
  const metaPath = path.join(sessionDir, META_FILE);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return { startTime: timestamp, sessionDir };
}

/** Save events array to the session directory. */
export function saveEvents(sessionDir: string, events: InputEvent[]): string {
  const eventsPath = path.join(sessionDir, EVENTS_FILE);
  fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2));
  return eventsPath;
}

/** Save raw recording blob to the session directory. */
export function saveRecordingBlob(sessionDir: string, buffer: Buffer): string {
  const filePath = path.join(sessionDir, RAW_RECORDING_FILE);
  fs.writeFileSync(filePath, buffer);
  console.log(
    `[Session] Recording saved: ${filePath} (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`,
  );
  return filePath;
}

/** Read meta.json from a session directory. */
export function readMeta(sessionDir: string): RecordingMeta {
  const metaPath = path.join(sessionDir, META_FILE);
  try {
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    }
  } catch { /* ignore corrupt meta */ }
  return {};
}

/** Update (merge) meta.json in a session directory. */
export function updateMeta(
  sessionDir: string,
  partial: Partial<RecordingMeta>,
): RecordingMeta {
  const meta = { ...readMeta(sessionDir), ...partial };
  const metaPath = path.join(sessionDir, META_FILE);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

/** Save zoom keyframes to the session directory. */
export function saveZoomKeyframes(
  sessionDir: string,
  keyframes: ZoomKeyframe[],
): void {
  const filePath = path.join(sessionDir, ZOOM_KEYFRAMES_FILE);
  fs.writeFileSync(filePath, JSON.stringify(keyframes, null, 2));
}

/** Load zoom keyframes from the session directory. */
export function loadZoomKeyframes(sessionDir: string): ZoomKeyframe[] {
  const filePath = path.join(sessionDir, ZOOM_KEYFRAMES_FILE);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

/** List all recording sessions in the output directory. */
export function listRecordings(outputDir: string): RecordingInfo[] {
  if (!fs.existsSync(outputDir)) return [];

  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  const recordings: RecordingInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sessionDir = path.join(outputDir, entry.name);
    const rawFile = path.join(sessionDir, RAW_RECORDING_FILE);
    const outputFile = path.join(sessionDir, OUTPUT_FILE);

    if (!fs.existsSync(rawFile)) continue;

    const stat = fs.statSync(rawFile);
    const hasOutput = fs.existsSync(outputFile);

    // Read project name from meta.json
    let projectName = entry.name;
    const meta = readMeta(sessionDir);
    if (meta.name) projectName = meta.name;

    recordings.push({
      sessionDir,
      name: projectName,
      timestamp: stat.mtimeMs,
      size: stat.size,
      filePath: rawFile,
      outputPath: hasOutput ? outputFile : null,
      duration: null,
    });
  }

  // Sort newest first
  recordings.sort((a, b) => b.timestamp - a.timestamp);
  return recordings;
}

/** Delete a recording session directory. */
export function deleteSession(sessionDir: string): void {
  if (sessionDir && fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    console.log(`[Session] Deleted: ${sessionDir}`);
  }
}

/** Rename a recording (updates meta.json). */
export function renameSession(sessionDir: string, newName: string): string {
  if (!sessionDir || !newName) throw new Error('Missing sessionDir or name');
  const meta = updateMeta(sessionDir, { name: newName.trim() });
  console.log(`[Session] Renamed: ${sessionDir} → "${meta.name}"`);
  return meta.name!;
}
