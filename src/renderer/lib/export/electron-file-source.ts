import { Source } from 'mediabunny';
import type { ExportFileReaderHandle } from '../../../shared/types';

interface CachedBlock {
  start: number;
  end: number;
  bytes: Uint8Array;
}

interface SourceReadResult {
  bytes: Uint8Array;
  view: DataView;
  offset: number;
}

const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024;
const MAX_CACHE_BLOCKS = 6;

export class ElectronFileSource extends Source {
  private readonly filePath: string;
  private readonly blockSize: number;
  private readerPromise: Promise<ExportFileReaderHandle> | null = null;
  private readerInfo: ExportFileReaderHandle | null = null;
  private readonly cache = new Map<number, CachedBlock>();

  constructor(filePath: string, blockSize = DEFAULT_BLOCK_SIZE) {
    super();
    this.filePath = filePath;
    this.blockSize = blockSize;
  }

  private async ensureReader(): Promise<ExportFileReaderHandle> {
    if (this.readerInfo) return this.readerInfo;

    this.readerPromise ??= window.electronAPI.openExportReader(this.filePath);
    this.readerInfo = await this.readerPromise;
    return this.readerInfo;
  }

  private getCachedBlock(start: number, end: number): CachedBlock | null {
    for (const block of this.cache.values()) {
      if (block.start <= start && block.end >= end) {
        this.cache.delete(block.start);
        this.cache.set(block.start, block);
        return block;
      }
    }

    return null;
  }

  private storeBlock(block: CachedBlock): void {
    this.cache.delete(block.start);
    this.cache.set(block.start, block);

    while (this.cache.size > MAX_CACHE_BLOCKS) {
      const oldestKey = this.cache.keys().next().value as number | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  async _retrieveSize(): Promise<number> {
    const info = await this.ensureReader();
    return info.size;
  }

  async _read(start: number, end: number): Promise<SourceReadResult | null> {
    const info = await this.ensureReader();
    const safeStart = Math.max(0, Math.floor(start));
    const safeEnd = Math.min(info.size, Math.max(safeStart, Math.floor(end)));

    if (safeStart >= info.size) {
      return null;
    }

    const cached = this.getCachedBlock(safeStart, safeEnd);
    if (cached) {
      this.onread?.(cached.start, cached.end);
      return {
        bytes: cached.bytes,
        view: new DataView(cached.bytes.buffer, cached.bytes.byteOffset, cached.bytes.byteLength),
        offset: cached.start,
      };
    }

    const alignedStart = Math.floor(safeStart / this.blockSize) * this.blockSize;
    const requestedLength = Math.max(safeEnd - alignedStart, this.blockSize);
    const alignedLength = Math.ceil(requestedLength / this.blockSize) * this.blockSize;
    const alignedEnd = Math.min(info.size, alignedStart + alignedLength);

    const buffer = await window.electronAPI.readExportRange(info.readerId, alignedStart, alignedEnd);
    const bytes = new Uint8Array(buffer);
    const block: CachedBlock = {
      start: alignedStart,
      end: alignedStart + bytes.byteLength,
      bytes,
    };

    this.storeBlock(block);
    this.onread?.(block.start, block.end);

    return {
      bytes: block.bytes,
      view: new DataView(block.bytes.buffer, block.bytes.byteOffset, block.bytes.byteLength),
      offset: block.start,
    };
  }

  _dispose(): void {
    const readerId = this.readerInfo?.readerId;
    this.cache.clear();
    this.readerInfo = null;
    this.readerPromise = null;

    if (readerId) {
      void window.electronAPI.closeExportReader(readerId).catch((error) => {
        console.warn('[Export] Failed to close export reader:', error);
      });
    }
  }
}
