// Linux platform implementation

import type { PlatformService } from './types';
import type { WindowBounds } from '../../shared/types';

export class LinuxPlatform implements PlatformService {
  readonly name = 'linux';

  parseWindowId(sourceId: string): string | null {
    // Linux Electron source IDs vary by display server:
    // X11: "window:0x<hex>:0"  or  "window:<decimal>:0"
    const match = sourceId.match(/^window:(0x[\da-f]+|\d+):/i);
    return match ? match[1] : null;
  }

  async getWindowBounds(sourceId: string): Promise<WindowBounds | null> {
    const windowId = this.parseWindowId(sourceId);
    if (!windowId) return null;

    // Try xdotool (X11) — widely available on X11-based desktops
    try {
      const { execFileSync } = require('child_process');
      // Convert hex to decimal if needed
      const decId = windowId.startsWith('0x')
        ? parseInt(windowId, 16).toString()
        : windowId;

      const output = execFileSync('xdotool', ['getwindowgeometry', '--shell', decId], {
        timeout: 3000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const vars: Record<string, number> = {};
      for (const line of output.split('\n')) {
        const [key, val] = line.split('=');
        if (key && val) vars[key.trim()] = parseInt(val.trim(), 10);
      }

      if (vars.X != null && vars.Y != null && vars.WIDTH && vars.HEIGHT) {
        return {
          x: vars.X,
          y: vars.Y,
          width: vars.WIDTH,
          height: vars.HEIGHT,
        };
      }
    } catch (err: any) {
      console.warn('[Platform:Linux] xdotool failed:', err.message);
    }

    // TODO: Add Wayland support (wlr-foreign-toplevel-management or similar)
    console.warn('[Platform:Linux] getWindowBounds: no method available');
    return null;
  }

  executableName(baseName: string): string {
    return baseName;
  }

  async checkCapturePermissions(): Promise<boolean> {
    // Linux doesn't have a centralized permission system for screen capture
    return true;
  }
}
