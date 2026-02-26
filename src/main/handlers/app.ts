// App & Window handlers

import { IpcMainInvokeEvent } from 'electron';
import { getMainWindow } from '../windows/main-window';

export async function handleGetPlatform(): Promise<string> {
  return process.platform;
}

export function minimizeWindow(): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.minimize();
}

export function maximizeWindow(): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
}

export function closeWindow(): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.close();
}

export async function handleIsMaximized(): Promise<boolean> {
  const win = getMainWindow();
  return win ? win.isMaximized() : false;
}
