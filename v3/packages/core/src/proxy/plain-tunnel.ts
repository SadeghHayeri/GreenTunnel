import type net from 'node:net';
import { connect } from '../net/socket.js';
import { createRequestRewriteStream } from '../http/rewriter.js';
import { tunnel } from './pipe.js';
import type { TunnelContext } from './context.js';

/**
 * Plain-HTTP proxying. No fragmentation happens here — there is no SNI to hide,
 * and the Host header is in cleartext regardless. Its only job is to relay the
 * stream while rewriting absolute-form request targets into origin-form.
 */
export async function openPlainTunnel(
  client: net.Socket,
  initial: Buffer,
  target: { host: string; port: number },
  ctx: TunnelContext,
): Promise<void> {
  const { settings, dns } = ctx;

  const address = await dns.resolve(target.host);
  const server = await connect({
    host: address,
    port: target.port,
    timeoutMs: settings.connectTimeoutMs,
    signal: ctx.signal,
  });

  ctx.onOpen({
    id: ctx.nextTunnelId(),
    kind: 'http',
    host: target.host,
    port: target.port,
    startedAt: Date.now(),
  });

  // Put the bytes we already consumed back so the rewriter sees the full stream.
  client.unshift(initial);

  await tunnel(client, server, settings.idleTimeoutMs, createRequestRewriteStream());
}
