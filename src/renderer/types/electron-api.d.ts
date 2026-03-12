import type {
  RecordingInfo,
  CaptureSource,
  ExportOptions,
  ExportProgress,
  ExportFileReaderHandle,
  AppSettings,
  InputEvent,
  LoadedEvents,
  RendererExportRequest,
} from '../../shared/types';

export interface ElectronAPI {
  // Recording lifecycle
  startRecording(): Promise<{ sessionDir: string; startTime: number }>;
  stopRecording(videoStartTime?: number): Promise<{
    sessionDir: string;
    eventCount: number;
    events: InputEvent[];
  }>;
  setCaptureSource(sourceId: string): Promise<boolean>;
  prepareRecordingUi(): Promise<boolean>;
  finishRecordingUi(): Promise<boolean>;
  saveRecording(buffer: ArrayBuffer): Promise<string>;

  onOverlayStopRequest(callback: () => void): () => void;
  onOverlayPauseRequest(callback: () => void): () => void;
  onOverlayResumeRequest(callback: () => void): () => void;
  onOverlayDiscardRequest(callback: () => void): () => void;

  // Library
  getRecordings(): Promise<RecordingInfo[]>;
  deleteRecording(sessionDir: string): Promise<void>;
  renameRecording(sessionDir: string, newName: string): Promise<string>;

  // Sources
  getSources(): Promise<CaptureSource[]>;

  // Events loading
  loadEvents(sessionDir: string): Promise<LoadedEvents>;

  // Post-processing
  remuxVideo(sessionDir: string): Promise<string>;
  processVideo(opts: ExportOptions): Promise<void>;
  onProgress(callback: (data: ExportProgress) => void): () => void;
  onProcessingDone(callback: (data: { outputPath: string }) => void): () => void;
  onProcessingError(callback: (data: { error: string }) => void): () => void;

  onExportJob(callback: (job: RendererExportRequest) => void): () => void;
  notifyExportHostReady(): void;
  notifyExportHostProgress(data: { jobId: string; progress: ExportProgress }): void;
  notifyExportHostDone(data: { jobId: string; outputPath: string }): void;
  notifyExportHostError(data: { jobId: string; error: string }): void;

  openExportReader(filePath: string): Promise<ExportFileReaderHandle>;
  readExportRange(readerId: string, start: number, end: number): Promise<ArrayBuffer>;
  closeExportReader(readerId: string): Promise<void>;
  openExportWriter(filePath: string): Promise<string>;
  writeExportChunk(writerId: string, position: number, data: Uint8Array | ArrayBuffer): Promise<void>;
  closeExportWriter(writerId: string): Promise<void>;
  abortExportWriter(writerId: string): Promise<void>;

  // Settings
  getSettings(): Promise<AppSettings>;
  setSettings(settings: Partial<AppSettings>): Promise<void>;

  // Dialogs & shell
  pickOutputDir(): Promise<string | null>;
  pickExportPath(defaultName: string): Promise<string | null>;
  openOutput(filePath: string): Promise<void>;
  openSettings(): Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
