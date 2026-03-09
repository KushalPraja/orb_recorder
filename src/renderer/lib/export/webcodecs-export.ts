import {
  ALL_FORMATS,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type StreamTargetChunk,
  type VideoSample,
} from 'mediabunny';
import { CanvasExportComposer } from './canvas-compositor';
import { ElectronFileSource } from './electron-file-source';
import type { ExportProgress, InputEvent, RendererExportRequest } from '../../../shared/types';

function assertExportCapabilities(): void {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    throw new Error('This Electron build does not expose the WebCodecs encoder/decoder APIs required for export.');
  }

  if (typeof WritableStream === 'undefined') {
    throw new Error('WritableStream is unavailable in the export host renderer.');
  }
}

function buildTrimRange(request: RendererExportRequest): { start?: number; end?: number } {
  const trimStart = Number(request.trimStart);
  const trimEnd = Number(request.trimEnd);
  const result: { start?: number; end?: number } = {};

  if (Number.isFinite(trimStart) && trimStart > 0) {
    result.start = trimStart;
  }
  if (Number.isFinite(trimEnd) && trimEnd > 0) {
    result.end = trimEnd;
  }

  return result;
}

function shiftEventsForTrim(
  events: InputEvent[],
  trimStart: number,
  trimEnd: number | undefined,
  zoomDuration: number,
): InputEvent[] {
  const keepFrom = -Math.max(zoomDuration, 1.5) - 1;
  const keepUntil = trimEnd === undefined ? Number.POSITIVE_INFINITY : trimEnd - trimStart + 1;

  return events
    .map((event) => ({ ...event, timestamp: event.timestamp - trimStart }))
    .filter((event) => event.timestamp >= keepFrom && event.timestamp <= keepUntil);
}

async function loadWallpaperBitmap(filePath: string | null): Promise<ImageBitmap | null> {
  if (!filePath) return null;

  const reader = await window.electronAPI.openExportReader(filePath);
  try {
    const buffer = await window.electronAPI.readExportRange(reader.readerId, 0, reader.size);
    const blob = new Blob([buffer]);
    return await createImageBitmap(blob);
  } finally {
    await window.electronAPI.closeExportReader(reader.readerId);
  }
}

function createWriterStream(
  writeChunk: (position: number, data: Uint8Array) => Promise<void>,
  closeWriter: () => Promise<void>,
  abortWriter: () => Promise<void>,
): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    write: async (chunk) => {
      await writeChunk(chunk.position, chunk.data);
    },
    close: async () => {
      await closeWriter();
    },
    abort: async () => {
      await abortWriter();
    },
  });
}

export async function runWebCodecsExport(
  request: RendererExportRequest,
  onProgress?: (progress: ExportProgress) => void,
): Promise<void> {
  assertExportCapabilities();

  const input = new Input({
    formats: ALL_FORMATS,
    source: new ElectronFileSource(request.inputPath),
  });

  let writerId: string | null = null;
  let writerState: 'open' | 'closed' | 'aborted' = 'open';
  let composer: CanvasExportComposer | null = null;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('No video track found in the selected recording.');
    }

    const outputFormat = new Mp4OutputFormat();
    const outputWidth = videoTrack.displayWidth + request.padding * 2 + ((videoTrack.displayWidth + request.padding * 2) % 2);
    const outputHeight = videoTrack.displayHeight + request.padding * 2 + ((videoTrack.displayHeight + request.padding * 2) % 2);
    const videoCodec = await getFirstEncodableVideoCodec(outputFormat.getSupportedVideoCodecs(), {
      width: outputWidth,
      height: outputHeight,
      bitrate: QUALITY_HIGH,
    });

    if (!videoCodec) {
      throw new Error('No MP4-compatible WebCodecs video encoder is available in this Electron runtime.');
    }

    const audioTrack = await input.getPrimaryAudioTrack();
    const audioCodec = audioTrack
      ? await getFirstEncodableAudioCodec(outputFormat.getSupportedAudioCodecs(), {
          numberOfChannels: audioTrack.numberOfChannels,
          sampleRate: audioTrack.sampleRate,
          bitrate: QUALITY_HIGH,
        })
      : null;

    const shouldComposite = request.background || request.autoZoom;
    if (shouldComposite) {
      const shiftedEvents = request.autoZoom
        ? shiftEventsForTrim(
            request.events,
            request.trimStart ?? 0,
            request.trimEnd,
            request.zoomDuration,
          )
        : [];
      const wallpaper = request.backgroundType === 'image'
        ? await loadWallpaperBitmap(request.wallpaperPath)
        : null;

      composer = await CanvasExportComposer.create({
        frameWidth: videoTrack.displayWidth,
        frameHeight: videoTrack.displayHeight,
        events: shiftedEvents,
        meta: request.autoZoom ? request.meta : null,
        request,
        wallpaper,
      });
    }

    writerId = await window.electronAPI.openExportWriter(request.outputPath);
    const writeChunk = async (position: number, data: Uint8Array): Promise<void> => {
      if (writerState !== 'open' || !writerId) return;
      await window.electronAPI.writeExportChunk(writerId, position, data);
    };
    const closeWriter = async (): Promise<void> => {
      if (writerState !== 'open' || !writerId) return;
      writerState = 'closed';
      await window.electronAPI.closeExportWriter(writerId);
    };
    const abortWriter = async (): Promise<void> => {
      if (writerState !== 'open' || !writerId) return;
      writerState = 'aborted';
      await window.electronAPI.abortExportWriter(writerId);
    };
    const output = new Output({
      format: outputFormat,
      target: new StreamTarget(createWriterStream(writeChunk, closeWriter, abortWriter), {
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
      }),
    });

    const activeComposer = composer;
    const videoOptions = activeComposer
      ? () => ({
          frameRate: request.fps,
          bitrate: QUALITY_HIGH,
          hardwareAcceleration: 'prefer-hardware' as const,
          forceTranscode: true,
          process: (sample: VideoSample) => activeComposer.compose(sample),
          processedWidth: activeComposer.outputWidth,
          processedHeight: activeComposer.outputHeight,
        })
      : undefined;

    const conversion = await Conversion.init({
      input,
      output,
      trim: buildTrimRange(request),
      video: videoOptions,
      audio: audioTrack && audioCodec
        ? () => ({
            codec: audioCodec,
            bitrate: QUALITY_HIGH,
          })
        : undefined,
      showWarnings: false,
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((entry) => `${entry.track.type}: ${entry.reason}`);
      throw new Error(
        reasons.length > 0
          ? `Export conversion is not valid (${reasons.join(', ')}).`
          : 'Export conversion is not valid for the selected recording.',
      );
    }

    conversion.onProgress = (value) => {
      onProgress?.({
        percent: Math.max(1, Math.min(99, Math.round(value * 100))),
        phase: 'Rendering export…',
      });
    };

    onProgress?.({ percent: 0, phase: 'Preparing WebCodecs export…' });
    await conversion.execute();
  } catch (error) {
    if (writerId && writerState === 'open') {
      try {
        writerState = 'aborted';
        await window.electronAPI.abortExportWriter(writerId);
      } catch {
        // Best-effort cleanup of partial files.
      }
    }

    throw error;
  } finally {
    composer?.dispose();
    input.dispose();
  }
}
