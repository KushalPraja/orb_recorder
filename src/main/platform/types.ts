// Platform service interface — abstracts all OS-specific operations so
// handler code never needs `process.platform === 'win32'` checks.

import type { WindowBounds } from '../../shared/types';

export interface PlatformService {
  /** Human-readable platform name */
  readonly name: string;

  /**
   * Get the bounding rectangle of a native window from its Electron source ID.
   * Returns physical screen-pixel coordinates, or null if unavailable.
   */
  getWindowBounds(sourceId: string): Promise<WindowBounds | null>;

  /**
   * Extract the native window identifier (e.g., HWND on Windows) from an
   * Electron desktopCapturer source ID like "window:12345:0".
   * Returns null if the source ID doesn't contain a valid identifier.
   */
  parseWindowId(sourceId: string): string | null;

  /**
   * Platform-appropriate executable filename for a given binary name.
   * e.g. "ffmpeg" → "ffmpeg.exe" on Windows, "ffmpeg" on Unix.
   */
  executableName(baseName: string): string;

  /**
   * Check whether the app has the required capture permissions.
   * On macOS this checks Screen Recording permission; on other platforms
   * it always returns true.
   */
  checkCapturePermissions(): Promise<boolean>;
}
