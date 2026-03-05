// Windows platform implementation

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { PlatformService } from './types';
import type { WindowBounds } from '../../shared/types';

/**
 * PowerShell script that uses .NET P/Invoke to call
 * DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS = 9) for accurate
 * visible bounds, falling back to GetWindowRect.
 * Outputs: x,y,width,height  (physical pixels)
 */
const PS_SCRIPT = `
param([int64]$h)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRect {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int L,T,R,B; }
  [DllImport("dwmapi.dll")]
  static extern int DwmGetWindowAttribute(IntPtr hw,int a,out RECT r,int s);
  [DllImport("user32.dll")]
  static extern bool GetWindowRect(IntPtr hw,out RECT r);
  public static string Get(IntPtr hw) {
    RECT r;
    if (DwmGetWindowAttribute(hw,9,out r,Marshal.SizeOf(typeof(RECT)))==0)
      return r.L+","+r.T+","+(r.R-r.L)+","+(r.B-r.T);
    if (GetWindowRect(hw,out r))
      return r.L+","+r.T+","+(r.R-r.L)+","+(r.B-r.T);
    return "";
  }
}
"@
[WinRect]::Get([IntPtr]$h)
`.trim();

let cachedScriptPath: string | null = null;

/** Write the PS script to a temp file once, reuse on subsequent calls. */
function getScriptPath(): string {
  if (cachedScriptPath && fs.existsSync(cachedScriptPath)) return cachedScriptPath;
  const tmp = path.join(os.tmpdir(), 'orb_winrect.ps1');
  fs.writeFileSync(tmp, PS_SCRIPT, 'utf-8');
  cachedScriptPath = tmp;
  return tmp;
}

export class WindowsPlatform implements PlatformService {
  readonly name = 'win32';

  parseWindowId(sourceId: string): string | null {
    // Electron Windows source IDs look like "window:HWND:0"
    const match = sourceId.match(/^window:(\d+):/);
    return match ? match[1] : null;
  }

  async getWindowBounds(sourceId: string): Promise<WindowBounds | null> {
    const hwndStr = this.parseWindowId(sourceId);
    if (!hwndStr) return null;

    try {
      const scriptPath = getScriptPath();
      const output = execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath, '-h', hwndStr,
      ], {
        timeout: 5000,
        encoding: 'utf-8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      if (!output) {
        console.warn('[Platform:Win32] PowerShell returned empty output for HWND', hwndStr);
        return null;
      }

      const parts = output.split(',').map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
      }

      console.warn('[Platform:Win32] Unexpected output:', output);
    } catch (err: any) {
      console.warn('[Platform:Win32] getWindowBounds failed:', err.message);
    }

    return null;
  }

  executableName(baseName: string): string {
    return `${baseName}.exe`;
  }

  async checkCapturePermissions(): Promise<boolean> {
    // Windows doesn't require explicit screen capture permissions
    return true;
  }
}
