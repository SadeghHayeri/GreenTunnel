import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { ConnectError, toError } from '../errors.js';

export interface ConnectOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/**
 * Open a TCP connection, rejecting on error, timeout or abort.
 *
 * v2's `createConnection` only ever resolved: a refused or black-holed upstream
 * left the promise — and the client socket — hanging forever.
 */
export async function connect(options: ConnectOptions): Promise<net.Socket> {
  const { host, port, timeoutMs, signal } = options;
  signal?.throwIfAborted();

  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host, port, noDelay: true });

    const cleanup = (): void => {
      socket.setTimeout(0);
      socket.off('connect', onConnect);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
      signal?.removeEventListener('abort', onAbort);
    };

    const fail = (message: string, cause?: unknown): void => {
      cleanup();
      socket.destroy();
      reject(new ConnectError(host, port, message, cause ? { cause } : undefined));
    };

    function onConnect(): void {
      cleanup();
      resolve(socket);
    }
    function onError(error: Error): void {
      fail(error.message, error);
    }
    function onTimeout(): void {
      fail(`timed out after ${String(timeoutMs)}ms`);
    }
    function onAbort(): void {
      fail('aborted');
    }

    if (timeoutMs > 0) socket.setTimeout(timeoutMs);
    socket.once('connect', onConnect);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Write pieces one at a time, honouring backpressure and an optional pause
 * between them. Ignoring the return value of `write()` — as v2 did — lets a
 * fast peer balloon the kernel-side buffer in memory.
 */
export async function writeSequentially(
  socket: net.Socket,
  pieces: readonly Buffer[],
  delayMs = 0,
): Promise<void> {
  for (const [index, piece] of pieces.entries()) {
    if (socket.destroyed) return;
    if (delayMs > 0 && index > 0) await delay(delayMs);
    await write(socket, piece);
  }
}

/** Promisified `socket.write` that waits for `drain` when the buffer is full. */
export function write(socket: net.Socket, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const flushed = socket.write(chunk, (error) => {
      if (error) reject(toError(error));
      else if (flushed) resolve();
    });
    if (!flushed) socket.once('drain', resolve);
  });
}

/** Destroy every socket, ignoring already-destroyed ones. */
export function destroyAll(...sockets: readonly (net.Socket | undefined)[]): void {
  for (const socket of sockets) {
    if (socket && !socket.destroyed) socket.destroy();
  }
}

/**
 * Arm an inactivity timeout that destroys the socket. `0` disables it.
 * Returns a disposer.
 */
export function armIdleTimeout(socket: net.Socket, idleTimeoutMs: number): () => void {
  if (idleTimeoutMs <= 0) return () => undefined;
  const onTimeout = (): void => {
    socket.destroy();
  };
  socket.setTimeout(idleTimeoutMs, onTimeout);
  return () => {
    socket.setTimeout(0);
    socket.off('timeout', onTimeout);
  };
}
