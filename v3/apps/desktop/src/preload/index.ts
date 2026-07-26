import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type GreenTunnelApi } from '../shared/ipc.js';
import type {
  AdvocacyAction,
  AppSettings,
  AppState,
  LogEntry,
  LogLevel,
  LogSnapshot,
  UiState,
} from '../shared/types.js';

/**
 * The entire bridge between the sandboxed page and the main process.
 *
 * Nothing here hands the renderer a raw `ipcRenderer` or a channel name it can
 * choose — it gets a fixed set of functions, and that is the whole attack
 * surface. Both pages (the main column and the log window) share it.
 */
// There is deliberately no `platform` here. Reading it in a sandboxed preload
// has no good spelling: a bare `process` is rewritten by Vite into
// `require("node:process")`, which collides with the binding the sandbox
// already injects ("Identifier 'process' has already been declared"), and
// `globalThis.process` is `undefined` because that binding is scoped to the
// preload wrapper rather than to the global object. Either way the preload
// throws *before* `exposeInMainWorld`, leaving `window.greenTunnel` undefined
// and every page dead on its first call. The log window is told its platform in
// its URL instead — by the main process, which is where the fact lives anyway.
const api: GreenTunnelApi = {
  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<AppState>,

  setEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.setEnabled, enabled) as Promise<AppState>,

  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC.updateSettings, patch) as Promise<AppState>,

  getUiState: () => ipcRenderer.invoke(IPC.getUiState) as Promise<UiState>,

  setUiState: (patch: Partial<UiState>) => {
    ipcRenderer.send(IPC.setUiState, patch);
  },

  resizeContent: (height: number, animate: boolean) => {
    ipcRenderer.send(IPC.resizeContent, height, animate);
  },

  hideWindow: () => {
    ipcRenderer.send(IPC.hideWindow);
  },

  quit: () => {
    ipcRenderer.send(IPC.quit);
  },

  openExternal: (url: string) => {
    ipcRenderer.send(IPC.openExternal, url);
  },

  openLogs: () => {
    ipcRenderer.send(IPC.openLogs);
  },

  logs: {
    snapshot: () => ipcRenderer.invoke(IPC.logsSnapshot) as Promise<LogSnapshot>,

    setLevel: (level: LogLevel) => {
      ipcRenderer.send(IPC.logsSetLevel, level);
    },

    clear: () => {
      ipcRenderer.send(IPC.logsClear);
    },

    close: () => {
      ipcRenderer.send(IPC.closeLogs);
    },

    copy: (text: string) => {
      ipcRenderer.send(IPC.logsCopy, text);
    },

    save: (text: string) => ipcRenderer.invoke(IPC.logsSave, text) as Promise<boolean>,

    onAppend: (listener: (entries: readonly LogEntry[]) => void) => {
      const handler = (_event: IpcRendererEvent, entries: readonly LogEntry[]): void => {
        listener(entries);
      };
      ipcRenderer.on(IPC.logsAppended, handler);
      return () => {
        ipcRenderer.off(IPC.logsAppended, handler);
      };
    },

    onCleared: (listener: () => void) => {
      const handler = (): void => {
        listener();
      };
      ipcRenderer.on(IPC.logsCleared, handler);
      return () => {
        ipcRenderer.off(IPC.logsCleared, handler);
      };
    },
  },

  recordAdvocacy: (action: AdvocacyAction) => {
    ipcRenderer.send(IPC.recordAdvocacy, action);
  },

  onAdvocacyPrompt: (listener: () => void) => {
    const handler = (): void => {
      listener();
    };
    ipcRenderer.on(IPC.advocacyPrompt, handler);
    return () => {
      ipcRenderer.off(IPC.advocacyPrompt, handler);
    };
  },

  onStateChanged: (listener: (state: AppState) => void) => {
    const handler = (_event: IpcRendererEvent, state: AppState): void => {
      listener(state);
    };
    ipcRenderer.on(IPC.stateChanged, handler);
    return () => {
      ipcRenderer.off(IPC.stateChanged, handler);
    };
  },
};

contextBridge.exposeInMainWorld('greenTunnel', api);
