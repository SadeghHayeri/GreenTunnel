import { join } from 'node:path';
import process from 'node:process';
import { BrowserWindow, app, screen } from 'electron';
import type { JsonStore } from './json-store.js';
import { preloadFile, rendererDir } from './paths.js';
import type { LogsBounds, WindowState } from './settings.js';
import { lockDownNavigation } from './window.js';

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 460;
const MIN_HEIGHT = 260;
const SAVE_DEBOUNCE_MS = 400;

/**
 * The log window, unlike the main column, is an ordinary resizable window: it
 * shows a table the user will want wider, and its size *is* worth remembering.
 * Nothing here talks to the engine — it renders whatever `LogBuffer` hands it.
 */
export function createLogsWindow(state: JsonStore<WindowState>): BrowserWindow {
  const saved = state.value.logsBounds;

  const window = new BrowserWindow({
    width: saved?.width ?? DEFAULT_WIDTH,
    height: saved?.height ?? DEFAULT_HEIGHT,
    // Keep the size but drop a position that no longer lands on a display — an
    // external monitor that is gone would open the window out of sight.
    ...(saved && onScreen(saved) ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // macOS keeps its traffic lights and its resize edges; the toolbar row in
    // the page reserves room for them. Everywhere else a normal frame is less
    // surprising than a frameless window with no way to move it.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 13, y: 14 } }
      : {}),
    backgroundColor: '#0d1117',
    title: 'Green Tunnel — Logs',
    webPreferences: {
      preload: preloadFile,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  persistBounds(window, state);
  lockDownNavigation(window);

  // The page needs to know whether it is wearing the macOS traffic lights, and
  // the answer is made right here. It cannot come through the preload: reading
  // `process` in a sandboxed one has no working spelling (see preload/index.ts).
  const query = { platform: process.platform };

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  void (devServerUrl
    ? window.loadURL(`${devServerUrl}/logs.html?platform=${process.platform}`)
    : window.loadFile(join(rendererDir, 'logs.html'), { query }));

  return window;
}

/** Whether the middle of these bounds still falls inside some display. */
function onScreen(bounds: LogsBounds): boolean {
  const centre = {
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2),
  };
  const area = screen.getDisplayNearestPoint(centre).workArea;

  return (
    centre.x >= area.x &&
    centre.x <= area.x + area.width &&
    centre.y >= area.y &&
    centre.y <= area.y + area.height
  );
}

function persistBounds(window: BrowserWindow, state: JsonStore<WindowState>): void {
  let timer: NodeJS.Timeout | undefined;

  const save = (): void => {
    if (window.isDestroyed() || window.isMinimized()) return;
    const { x, y, width, height } = window.getBounds();
    state.set({ logsBounds: { x, y, width, height } });
  };

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  window.on('move', schedule);
  window.on('resize', schedule);
  window.on('close', () => {
    clearTimeout(timer);
    save();
  });
}
