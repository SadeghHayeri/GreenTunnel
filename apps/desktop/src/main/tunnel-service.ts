import { EventEmitter } from 'node:events';
import {
  DEFAULT_BYPASS,
  Proxy,
  SystemProxy,
  isSystemProxySupported,
  toError,
  type Logger,
  type ProxyOptions,
  type ProxyStats,
} from '@green-tunnel/core';
import type { AppSettings, AppState, TunnelStatus } from '../shared/types.js';

const IDLE_STATS: ProxyStats = {
  activeTunnels: 0,
  totalTunnels: 0,
  failedTunnels: 0,
  bytesSent: 0,
  bytesReceived: 0,
  startedAt: null,
};

const STATS_INTERVAL_MS = 1000;

interface TunnelServiceEvents {
  state: [AppState];
}

/**
 * Owns the engine and the OS proxy for the lifetime of the app, and publishes a
 * single immutable `AppState` that the tray and the window both render from.
 *
 * v2's GUI kept `isOn`, the proxy instance and the tray label in three separate
 * places and hand-synced them; anything that failed mid-flight left them
 * disagreeing.
 */
export class TunnelService extends EventEmitter<TunnelServiceEvents> {
  /** The engine's logger; everything it emits ends up in the log panel. */
  readonly #logger: Logger;
  /** The same family, scoped so app-level lines are distinguishable there. */
  readonly #log: Logger;

  #settings: AppSettings;
  #proxy: Proxy | null = null;
  #system: SystemProxy | null = null;
  #status: TunnelStatus = 'off';
  #error: string | null = null;
  #stats: ProxyStats = IDLE_STATS;
  #ticker: NodeJS.Timeout | null = null;

  constructor(settings: AppSettings, logger: Logger) {
    super();
    this.#settings = settings;
    this.#logger = logger;
    this.#log = logger.child('app');
    this.#logger.setLevel(settings.logLevel);
  }

  get state(): AppState {
    return {
      status: this.#status,
      address: this.#proxy?.address ?? null,
      systemProxyActive: this.#system?.active ?? false,
      settings: this.#settings,
      stats: this.#stats,
      error: this.#error,
    };
  }

  get running(): boolean {
    return this.#status === 'on';
  }

  async enable(): Promise<void> {
    if (this.#proxy) return;

    this.#status = 'starting';
    this.#error = null;
    this.#publish();

    try {
      const proxy = new Proxy(toProxyOptions(this.#settings), { logger: this.#logger });
      proxy.on('error', (error) => {
        this.#logger.error(error.message, error);
      });

      // Per-connection detail lives at `debug`, which is what the log panel is
      // for: at `info` the panel stays a handful of lines a session, and one
      // click makes it a live trace of every host the browser reaches for.
      proxy.on('tunnel:open', (tunnel) => {
        this.#log.debug(`#${String(tunnel.id)} open ${tunnel.kind} ${authority(tunnel)}`);
      });
      proxy.on('tunnel:close', (tunnel) => {
        const traffic = `↑${formatBytes(tunnel.bytesSent)} ↓${formatBytes(tunnel.bytesReceived)}`;
        const seconds = ((Date.now() - tunnel.startedAt) / 1000).toFixed(1);
        this.#log.debug(`#${String(tunnel.id)} close ${authority(tunnel)} ${traffic} ${seconds}s`);
      });
      proxy.on('tunnel:error', (tunnel, error) => {
        this.#log.warn(`#${String(tunnel.id)} failed ${authority(tunnel)} — ${error.message}`);
      });

      const address = await proxy.start();
      this.#proxy = proxy;

      if (this.#settings.manageSystemProxy && isSystemProxySupported()) {
        const system = new SystemProxy();
        await system.enable({ host: address.host, port: address.port, bypass: DEFAULT_BYPASS });
        this.#system = system;
        this.#log.info(`system proxy pointed at ${address.host}:${String(address.port)}`);
      }

      this.#stats = proxy.stats;
      this.#startTicker();
      this.#status = 'on';
    } catch (error) {
      const failure = toError(error);
      this.#error = failure.message;
      this.#log.error(`could not start: ${failure.message}`, failure);
      await this.#teardown();
      this.#status = 'error';
    }

    this.#publish();
  }

  async disable(): Promise<void> {
    if (!this.#proxy && !this.#system) {
      this.#status = 'off';
      this.#publish();
      return;
    }

    this.#status = 'stopping';
    this.#publish();

    await this.#teardown();
    this.#error = null;
    this.#status = 'off';
    this.#publish();
  }

  async toggle(): Promise<void> {
    await (this.running ? this.disable() : this.enable());
  }

  /**
   * Apply new settings, restarting the tunnel in place if it is running *and*
   * something the engine actually reads has changed. "Launch at login" must not
   * drop every live connection.
   */
  async applySettings(settings: AppSettings): Promise<void> {
    const previous = this.#settings;
    this.#settings = settings;

    if (settings.logLevel !== previous.logLevel) {
      // Live, on the shared logger state — no restart, and children (`#log`)
      // follow. Announce it *after* the change so raising the level is visible
      // in the panel that just asked for it.
      this.#logger.setLevel(settings.logLevel);
      this.#log.info(`log level is now ${settings.logLevel}`);
    }

    if (!this.running || !affectsEngine(previous, settings)) {
      this.#publish();
      return;
    }

    this.#log.info('settings changed; restarting the tunnel');
    await this.disable();
    await this.enable();
  }

  /** Restore the OS proxy and close everything. Safe to call more than once. */
  async shutdown(): Promise<void> {
    await this.#teardown();
    this.#status = 'off';
  }

  async #teardown(): Promise<void> {
    this.#stopTicker();

    // Order matters: put the OS back before the port disappears.
    const system = this.#system;
    this.#system = null;
    if (system) {
      await system
        .disable()
        .then(() => {
          this.#log.info('system proxy restored');
        })
        .catch((error: unknown) => {
          this.#logger.error(`could not restore system proxy: ${toError(error).message}`);
        });
    }

    const proxy = this.#proxy;
    this.#proxy = null;
    if (proxy) await proxy.stop();

    this.#stats = IDLE_STATS;
  }

  #startTicker(): void {
    this.#stopTicker();
    this.#ticker = setInterval(() => {
      if (!this.#proxy) return;
      this.#stats = this.#proxy.stats;
      this.#publish();
    }, STATS_INTERVAL_MS);
    // Never keep the process alive just to tick.
    this.#ticker.unref();
  }

  #stopTicker(): void {
    if (this.#ticker) clearInterval(this.#ticker);
    this.#ticker = null;
  }

  #publish(): void {
    this.emit('state', this.state);
  }
}

/**
 * The subset of the settings a running tunnel is built from. Everything else —
 * `startOnLaunch`, `launchAtLogin` — is read somewhere other than here.
 */
function affectsEngine(a: AppSettings, b: AppSettings): boolean {
  return (
    a.port !== b.port ||
    a.dnsMode !== b.dnsMode ||
    a.fragmentSize !== b.fragmentSize ||
    a.tlsRecords !== b.tlsRecords ||
    a.manageSystemProxy !== b.manageSystemProxy
  );
}

function authority(tunnel: { host: string; port: number }): string {
  return `${tunnel.host}:${String(tunnel.port)}`;
}

/** Short, for a log line — `1.4 MB`, not `1468006 bytes`. */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)}${units[unit] ?? 'B'}`;
}

function toProxyOptions(settings: AppSettings): ProxyOptions {
  return {
    port: settings.port,
    fragment: {
      enabled: true,
      size: settings.fragmentSize,
      tlsRecords: settings.tlsRecords,
    },
    dns: { mode: settings.dnsMode },
  };
}
