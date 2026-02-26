// Screen & window source handlers

import { IpcMainInvokeEvent, desktopCapturer, screen } from 'electron';
import type { CaptureSource } from '../../shared/types';

export async function handleGetSources(): Promise<CaptureSource[]> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
    });

    const allDisplays = screen.getAllDisplays();

    return sources
      .filter((src) => {
        const name = src.name || '';
        return !name.startsWith('Orb');
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
