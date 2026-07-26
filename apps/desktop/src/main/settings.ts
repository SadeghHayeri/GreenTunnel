import { LOG_LEVELS, isLogLevel } from 'green-tunnel';
import { DEFAULT_UI_STATE, type AppSettings, type DnsMode } from '../shared/types.js';
import { JsonStore, asBoolean, asInteger, asOneOf } from './json-store.js';

const DNS_MODES: readonly DnsMode[] = ['doh', 'dot', 'plain'];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  startOnLaunch: true,
  launchAtLogin: false,
  manageSystemProxy: true,
  port: 8000,
  dnsMode: 'doh',
  fragmentSize: 40,
  tlsRecords: false,
  // Enough to see the tunnel come up, the system proxy change hands and
  // anything fail, and quiet enough to leave on forever. `debug` adds a line
  // per connection, which is what you actually want while reproducing a bug.
  logLevel: 'info',
};

/**
 * The settings file is plain JSON in the user's data directory, so treat every
 * field as untrusted and clamp it back into range.
 */
export function normalizeSettings(raw: unknown): AppSettings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  return {
    startOnLaunch: asBoolean(input['startOnLaunch'], DEFAULT_APP_SETTINGS.startOnLaunch),
    launchAtLogin: asBoolean(input['launchAtLogin'], DEFAULT_APP_SETTINGS.launchAtLogin),
    manageSystemProxy: asBoolean(
      input['manageSystemProxy'],
      DEFAULT_APP_SETTINGS.manageSystemProxy,
    ),
    port: asInteger(input['port'], DEFAULT_APP_SETTINGS.port, 0, 65_535),
    dnsMode: asOneOf(input['dnsMode'], DNS_MODES, DEFAULT_APP_SETTINGS.dnsMode),
    fragmentSize: asInteger(input['fragmentSize'], DEFAULT_APP_SETTINGS.fragmentSize, 1, 1400),
    tlsRecords: asBoolean(input['tlsRecords'], DEFAULT_APP_SETTINGS.tlsRecords),
    logLevel: asOneOf(input['logLevel'], LOG_LEVELS, DEFAULT_APP_SETTINGS.logLevel),
  };
}

export function createSettingsStore(): JsonStore<AppSettings> {
  return new JsonStore('settings', normalizeSettings);
}

type SettingsPatch = { -readonly [K in keyof AppSettings]?: AppSettings[K] };

/**
 * Keep only well-typed, known keys from an IPC payload.
 *
 * `normalizeSettings` would already clamp the merged result, but it falls back
 * to the *default* for a bad value — so a renderer sending `port: "oops"` would
 * silently reset the user's port. Dropping unknown keys here keeps the current
 * value instead.
 */
export function pickSettingsPatch(raw: unknown): SettingsPatch {
  if (typeof raw !== 'object' || raw === null) return {};
  const input = raw as Record<string, unknown>;
  const patch: SettingsPatch = {};

  if (typeof input['startOnLaunch'] === 'boolean') patch.startOnLaunch = input['startOnLaunch'];
  if (typeof input['launchAtLogin'] === 'boolean') patch.launchAtLogin = input['launchAtLogin'];
  if (typeof input['manageSystemProxy'] === 'boolean') {
    patch.manageSystemProxy = input['manageSystemProxy'];
  }
  if (typeof input['tlsRecords'] === 'boolean') patch.tlsRecords = input['tlsRecords'];
  if (typeof input['port'] === 'number') patch.port = input['port'];
  if (typeof input['fragmentSize'] === 'number') patch.fragmentSize = input['fragmentSize'];

  const dnsMode = input['dnsMode'];
  if (dnsMode === 'doh' || dnsMode === 'dot' || dnsMode === 'plain') {
    patch.dnsMode = dnsMode;
  }

  const logLevel = input['logLevel'];
  if (typeof logLevel === 'string' && isLogLevel(logLevel)) patch.logLevel = logLevel;

  return patch;
}

/**
 * Where the window sits, and how it was last left.
 *
 * No size here on purpose: the window is a fixed-width column whose height is
 * whatever its content needs, so persisting a height would only let a stale
 * number fight the measurement the renderer makes on every launch.
 */
export interface WindowState {
  readonly x: number | null;
  readonly y: number | null;
  /**
   * Whether the advanced panel was open when the window last closed. Persisted
   * so the user's choice survives a restart; the default it falls back to is
   * `DEFAULT_UI_STATE`, shared with the renderer.
   */
  readonly advancedOpen: boolean;
  /**
   * The log window *is* ordinary and resizable, so its size is worth keeping —
   * the rule above is about the main column, not about every window.
   */
  readonly logsBounds: LogsBounds | null;
}

export interface LogsBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  x: null,
  y: null,
  advancedOpen: DEFAULT_UI_STATE.advancedOpen,
  logsBounds: null,
};

function normalizeWindowState(raw: unknown): WindowState {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const coordinate = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

  return {
    x: coordinate(input['x']),
    y: coordinate(input['y']),
    advancedOpen: asBoolean(input['advancedOpen'], DEFAULT_WINDOW_STATE.advancedOpen),
    logsBounds: normalizeLogsBounds(input['logsBounds']),
  };
}

function normalizeLogsBounds(raw: unknown): LogsBounds | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const number = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

  const x = number(input['x']);
  const y = number(input['y']);
  const width = number(input['width']);
  const height = number(input['height']);
  if (x === null || y === null || width === null || height === null) return null;

  return { x, y, width, height };
}

export function createWindowStateStore(): JsonStore<WindowState> {
  return new JsonStore('window-state', normalizeWindowState);
}
