import type net from 'node:net';
import { pipeline } from 'node:stream/promises';
import { armIdleTimeout, destroyAll } from '../net/socket.js';
import { toError } from '../errors.js';

/** Errors that just mean "the other side hung up" — not worth reporting. */
const BENIGN_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_STREAM_DESTROYED',
  'ABORT_ERR',
]);

function isBenign(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && BENIGN_CODES.has(code);
}

/**
 * Join two sockets into a bidirectional tunnel and resolve when both halves are
 * done.
 *
 * `pipeline` (rather than v2's raw `.on('data')` + `.write()`) gives us
 * backpressure, half-close propagation and guaranteed teardown on error.
 * `allSettled` matters: when one direction fails the other almost always fails
 * too, and an unobserved rejection there would crash the process.
 */
export async function tunnel(
  client: net.Socket,
  server: net.Socket,
  idleTimeoutMs: number,
  transform?: NodeJS.ReadWriteStream,
): Promise<void> {
  const disarm = [armIdleTimeout(client, idleTimeoutMs), armIdleTimeout(server, idleTimeoutMs)];

  const upstream = transform ? pipeline(client, transform, server) : pipeline(client, server);
  const downstream = pipeline(server, client);

  try {
    const results = await Promise.allSettled([upstream, downstream]);
    const failure = results.find(
      (result) => result.status === 'rejected' && !isBenign(result.reason),
    );
    if (failure?.status === 'rejected') {
      throw toError(failure.reason);
    }
  } finally {
    for (const off of disarm) off();
    destroyAll(client, server);
  }
}
