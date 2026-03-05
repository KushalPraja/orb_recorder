// Path resolver — consistent resolution of project paths regardless of
// whether the code runs from source (dev) or compiled output (prod).
//
// Uses app.getAppPath() as the anchor — this returns the project root
// in dev and the app directory in packaged builds.

import path from 'path';

/** Get the project/app root directory. */
export function getAppRoot(): string {
  const { app } = require('electron');
  return app.getAppPath();
}

/** Whether the app is running inside an asar archive. */
export function isPackaged(): boolean {
  const { app } = require('electron');
  return app.isPackaged;
}

/**
 * Resolve a path relative to the project root.
 * Works the same in dev, compiled, and packaged builds.
 */
export function fromRoot(...segments: string[]): string {
  return path.join(getAppRoot(), ...segments);
}

/**
 * Resolve a path in the bin/ directory.
 * In packaged builds, binaries are in the extraResource path.
 */
export function fromBin(filename: string): string {
  if (isPackaged()) {
    return path.join(process.resourcesPath!, 'bin', filename);
  }
  return fromRoot('bin', filename);
}

/**
 * Resolve a path to a source file (for loading HTML, etc).
 * In packaged builds, source files are at the app root.
 * In dev, they're under src/.
 */
export function fromSource(...segments: string[]): string {
  return fromRoot(...segments);
}
