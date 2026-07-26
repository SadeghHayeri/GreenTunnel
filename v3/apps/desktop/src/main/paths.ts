import { join } from 'node:path';
import process from 'node:process';
import { app } from 'electron';

/**
 * `resources/` is shipped outside the asar (see electron-builder.yml) so
 * `nativeImage.createFromPath` can find the `@2x` variants sitting beside each
 * icon. Resolve it the same way in dev and in a packaged app.
 */
export const resourcesDir: string = app.isPackaged
  ? join(process.resourcesPath, 'resources')
  : join(import.meta.dirname, '../../resources');

export const rendererDir: string = join(import.meta.dirname, '../renderer');
export const preloadFile: string = join(import.meta.dirname, '../preload/index.cjs');
