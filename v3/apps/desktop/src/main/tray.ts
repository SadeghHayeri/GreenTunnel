import { join } from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';
import type { AppState } from '../shared/types.js';
import { resourcesDir } from './paths.js';

export interface TrayHandlers {
  readonly toggle: () => void;
  readonly showWindow: () => void;
  readonly showLogs: () => void;
  readonly setLaunchAtLogin: (enabled: boolean) => void;
  readonly openSource: () => void;
  readonly quit: () => void;
}

function trayIcon(name: 'on' | 'off'): Electron.NativeImage {
  const image = nativeImage.createFromPath(join(resourcesDir, 'tray', `${name}Template.png`));
  // Template images follow the macOS menu bar between light and dark mode.
  image.setTemplateImage(true);
  return image;
}

export function createTray(handlers: TrayHandlers): Tray {
  const tray = new Tray(trayIcon('off'));
  tray.setToolTip('GreenTunnel');
  tray.on('click', handlers.showWindow);
  tray.on('double-click', handlers.showWindow);
  return tray;
}

/**
 * Rebuild the menu from `state` on every change. Rebuilding is cheap and it is
 * the only way to keep the tray honest — v2 mutated a shared menu-item array
 * and drifted out of sync whenever a start failed.
 */
export function updateTray(tray: Tray, state: AppState, handlers: TrayHandlers): void {
  tray.setImage(trayIcon(state.status === 'on' ? 'on' : 'off'));
  tray.setToolTip(`GreenTunnel — ${describe(state)}`);

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: describe(state), enabled: false },
      { type: 'separator' },
      {
        label: state.status === 'on' ? 'Turn Off' : 'Turn On',
        enabled: state.status !== 'starting' && state.status !== 'stopping',
        click: handlers.toggle,
      },
      { label: 'Show Window', click: handlers.showWindow },
      // Reachable even when the main window is hidden, which is when "it just
      // stopped working" usually gets noticed.
      { label: 'Show Logs', click: handlers.showLogs },
      { type: 'separator' },
      {
        label: 'Launch at Login',
        type: 'checkbox',
        checked: state.settings.launchAtLogin,
        click: (item) => {
          handlers.setLaunchAtLogin(item.checked);
        },
      },
      { type: 'separator' },
      { label: 'Source Code', click: handlers.openSource },
      // No `role: 'quit'` — a role makes Electron ignore `click`, and quitting
      // has to go through our handler so the system proxy gets restored.
      { label: 'Quit GreenTunnel', accelerator: 'CommandOrControl+Q', click: handlers.quit },
    ]),
  );
}

function describe(state: AppState): string {
  switch (state.status) {
    case 'on':
      return state.address
        ? `Running on ${state.address.host}:${String(state.address.port)}`
        : 'Running';
    case 'starting':
      return 'Starting…';
    case 'stopping':
      return 'Stopping…';
    case 'error':
      return state.error ?? 'Error';
    default:
      return 'Off';
  }
}
