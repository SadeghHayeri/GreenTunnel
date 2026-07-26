import process from 'node:process';
import {
  createLogger,
  isSystemProxySupported,
  recoverSystemProxy,
  stderrSink,
  type LogRecord,
} from '@green-tunnel/core';
import { type BrowserWindow, type Tray, app, dialog, shell } from 'electron';
import { PROJECT_URL } from '../shared/share.js';
import type { AppSettings, AppState } from '../shared/types.js';
import {
  createAdvocacyStore,
  isPromptDue,
  markPrompted,
  recordAdvocacyAction,
} from './advocacy.js';
import {
  broadcastLogs,
  broadcastLogsCleared,
  broadcastState,
  promptAdvocacy,
  registerIpcHandlers,
} from './ipc.js';
import { LogBuffer } from './log-buffer.js';
import { createLogsWindow } from './logs-window.js';
import { createSettingsStore, createWindowStateStore } from './settings.js';
import { TunnelService } from './tunnel-service.js';
import { createTray, updateTray, type TrayHandlers } from './tray.js';
import { createMainWindow } from './window.js';

// A second instance would fight the first one over the port and the OS proxy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const settings = createSettingsStore();
const windowState = createWindowStateStore();
const advocacy = createAdvocacyStore();

/**
 * One ring buffer, fed by the engine's logger and read by the log window.
 *
 * It outlives every `Proxy` instance on purpose: an engine setting change
 * restarts the tunnel, and history that vanished with it would lose exactly the
 * lines explaining why the user was changing the setting.
 */
const logs = new LogBuffer();

const logger = createLogger({
  level: settings.value.logLevel,
  sink: (record: LogRecord) => {
    logs.sink(record);
    // A packaged app has nowhere for stderr to go, but `npm run dev` does —
    // and having the same lines in the terminal is worth the tee.
    if (!app.isPackaged) stderrSink(record);
  },
});

const service = new TunnelService(settings.value, logger);

let window: BrowserWindow | null = null;
let logsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const handlers: TrayHandlers = {
  toggle: () => void service.toggle(),
  showWindow: () => {
    showWindow();
  },
  showLogs: () => {
    showLogs();
  },
  setLaunchAtLogin: (enabled) => {
    void updateSettings({ launchAtLogin: enabled });
  },
  openSource: () => void shell.openExternal(PROJECT_URL),
  quit: () => {
    app.quit();
  },
};

function render(state: AppState): void {
  broadcastState(window, state);
  if (tray) updateTray(tray, state, handlers);
}

function showWindow(): void {
  window ??= createMainWindow(windowState);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  maybePromptAdvocacy();
}

/**
 * Let the window settle before asking the user for anything. Landing a sheet on
 * top of the boot animation — and of the resize that follows the renderer's
 * first measurement — would read as a glitch rather than as a question.
 */
const ADVOCACY_DELAY_MS = 2_500;

let advocacyPending = false;

/**
 * Ask for a star or a share, if one of the three slots has come due.
 *
 * Called whenever the window is put on screen, which is the only moment the
 * question makes sense: "if it helped you today" needs the user to actually be
 * here. The slot is spent when the prompt is *shown*, not when it is decided,
 * so a window that gets hidden inside the delay keeps its chance.
 */
function maybePromptAdvocacy(): void {
  if (advocacyPending || !isPromptDue(advocacy.value, Date.now())) return;
  advocacyPending = true;

  setTimeout(() => {
    advocacyPending = false;
    if (!window || window.isDestroyed() || !window.isVisible()) return;

    const now = Date.now();
    if (!isPromptDue(advocacy.value, now)) return;
    markPrompted(advocacy, now);
    promptAdvocacy(window);
  }, ADVOCACY_DELAY_MS);
}

function showLogs(): void {
  if (!logsWindow) {
    logsWindow = createLogsWindow(windowState);
    logsWindow.once('ready-to-show', () => logsWindow?.show());
    logsWindow.on('closed', () => {
      logsWindow = null;
    });
  }

  if (logsWindow.isMinimized()) logsWindow.restore();
  logsWindow.show();
  logsWindow.focus();
}

/**
 * The one path a settings change takes, whichever control made it: persist it,
 * run any side effect it implies, then hand the *merged* value to the service so
 * the `AppState` it publishes matches what is on disk. Tray and window both
 * render from that state, so this is what keeps them agreeing.
 *
 * The tray used to write the store itself and then re-render from
 * `service.state` — which still held the settings object from construction, as
 * `JsonStore.set` returns a new one. Its checkmark snapped straight back and the
 * window was told the old value too.
 */
async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const previous = settings.value;
  const next = settings.set(patch);

  if (next.launchAtLogin !== previous.launchAtLogin) applyLaunchAtLogin(next.launchAtLogin);

  // Publishes at least once, so the tray menu is always rebuilt from the truth
  // even when nothing else about the tunnel changed.
  await service.applySettings(next);
}

function applyLaunchAtLogin(enabled: boolean): void {
  try {
    // Writing the login item needs a signed, installed app on macOS, so skip
    // the call entirely when it would be a no-op — otherwise every dev launch
    // logs a "not permitted" error for nothing.
    if (app.getLoginItemSettings().openAtLogin === enabled) return;
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
  } catch (error) {
    // Unsupported on some Linux desktops; never let it break startup.
    console.error('Could not update the login item:', error);
  }
}

app.on('second-instance', showWindow);

app.on('window-all-closed', () => {
  // The app lives in the tray; closing the window is not quitting.
});

app.on('activate', showWindow);

app.whenReady().then(async () => {
  app.setAppUserModelId('com.greentunnel.desktop');

  service.on('state', render);

  // Batched by `LogBuffer`, and dropped entirely while the window is closed —
  // a trace-level flood must not become one IPC message per line.
  logs.on('append', (entries) => {
    broadcastLogs(logsWindow, entries);
  });
  logs.on('cleared', () => {
    broadcastLogsCleared(logsWindow);
  });

  window = createMainWindow(windowState);
  window.once('ready-to-show', () => {
    window?.show();
    maybePromptAdvocacy();
  });
  window.on('closed', () => {
    window = null;
  });

  tray = createTray(handlers);
  updateTray(tray, service.state, handlers);

  registerIpcHandlers({
    service,
    windowState,
    logs,
    getWindow: () => window,
    getLogsWindow: () => logsWindow,
    showLogs,
    updateSettings,
    recordAdvocacy: (action) => {
      recordAdvocacyAction(advocacy, action);
    },
    quit: () => {
      app.quit();
    },
  });

  applyLaunchAtLogin(settings.value.launchAtLogin);

  // Undo a proxy left behind by a run that never got to clean up — a crash, a
  // force-quit, or a `npm run dev` restart. Must happen before `enable()`, and
  // regardless of `manageSystemProxy`: the leftover exists either way.
  if (isSystemProxySupported()) {
    try {
      await recoverSystemProxy();
    } catch (error) {
      console.error('Could not undo a leftover system proxy:', error);
    }
  }

  if (settings.value.startOnLaunch) {
    await service.enable();
  }
}, reportFatal);

/** Teardown runs OS commands; never let a wedged one block quit forever. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Quitting must not race the teardown: hold the quit, restore the OS proxy,
 * then let it through. v2 could exit with the machine still pointed at a port
 * that no longer existed, which looks exactly like "the internet is broken".
 */
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();

  const exit = (): void => {
    app.exit(0);
  };
  const timer = setTimeout(() => {
    console.error(`Shutdown timed out after ${String(SHUTDOWN_TIMEOUT_MS)}ms; exiting anyway.`);
    exit();
  }, SHUTDOWN_TIMEOUT_MS);

  void service
    .shutdown()
    .catch((error: unknown) => {
      console.error('Shutdown failed:', error);
    })
    .finally(() => {
      clearTimeout(timer);
      exit();
    });
});

/**
 * Electron does **not** turn a signal into `before-quit` — it just dies. So
 * `npm run dev` (which signals the child on reload and on Ctrl-C), `kill`, and a
 * logout that escalates past the graceful phase all skipped teardown entirely
 * and left the machine pointed at a dead port. Route them through `app.quit()`
 * so they get the same restore as the tray's Quit item.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    app.quit();
  });
}

function reportFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('GreenTunnel failed to start:', error);
  dialog.showErrorBox('GreenTunnel failed to start', message);
  app.exit(1);
}
