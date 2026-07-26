import { writeFile } from 'node:fs/promises';
import { isLogLevel } from '@green-tunnel/core';
import { type BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { IPC } from '../shared/ipc.js';
import type {
  AdvocacyAction,
  AppSettings,
  AppState,
  LogEntry,
  LogSnapshot,
  UiState,
} from '../shared/types.js';
import { isAdvocacyAction } from './advocacy.js';
import type { JsonStore } from './json-store.js';
import type { LogBuffer } from './log-buffer.js';
import { pickSettingsPatch, type WindowState } from './settings.js';
import type { TunnelService } from './tunnel-service.js';
import { isAllowedExternalUrl, setContentHeight } from './window.js';

/**
 * Ceiling on a string the renderer asks us to copy or save. A full buffer is
 * around 1 MB; this is only here so a compromised renderer cannot make the main
 * process hold an unbounded one.
 */
const MAX_TEXT_LENGTH = 32 * 1024 * 1024;

export interface IpcDependencies {
  readonly service: TunnelService;
  readonly windowState: JsonStore<WindowState>;
  readonly logs: LogBuffer;
  readonly getWindow: () => BrowserWindow | null;
  readonly getLogsWindow: () => BrowserWindow | null;
  /** Open the log window, or focus it if it is already up. */
  readonly showLogs: () => void;
  /** The shared persist-apply-publish path, also used by the tray. */
  readonly updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  /** Persist how the user answered the "star or share" prompt. */
  readonly recordAdvocacy: (action: AdvocacyAction) => void;
  readonly quit: () => void;
}

/**
 * Every handler validates its input: `ipcMain` payloads come from the renderer
 * process, and a compromised renderer is exactly the threat sandboxing is meant
 * to contain.
 */
export function registerIpcHandlers(deps: IpcDependencies): void {
  const { service, windowState, logs, getWindow } = deps;

  ipcMain.handle(IPC.getState, (): AppState => service.state);

  ipcMain.handle(IPC.setEnabled, async (_event, enabled: unknown): Promise<AppState> => {
    if (typeof enabled !== 'boolean') return service.state;
    await (enabled ? service.enable() : service.disable());
    return service.state;
  });

  ipcMain.handle(IPC.updateSettings, async (_event, patch: unknown): Promise<AppState> => {
    // Validate at the edge — the payload comes from the renderer — then use the
    // same path the tray does, so the two can never drift apart.
    await deps.updateSettings(pickSettingsPatch(patch));
    return service.state;
  });

  ipcMain.handle(IPC.getUiState, (): UiState => ({
    advancedOpen: windowState.value.advancedOpen,
  }));

  ipcMain.on(IPC.setUiState, (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) return;
    const advancedOpen = (patch as Record<string, unknown>)['advancedOpen'];
    if (typeof advancedOpen === 'boolean') windowState.set({ advancedOpen });
  });

  ipcMain.on(IPC.resizeContent, (_event, height: unknown, animate: unknown) => {
    const window = getWindow();
    if (!window || typeof height !== 'number' || !Number.isFinite(height)) return;
    setContentHeight(window, height, animate === true);
  });

  ipcMain.on(IPC.hideWindow, () => {
    getWindow()?.hide();
  });

  ipcMain.on(IPC.quit, () => {
    deps.quit();
  });

  ipcMain.on(IPC.openExternal, (_event, url: unknown) => {
    if (typeof url === 'string' && isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  ipcMain.on(IPC.recordAdvocacy, (_event, action: unknown) => {
    if (isAdvocacyAction(action)) deps.recordAdvocacy(action);
  });

  // ── Logs ───────────────────────────────────────────────────────────────

  ipcMain.on(IPC.openLogs, () => {
    deps.showLogs();
  });

  ipcMain.handle(
    IPC.logsSnapshot,
    (): LogSnapshot => ({
      entries: logs.entries,
      // Read the level off the published state rather than the store, so the
      // panel and the rest of the UI can never disagree about it.
      level: service.state.settings.logLevel,
      capacity: logs.capacity,
      dropped: logs.dropped,
    }),
  );

  ipcMain.on(IPC.logsSetLevel, (_event, level: unknown) => {
    // Same path as every other setting: persisted, then applied live. It is not
    // an engine setting, so this never restarts the tunnel.
    if (typeof level === 'string' && isLogLevel(level)) {
      void deps.updateSettings({ logLevel: level });
    }
  });

  ipcMain.on(IPC.logsClear, () => {
    logs.clear();
  });

  // Chromium refuses a script's `window.close()` on a window it did not open,
  // so Escape has to come back through here — and closing this way is also what
  // makes the window emit `close` and save its bounds.
  ipcMain.on(IPC.closeLogs, () => {
    deps.getLogsWindow()?.close();
  });

  ipcMain.on(IPC.logsCopy, (_event, text: unknown) => {
    if (typeof text === 'string' && text.length <= MAX_TEXT_LENGTH) clipboard.writeText(text);
  });

  ipcMain.handle(IPC.logsSave, async (_event, text: unknown): Promise<boolean> => {
    if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) return false;

    const window = deps.getLogsWindow();
    const options: Electron.SaveDialogOptions = {
      title: 'Save log',
      defaultPath: `green-tunnel-${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: 'Log', extensions: ['log', 'txt'] }],
    };

    try {
      const result = await (window
        ? dialog.showSaveDialog(window, options)
        : dialog.showSaveDialog(options));
      if (result.canceled || result.filePath === '') return false;

      await writeFile(result.filePath, text, 'utf8');
      return true;
    } catch (error) {
      // The dialog is the user's own file picker, so a failure here is a real
      // disk problem — say so rather than failing silently.
      console.error('Could not save the log:', error);
      return false;
    }
  });
}

/** Push a new state to the window, if there is one. */
export function broadcastState(window: BrowserWindow | null, state: AppState): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC.stateChanged, state);
  }
}

/** Ask the window to show the "star or share" prompt. */
export function promptAdvocacy(window: BrowserWindow | null): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC.advocacyPrompt);
  }
}

/** Push a batch of new log lines to the log window, if it is open. */
export function broadcastLogs(window: BrowserWindow | null, entries: readonly LogEntry[]): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC.logsAppended, entries);
  }
}

export function broadcastLogsCleared(window: BrowserWindow | null): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC.logsCleared);
  }
}
