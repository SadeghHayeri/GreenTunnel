import { on } from 'node:events';
import type net from 'node:net';
import { ProtocolError } from '../errors.js';
import { parseRequestHead, resolveUpstream, splitAuthority } from '../http/head.js';
import { openConnectTunnel } from './connect-tunnel.js';
import { openPlainTunnel } from './plain-tunnel.js';
import type { TunnelContext } from './context.js';

const HEAD_TERMINATOR = '\r\n\r\n';
const MAX_HEAD_BYTES = 64 * 1024;

/**
 * Read the first request head off a freshly accepted socket and route it.
 *
 * The server is created with `pauseOnConnect`, so nothing is read until we ask.
 * Whatever we over-read is handed to the tunnel rather than dropped.
 */
export async function handleConnection(client: net.Socket, ctx: TunnelContext): Promise<void> {
  const { raw, rest } = await readRequestHead(client, ctx.settings.connectTimeoutMs);
  const head = parseRequestHead(raw);

  if (head.method.toUpperCase() === 'CONNECT') {
    await openConnectTunnel(client, rest, splitAuthority(head.target, 443), ctx);
    return;
  }

  if (ctx.settings.httpsOnly) {
    respond(client, 403, 'Forbidden', 'GreenTunnel is running in HTTPS-only mode.\n');
    throw new ProtocolError(`Blocked plain HTTP request to ${head.target}`);
  }

  const initial = Buffer.concat([Buffer.from(raw + HEAD_TERMINATOR, 'latin1'), rest]);
  await openPlainTunnel(client, initial, resolveUpstream(head, 80), ctx);
}

/** Accumulate bytes until the blank line that ends an HTTP head. */
async function readRequestHead(
  socket: net.Socket,
  timeoutMs: number,
): Promise<{ raw: string; rest: Buffer }> {
  let buffer: Buffer = Buffer.alloc(0);
  socket.resume();

  try {
    for await (const chunk of readChunks(socket, timeoutMs)) {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

      const end = buffer.indexOf(HEAD_TERMINATOR);
      if (end >= 0) {
        return {
          raw: buffer.subarray(0, end).toString('latin1'),
          rest: buffer.subarray(end + HEAD_TERMINATOR.length),
        };
      }
      if (buffer.length > MAX_HEAD_BYTES) {
        throw new ProtocolError(`Request head exceeds ${String(MAX_HEAD_BYTES)} bytes`);
      }
    }
  } finally {
    socket.pause();
  }

  throw new ProtocolError('Client closed before sending a complete request head');
}

/** Read exactly one more chunk, or throw if the client goes away first. */
export async function readChunk(socket: net.Socket, timeoutMs: number): Promise<Buffer> {
  socket.resume();
  try {
    for await (const chunk of readChunks(socket, timeoutMs)) {
      return chunk;
    }
  } finally {
    socket.pause();
  }
  throw new ProtocolError('Client closed before sending any payload');
}

/**
 * `events.on` as a typed async iterator that also stops on `end`/`close` and
 * rejects on `error` — so a stalled client can never leak the connection the
 * way v2's bare `once('data')` promise did.
 */
function readChunks(socket: net.Socket, timeoutMs: number): AsyncIterableIterator<Buffer> {
  const iterator = on(socket, 'data', {
    signal: AbortSignal.timeout(timeoutMs),
    close: ['end', 'close'],
  }) as AsyncIterableIterator<[Buffer]>;

  return (async function* unwrap() {
    for await (const [chunk] of iterator) yield chunk;
  })();
}

function respond(socket: net.Socket, status: number, reason: string, body: string): void {
  const payload = Buffer.from(body, 'utf8');
  socket.write(
    `HTTP/1.1 ${String(status)} ${reason}\r\n` +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${String(payload.length)}\r\n` +
      'Connection: close\r\n\r\n',
  );
  socket.end(payload);
}
