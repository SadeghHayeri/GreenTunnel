import type { DnsMode, LogLevel, ProxyStats } from 'green-tunnel';

export type { DnsMode, LogLevel, ProxyStats };

/** Persisted user preferences. Deliberately flat so the UI can bind directly. */
export interface AppSettings {
  /** Turn the tunnel on as soon as the app launches. */
  readonly startOnLaunch: boolean;
  readonly launchAtLogin: boolean;
  /** Let the app point the OS at the proxy while it is running. */
  readonly manageSystemProxy: boolean;
  readonly port: number;
  readonly dnsMode: DnsMode;
  readonly fragmentSize: number;
  readonly tlsRecords: boolean;
  /**
   * How much the engine records into the log panel.
   *
   * Deliberately part of the settings — a user who is chasing a problem wants
   * the level to survive a restart — but *not* part of `affectsEngine`, so
   * turning it up never drops a live connection.
   */
  readonly logLevel: LogLevel;
}

/** One line in the log panel. A `LogRecord` flattened for the wire. */
export interface LogEntry {
  /** Monotonic, per launch. Lets the panel append without re-sending history. */
  readonly seq: number;
  readonly time: number;
  readonly level: Exclude<LogLevel, 'silent'>;
  /** Emitting scope, e.g. `green-tunnel` or `green-tunnel:app`. */
  readonly scope: string;
  readonly message: string;
  /** Present only when the record carried an `Error`. */
  readonly stack?: string;
}

/** Everything the log panel needs to render itself from cold. */
export interface LogSnapshot {
  readonly entries: readonly LogEntry[];
  readonly level: LogLevel;
  /** How many entries are kept before the oldest are dropped. */
  readonly capacity: number;
  /** Entries dropped off the front since launch, so the panel can say so. */
  readonly dropped: number;
}

/**
 * Purely presentational state the window remembers between launches.
 *
 * Deliberately *not* part of `AppSettings`: writing a setting restarts the
 * tunnel, and opening a disclosure triangle must never drop live connections.
 */
export interface UiState {
  readonly advancedOpen: boolean;
}

/**
 * What a fresh install starts from: the advanced panel **closed**, so the window
 * opens as the short column and the disclosure is the user's own first move.
 *
 * It lives here, beside the type, because both sides need it and each used to
 * spell it out separately — `DEFAULT_WINDOW_STATE` in the main process and a
 * bare `false` in the renderer. Two copies of a default is one too many: the
 * renderer's copy is what the page is laid out against for the moment before
 * `getUiState()` resolves, so a disagreement would show as a panel that flickers
 * open, or a window measured against the wrong height on the very first frame.
 *
 * A *default* is all this is. The user's actual choice is persisted in
 * `window-state.json` and restored at boot, so toggling the panel still survives
 * a restart — see `main/settings.ts`.
 */
export const DEFAULT_UI_STATE: UiState = { advancedOpen: false };

/**
 * How the user answered the occasional "star or share" prompt.
 *
 * `star` and `share` both mean *they have already helped*, and both retire the
 * prompt for good — asking again would be the app failing to notice. `later`
 * only costs the current slot; `never` retires it too.
 */
export type AdvocacyAction = 'star' | 'share' | 'later' | 'never';

export type TunnelStatus = 'off' | 'starting' | 'on' | 'stopping' | 'error';

export interface AppState {
  readonly status: TunnelStatus;
  readonly address: { readonly host: string; readonly port: number } | null;
  readonly systemProxyActive: boolean;
  readonly settings: AppSettings;
  readonly stats: ProxyStats;
  readonly error: string | null;
}
