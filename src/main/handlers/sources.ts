// Screen & window source handlers

import { IpcMainInvokeEvent, desktopCapturer, screen } from 'electron';
import type { CaptureSource } from '../../shared/types';

export async function handleGetSources(): Promise<CaptureSource[]> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: true,
    });

    const allDisplays = screen.getAllDisplays();

    return sources
      .filter((src) => {
        const name = src.name?.trim() || '';
        const nameLower = name.toLowerCase();

        // 1. Filter out empty names & common Windows system junk (Program Manager is the desktop)
        if (!name || name === 'Program Manager') return false;

        // 2. Filter out our own app windows & hidden electron wrappers.
        if (
          nameLower.includes('orb') ||
          nameLower.includes('recording-overlay') ||
          nameLower.includes('countdown-window') ||
          nameLower === 'electron'
        ) {
          return false;
        }

        // 3. Filter out system overlays, helpers, and drivers dynamically.
        if (src.id.startsWith('window:')) {
          if (!src.appIcon || src.appIcon.isEmpty()) {
            return false;
          }
        }

        return true;
      })
      .map((src) => {
        const isScreen = src.id.startsWith('screen:');
        const display = allDisplays.find(
          (d) => String(d.id) === String(src.display_id),
        );
        const displayBounds = display ? { ...display.bounds } : null;

        return {
          id: src.id,
          name: src.name,
          thumbnail: src.thumbnail.toDataURL(),
          type: isScreen ? 'screen' as const : 'window' as const,
          displayBounds,
        };
      });
  } catch (err) {
    console.error('[Sources] Failed to get sources:', err);
    return [];
  }
}
