import net from 'node:net';
import process from 'node:process';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { DnsResolver } from '../dns/index.js';
import { Proxy } from './index.js';

/** Resolves every name to loopback, so no real DNS is touched. */
const loopbackDns: DnsResolver = {
  resolve: () => Promise.resolve('127.0.0.1'),
  close: () => undefined,
};

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

let uncaught: unknown[] = [];
const collect = (error: unknown): void => {
  uncaught.push(error);
};

beforeEach(() => {
  uncaught = [];
  // Vitest installs its own handler and fails the run on an uncaught error;
  // take the event first so the assertion below is the one that reports it.
  process.prependListener('uncaughtException', collect);
});

afterEach(() => {
  process.removeListener('uncaughtException', collect);
});

/**
 * Regression: an upstream that resets while the proxy is waiting for the
 * client's ClientHello used to hit a socket with no 'error' listener, which
 * Node rethrows as an uncaught exception — the Electron desktop app showed it
 * as "A JavaScript error occurred in the main process: read ECONNRESET".
 */
test('an upstream reset during the CONNECT handshake does not crash the process', async () => {
  const upstream = net.createServer((socket) => {
    socket.on('error', () => undefined);
    // Reset once the proxy is past connect() and waiting on the client.
    setTimeout(() => {
      socket.resetAndDestroy();
    }, 100);
  });
  const upstreamPort = await listen(upstream);

  const proxy = new Proxy({ port: 0, host: '127.0.0.1' }, { dns: loopbackDns });
  proxy.on('error', () => undefined);
  const { port } = await proxy.start();

  const client = net.connect({ host: '127.0.0.1', port });
  client.on('error', () => undefined);
  await new Promise<void>((resolve) => {
    client.once('connect', () => {
      resolve();
    });
  });

  // A CONNECT with no ClientHello behind it: the proxy must wait for one.
  client.write(`CONNECT example.com:${String(upstreamPort)} HTTP/1.1\r\n\r\n`);
  await new Promise((resolve) => {
    setTimeout(resolve, 600);
  });

  client.destroy();
  await proxy.stop();
  upstream.close();

  expect(uncaught).toEqual([]);
});
