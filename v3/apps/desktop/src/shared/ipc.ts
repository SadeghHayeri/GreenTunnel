import { SHARE_TARGETS } from './share.js';
import type {
  AdvocacyAction,
  AppSettings,
  AppState,
  LogEntry,
  LogLevel,
  LogSnapshot,
  UiState,
} from './types.js';

/**
 * Every channel the renderer may touch, in one place. The preload script
 * exposes exactly these and nothing else — the renderer has no `ipcRenderer`,
 * no `require`, and no Node integration.
 */
export const IPC = {
  getState: 'gt:get-state',
  setEnabled: 'gt:set-enabled',
  updateSettings: 'gt:update-settings',
  getUiState: 'gt:get-ui-state',
  setUiState: 'gt:set-ui-state',
  resizeContent: 'gt:resize-content',
  hideWindow: 'gt:hide-window',
  openExternal: 'gt:open-external',
  quit: 'gt:quit',
  stateChanged: 'gt:state-changed',
  openLogs: 'gt:open-logs',
  logsSnapshot: 'gt:logs-snapshot',
  logsSetLevel: 'gt:logs-set-level',
  logsClear: 'gt:logs-clear',
  logsCopy: 'gt:logs-copy',
  logsSave: 'gt:logs-save',
  logsAppended: 'gt:logs-appended',
  logsCleared: 'gt:logs-cleared',
  closeLogs: 'gt:close-logs',
  advocacyPrompt: 'gt:advocacy-prompt',
  recordAdvocacy: 'gt:record-advocacy',
} as const;

/** The log panel's half of the bridge. Only the logs window uses these. */
export interface LogsApi {
  /** Everything captured so far, plus the level and the ring size. */
  snapshot(): Promise<LogSnapshot>;
  /** Persisted like any other setting; applied live, without a restart. */
  setLevel(level: LogLevel): void;
  clear(): void;
  /**
   * Close the log window.
   *
   * Not `window.close()`: Chromium only lets a script close a window a script
   * opened, so the renderer's own call is silently ignored — which also meant
   * the window never emitted `close` and never saved its bounds.
   */
  close(): void;
  copy(text: string): void;
  /** Ask for a save dialog. Resolves `false` if the user cancelled. */
  save(text: string): Promise<boolean>;
  /** Batched pushes — a flood of trace records must not be one IPC each. */
  onAppend(listener: (entries: readonly LogEntry[]) => void): () => void;
  onCleared(listener: () => void): () => void;
}

/** The surface `window.greenTunnel` exposes to the page. */
export interface GreenTunnelApi {
  getState(): Promise<AppState>;
  setEnabled(enabled: boolean): Promise<AppState>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppState>;
  getUiState(): Promise<UiState>;
  setUiState(patch: Partial<UiState>): void;
  /**
   * Ask for a window exactly `height` px of content tall.
   *
   * The page is a fixed-width column whose last section — the advanced panel —
   * is the only part that changes size, so the window edge *is* the reveal.
   * The renderer measures; the main process animates.
   */
  resizeContent(height: number, animate: boolean): void;
  hideWindow(): void;
  quit(): void;
  openExternal(url: string): void;
  /** Open (or focus) the log window. */
  openLogs(): void;
  logs: LogsApi;
  /**
   * Record how the user answered the "star or share" prompt.
   *
   * The renderer only reports; when to ask next — or never again — is the main
   * process's decision, because it owns the file that outlives the window.
   */
  recordAdvocacy(action: AdvocacyAction): void;
  /** The main process asking this window to show that prompt. */
  onAdvocacyPrompt(listener: () => void): () => void;
  /** Subscribe to pushes from the main process. Returns an unsubscribe fn. */
  onStateChanged(listener: (state: AppState) => void): () => void;
}

/**
 * Links the app may open in the user's browser. Anything else is refused.
 *
 * The share targets are folded in from `share.ts` rather than repeated here, so
 * a target added there cannot silently fail to open.
 */
export const ALLOWED_EXTERNAL_ORIGINS: readonly string[] = [
  'https://github.com',
  ...SHARE_TARGETS.map((target) => target.origin),
];
