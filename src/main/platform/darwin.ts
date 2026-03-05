// macOS platform implementation

import type { PlatformService } from './types';
import type { WindowBounds } from '../../shared/types';

export class DarwinPlatform implements PlatformService {
  readonly name = 'darwin';

  parseWindowId(sourceId: string): string | null {
    // macOS Electron source IDs: "window:CGWindowID:0"
    const match = sourceId.match(/^window:(\d+):/);
    return match ? match[1] : null;
  }

  async getWindowBounds(sourceId: string): Promise<WindowBounds | null> {
    const windowId = this.parseWindowId(sourceId);
    if (!windowId) return null;
    console.warn('[Platform:Darwin] getWindowBounds not yet implemented for CGWindowID');
    return null;
  }

  executableName(baseName: string): string {
    return baseName;
  }

  async checkCapturePermissions(): Promise<boolean> {
    try {
      const { systemPreferences } = require('electron');
      const status = systemPreferences.getMediaAccessStatus('screen');
      return status === 'granted';
    } catch {
      return true;
    }
  }
}
