import { join } from 'node:path';
import process from 'node:process';
import { BrowserWindow, app, screen, shell } from 'electron';
import { ALLOWED_EXTERNAL_ORIGINS } from '../shared/ipc.js';
import type { JsonStore } from './json-store.js';
import type { WindowState } from './settings.js';
import { preloadFile, rendererDir } from './paths.js';

const SAVE_DEBOUNCE_MS = 400;

/** The window is a fixed-width column; only its height ever changes. */
const WINDOW_WIDTH = 340;

/**
 * Height of the very first frame. The renderer measures its own content and
 * corrects this before the window is shown, so it only has to be close enough
 * that nothing flashes.
 */
const INITIAL_HEIGHT = 358;

const MIN_CONTENT_HEIGHT = 240;
/** Never grow into the edge of the display; leave a little air below. */
const SCREEN_MARGIN = 24;

const RESIZE_DURATION_MS = 280;
const FRAME_MS = 16;

const resizing = new WeakMap<BrowserWindow, NodeJS.Timeout>();

/**
 * The renderer runs fully locked down: sandboxed, context-isolated, no Node.
 * v2's window used `nodeIntegration: true` with `contextIsolation: false`,
 * which gave any script on the page the full `require()` surface.
 */
export function createMainWindow(state: JsonStore<WindowState>): BrowserWindow {
  const { x, y } = state.value;

  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: INITIAL_HEIGHT,
    // Size the *content*, not the frame, so the renderer's measurement and the
    // number we set are the same quantity on every platform.
    useContentSize: true,
    ...(x !== null && y !== null ? { x, y } : {}),
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    // The design is dark by construction — the whole thing is a green glow on a
    // near-black field — so the window never follows the system theme.
    backgroundColor: '#0d1117',
    title: 'Green Tunnel',
    webPreferences: {
      preload: preloadFile,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  persistPosition(window, state);
  lockDownNavigation(window);

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  void (devServerUrl
    ? window.loadURL(devServerUrl)
    : window.loadFile(join(rendererDir, 'index.html')));

  return window;
}

/**
 * Grow or shrink the window to fit `height` px of content.
 *
 * This is the *only* thing that animates when the advanced panel opens. The
 * panel is the last element on the page and is laid out at full height the
 * moment it is shown, so moving the window's bottom edge is what uncovers it.
 * Animating the panel's own height as well would mean two curves clipping
 * against each other, and the bottom row tears whenever they disagree.
 *
 * Do **not** wrap this in `setResizable(true)` / `setResizable(false)`, the
 * usual advice for resizing a non-resizable window. Measured on macOS 26: the
 * first move lands and every later one is silently dropped, because toggling
 * the style mask leaves the window pinned to the size it had at the time.
 * `setContentSize` alone works fine with `resizable: false`.
 */
export function setContentHeight(window: BrowserWindow, height: number, animate: boolean): void {
  stopResizing(window);

  const [width = WINDOW_WIDTH, current = INITIAL_HEIGHT] = window.getContentSize();
  const target = clampToDisplay(window, Math.round(height));
  if (current === target) return;

  if (!animate) {
    applyHeight(window, width, target);
    return;
  }

  const started = Date.now();
  const timer = setInterval(() => {
    if (window.isDestroyed()) {
      stopResizing(window);
      return;
    }

    const t = Math.min(1, (Date.now() - started) / RESIZE_DURATION_MS);
    // Ease-out, and deliberately no overshoot: a window that bounced past its
    // target would read as a glitch rather than as personality.
    const eased = 1 - (1 - t) ** 3;
    applyHeight(window, width, Math.round(current + (target - current) * eased));

    if (t >= 1) stopResizing(window);
  }, FRAME_MS);

  resizing.set(window, timer);
}

function applyHeight(window: BrowserWindow, width: number, height: number): void {
  window.setContentSize(width, height);
  keepOnScreen(window);
}

/** A window that grows downwards must not push its new content off the display. */
function keepOnScreen(window: BrowserWindow): void {
  const bounds = window.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const lowest = area.y + area.height - bounds.height;
  if (bounds.y > lowest) window.setPosition(bounds.x, Math.max(area.y, lowest));
}

function clampToDisplay(window: BrowserWindow, height: number): number {
  const area = screen.getDisplayMatching(window.getBounds()).workArea;
  return Math.max(MIN_CONTENT_HEIGHT, Math.min(height, area.height - SCREEN_MARGIN));
}

function stopResizing(window: BrowserWindow): void {
  const timer = resizing.get(window);
  if (timer) {
    clearInterval(timer);
    resizing.delete(window);
  }
}

/** Only the position is worth remembering; the height belongs to the content. */
function persistPosition(window: BrowserWindow, state: JsonStore<WindowState>): void {
  let timer: NodeJS.Timeout | undefined;

  const save = (): void => {
    if (window.isDestroyed()) return;
    const bounds = window.getBounds();
    state.set({ x: bounds.x, y: bounds.y });
  };

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  window.on('move', schedule);
  window.on('close', () => {
    clearTimeout(timer);
    save();
  });
}

/**
 * A local-only page has no business navigating anywhere or spawning windows.
 * Outbound links go through the OS browser, and only to origins we allow.
 */
export function lockDownNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
}

export function isAllowedExternalUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return ALLOWED_EXTERNAL_ORIGINS.some((origin) => url.origin === origin);
  } catch {
    return false;
  }
}
