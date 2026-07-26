import { EventEmitter } from 'node:events';
import net from 'node:net';
import { assertValidSettings, resolveSettings } from '../config.js';
import { createDnsResolver, type DnsResolver } from '../dns/index.js';
import { GreenTunnelError, toError } from '../errors.js';
import { Logger } from '../logger.js';
import { destroyAll } from '../net/socket.js';
import type {
  ProxyAddress,
  ProxyEventMap,
  ProxyOptions,
  ProxySettings,
  ProxyStats,
  TunnelInfo,
} from '../types.js';
import { handleConnection } from './connection.js';
import type { TunnelContext } from './context.js';

export interface ProxyDependencies {
  readonly logger?: Logger;
  /** Override the resolver, mainly for tests. */
  readonly dns?: DnsResolver;
}

/**
 * The DPI-evading proxy server.
 *
 * Unlike v2 this class does **not** touch the OS proxy configuration — that is
 * `SystemProxy`'s job. Keeping them apart means the engine is testable without
 * root, and a crash can't leave the machine pointed at a dead port.
 *
 * Emits `error` in the Node convention: attach a listener or an emitted error
 * will throw.
 */
export class Proxy extends EventEmitter<ProxyEventMap> {
  readonly settings: ProxySettings;

  readonly #logger: Logger;
  readonly #dns: DnsResolver;
  readonly #sockets = new Set<net.Socket>();

  #server: net.Server | null = null;
  #abort: AbortController | null = null;
  #startedAt: number | null = null;
  #nextTunnelId = 1;
  #totalTunnels = 0;
  #failedTunnels = 0;
  #bytesSent = 0;
  #bytesReceived = 0;

  constructor(options: ProxyOptions = {}, dependencies: ProxyDependencies = {}) {
    super();
    this.settings = resolveSettings(options);
    assertValidSettings(this.settings);
    this.#logger = dependencies.logger ?? new Logger('green-tunnel');
    this.#dns = dependencies.dns ?? createDnsResolver(this.settings.dns);
  }

  get running(): boolean {
    return this.#server !== null;
  }

  /** The bound address, or `null` while stopped. */
  get address(): ProxyAddress | null {
    const address = this.#server?.address();
    if (address === null || address === undefined || typeof address === 'string') return null;
    return { host: address.address, port: address.port };
  }

  get stats(): ProxyStats {
    return {
      activeTunnels: this.#sockets.size,
      totalTunnels: this.#totalTunnels,
      failedTunnels: this.#failedTunnels,
      bytesSent: this.#bytesSent,
      bytesReceived: this.#bytesReceived,
      startedAt: this.#startedAt,
    };
  }

  /** Idempotent: starting an already-running proxy returns its address. */
  async start(): Promise<ProxyAddress> {
    const current = this.address;
    if (current) return current;

    const abort = new AbortController();
    const server = net.createServer({ pauseOnConnect: true, noDelay: true });

    server.on('connection', (socket) => {
      void this.#onConnection(socket, abort.signal);
    });
    server.on('error', (error) => {
      this.emit('error', toError(error));
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        reject(toError(error));
      };
      server.once('error', onError);
      server.listen({ host: this.settings.host, port: this.settings.port }, () => {
        server.off('error', onError);
        resolve();
      });
    });

    // Read the address off the server directly rather than via `this.address`:
    // the early-return above narrowed that getter to `null` for the rest of the
    // function, and TypeScript has no way to know `#server` changed underneath.
    const bound = server.address();
    if (bound === null || typeof bound === 'string') {
      server.close();
      throw new GreenTunnelError('Proxy started but reported no address');
    }
    const address: ProxyAddress = { host: bound.address, port: bound.port };

    this.#server = server;
    this.#abort = abort;
    this.#startedAt = Date.now();

    this.#logger.info(`listening on ${address.host}:${String(address.port)}`);
    this.emit('listening', address);
    return address;
  }

  /** Idempotent. Tears down every live tunnel, then the listener. */
  async stop(): Promise<void> {
    const server = this.#server;
    if (!server) return;

    this.#server = null;
    this.#abort?.abort();
    this.#abort = null;
    this.#startedAt = null;

    destroyAll(...this.#sockets);
    this.#sockets.clear();

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    this.#dns.close();
    this.#logger.info('stopped');
    this.emit('close');
  }

  async #onConnection(client: net.Socket, signal: AbortSignal): Promise<void> {
    this.#sockets.add(client);
    // A socket that errors with no listener would take the process down.
    client.on('error', () => undefined);
    client.once('close', () => this.#sockets.delete(client));

    let info: TunnelInfo | undefined;

    const context: TunnelContext = {
      settings: this.settings,
      dns: this.#dns,
      logger: this.#logger,
      signal,
      nextTunnelId: () => this.#nextTunnelId++,
      onOpen: (tunnel) => {
        info = tunnel;
        this.#totalTunnels++;
        this.emit('tunnel:open', tunnel);
        client.once('close', () => {
          // `bytesRead` is what the client sent us; `bytesWritten` is what we
          // sent back. No counting streams needed.
          this.#bytesSent += client.bytesRead;
          this.#bytesReceived += client.bytesWritten;
          this.emit('tunnel:close', {
            ...tunnel,
            bytesSent: client.bytesRead,
            bytesReceived: client.bytesWritten,
          });
        });
      },
    };

    try {
      await handleConnection(client, context);
    } catch (cause) {
      const error = toError(cause);
      this.#failedTunnels++;
      this.#logger.debug(`connection failed: ${error.message}`);
      if (info) this.emit('tunnel:error', info, error);
    } finally {
      destroyAll(client);
    }
  }
}
