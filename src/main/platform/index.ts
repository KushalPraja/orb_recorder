// Platform index — auto-selects the correct implementation for the current OS.

import type { PlatformService } from './types';
import { WindowsPlatform } from './windows';
import { DarwinPlatform } from './darwin';
import { LinuxPlatform } from './linux';

function createPlatformService(): PlatformService {
  switch (process.platform) {
    case 'win32':
      return new WindowsPlatform();
    case 'darwin':
      return new DarwinPlatform();
    case 'linux':
      return new LinuxPlatform();
    default:
      console.warn(`[Platform] Unsupported platform: ${process.platform}, using Linux fallback`);
      return new LinuxPlatform();
  }
}

/** Singleton platform service for the current OS. */
export const platform: PlatformService = createPlatformService();

export type { PlatformService } from './types';
