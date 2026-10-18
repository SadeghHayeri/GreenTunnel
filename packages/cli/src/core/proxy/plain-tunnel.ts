import type net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { ProtocolError } from '../errors.js';
import { resolveUpstream } from '../http/head.js';
import { HttpRequestRewriter } from '../http/rewriter.js';
import { armIdleTimeout, connect, destroyAll, write } from '../net/socket.js';
import type { TunnelContext } from './context.js';

/** One origin server the connection is currently, or was recently, talking to. */
interface Upstream {
  readonly key: string;
  readonly socket: net.Socket;
  /** Settles once the server has closed and everything it sent was relayed. */
  readonly relayed: Promise<void>;
  /** Being replaced by another upstream, so its close must not end the client. */
  retiring: boolean;
}

/**
 * Plain-HTTP proxying. No fragmentation happens here — there is no SNI to hide,
 * and the Host header is in cleartext regardless. Its job is to relay the
 * stream while rewriting absolute-form request targets into origin-form, and to
 * send each request to the host it actually names.
 *
 * That last part is why this is not a plain `pipeline`. A client keeps *one*
 * connection to its proxy and sends requests for any host down it: Windows does
 * exactly that when it fetches a certificate's CRL from one host and its OCSP
 * answer from another. v3.0 picked the upstream from the first request and sent
 * everything after it to the same server, so the second host's request landed
 * on the first host's server — certificate revocation checks failed
 * system-wide, and anything that insists on them (OneDrive) stopped working.
 */
export async function openPlainTunnel(
  client: net.Socket,
  initial: Buffer,
  ctx: TunnelContext,
): Promise<void> {
  const { settings, dns, logger } = ctx;
  const rewriter = new HttpRequestRewriter();
  const sockets: net.Socket[] = [];
  const disarm = armIdleTimeout(client, settings.idleTimeoutMs);
  let current: Upstream | undefined;

  async function open(target: { host: string; port: number }, key: string): Promise<Upstream> {
    const address = await dns.resolve(target.host);
    const socket = await connect({
      host: address,
      port: target.port,
      timeoutMs: settings.connectTimeoutMs,
      signal: ctx.signal,
    });
    sockets.push(socket);
    armIdleTimeout(socket, settings.idleTimeoutMs);

    if (current === undefined) {
      ctx.onOpen({
        id: ctx.nextTunnelId(),
        kind: 'http',
        host: target.host,
        port: target.port,
        startedAt: Date.now(),
      });
    } else {
      logger.debug(
        `${target.host}:${String(target.port)}: switching upstream on a reused connection`,
      );
    }

    const upstream: Upstream = {
      key,
      socket,
      retiring: false,
      relayed: relay(socket, client).then(async (clean) => {
        if (upstream.retiring) return;
        // The server we were talking to hung up, so the conversation is over:
        // pass that on. A response framed by connection close depends on it.
        if (clean) await endGracefully(client);
        else client.destroy();
      }),
    };
    return upstream;
  }

  // Put the bytes we already consumed back so the rewriter sees the full stream.
  client.unshift(initial);

  try {
    for await (const chunk of client as AsyncIterable<Buffer>) {
      for (const segment of rewriter.segments(chunk)) {
        if (segment.head) {
          const target = resolveUpstream(segment.head, 80);
          const key = `${target.host.toLowerCase()}:${String(target.port)}`;
          if (key !== current?.key) {
            if (current) await retire(current, settings.connectTimeoutMs);
            // The old upstream may have ended the client while we waited.
            if (client.writableEnded || client.destroyed) return;
            current = await open(target, key);
          }
        }
        if (!current) throw new ProtocolError('Request body arrived before any request head');
        if (current.socket.destroyed) return;
        await write(current.socket, segment.data);
      }
    }

    // The client half-closed. Forward what is left and let the last response
    // drain; the server's close then ends the client through `relayed`.
    if (current && !current.socket.destroyed) {
      for (const piece of rewriter.flush()) await write(current.socket, piece);
      current.socket.end();
      await current.relayed;
    }
  } finally {
    disarm();
    destroyAll(...sockets);
  }
}

/**
 * Let an upstream finish before its successor starts, so responses reach the
 * client in the order it sent the requests.
 *
 * Half-closing is the signal: an HTTP server answers what it has already been
 * sent and then closes. Without pipelining that answer is already complete and
 * the close is immediate; the timeout only bounds a server that never closes.
 */
async function retire(upstream: Upstream, timeoutMs: number): Promise<void> {
  upstream.retiring = true;
  upstream.socket.end();
  const abort = new AbortController();
  await Promise.race([
    upstream.relayed,
    delay(timeoutMs, undefined, { signal: abort.signal }).catch(() => undefined),
  ]);
  abort.abort();
  upstream.socket.destroy();
}

/**
 * Copy server → client until the server closes, honouring backpressure.
 * Never ends or destroys the client, since another upstream may follow, and
 * never rejects. Resolves `false` when the server closed on an error.
 */
function relay(server: net.Socket, client: net.Socket): Promise<boolean> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer): void => {
      if (!client.write(chunk)) {
        server.pause();
        client.once('drain', () => server.resume());
      }
    };
    server.on('data', onData);
    server.once('close', (hadError) => {
      server.off('data', onData);
      resolve(!hadError);
    });
  });
}

/** End the client and wait until its buffered writes have gone out. */
function endGracefully(client: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    client.once('close', () => {
      resolve();
    });
    client.end(() => {
      resolve();
    });
  });
}
