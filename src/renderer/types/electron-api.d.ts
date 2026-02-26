import type {
  RecordingInfo,
  CaptureSource,
  ExportOptions,
  ExportProgress,
  AppSettings,
  InputEvent,
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

  // Post-processing
  remuxVideo(sessionDir: string): Promise<string>;
  processVideo(opts: ExportOptions): Promise<void>;
  onProgress(callback: (data: ExportProgress) => void): () => void;
  onProcessingDone(callback: (data: { outputPath: string }) => void): () => void;
  onProcessingError(callback: (data: { error: string }) => void): () => void;

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
