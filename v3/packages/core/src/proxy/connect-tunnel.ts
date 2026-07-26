import type net from 'node:net';
import { connect, write, writeSequentially } from '../net/socket.js';
import { fragmentClientHello, isClientHello } from '../tls/fragment.js';
import { readChunk } from './connection.js';
import { tunnel } from './pipe.js';
import type { TunnelContext } from './context.js';

const CONNECTION_ESTABLISHED = Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n', 'latin1');

/**
 * The CONNECT path — this is where GreenTunnel actually does its job.
 *
 * Once the tunnel is up, the client's first payload is the TLS ClientHello
 * carrying the SNI. We split it so no single TCP segment (or TLS record)
 * contains a whole hostname, then get out of the way.
 */
export async function openConnectTunnel(
  client: net.Socket,
  leftover: Buffer,
  target: { host: string; port: number },
  ctx: TunnelContext,
): Promise<void> {
  const { settings, dns, logger } = ctx;

  const address = await dns.resolve(target.host);
  const server = await connect({
    host: address,
    port: target.port,
    timeoutMs: settings.connectTimeoutMs,
    signal: ctx.signal,
  });

  ctx.onOpen({
    id: ctx.nextTunnelId(),
    kind: 'https',
    host: target.host,
    port: target.port,
    startedAt: Date.now(),
  });

  await write(client, CONNECTION_ESTABLISHED);

  // Either the client pipelined the ClientHello behind the CONNECT head, or we
  // wait one round-trip for it.
  const hello = leftover.length > 0 ? leftover : await readChunk(client, settings.connectTimeoutMs);
  const pieces = fragmentClientHello(hello, settings.fragment);

  if (pieces.length > 1) {
    const unit = settings.fragment.tlsRecords ? 'records' : 'segments';
    logger.debug(`${target.host}: split ClientHello into ${String(pieces.length)} ${unit}`);
  } else if (settings.fragment.enabled && !isClientHello(hello)) {
    logger.debug(`${target.host}: not a ClientHello, forwarding untouched`);
  }

  await writeSequentially(server, pieces, settings.fragment.delayMs);

  await tunnel(client, server, settings.idleTimeoutMs);
}
