import http from 'node:http';
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

/** An origin server that answers every request with its own name. */
async function origin(name: string): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain');
    response.end(`${name} ${request.url ?? ''}`);
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
  return { server, port };
}

/** Collect what a socket receives until `done` says it is complete. */
function readUntil(socket: net.Socket, done: (text: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const onData = (chunk: Buffer): void => {
      text += chunk.toString('latin1');
      if (done(text)) {
        socket.off('data', onData);
        resolve(text);
      }
    };
    socket.on('data', onData);
    socket.once('close', () => {
      reject(new Error(`closed early, got: ${JSON.stringify(text)}`));
    });
  });
}

/**
 * Regression: a plain-HTTP connection used to be bound to whichever host its
 * first request named, so a second request for another host on the same
 * connection was delivered to the wrong server. Windows reuses its proxy
 * connection exactly like this for CRL/OCSP fetches, and the misrouting broke
 * certificate revocation checks — and with them, OneDrive.
 */
test.each([
  ['one after the other', false],
  ['pipelined', true],
])('routes each plain-HTTP request to its own host (%s)', async (_label, pipelined) => {
  const a = await origin('alpha');
  const b = await origin('beta');

  const proxy = new Proxy({ port: 0, host: '127.0.0.1' }, { dns: loopbackDns });
  proxy.on('error', () => undefined);
  const { port } = await proxy.start();

  const client = net.connect({ host: '127.0.0.1', port });
  client.on('error', () => undefined);

  const request = (host: string, upstream: number, path: string): string =>
    `GET http://${host}:${String(upstream)}${path} HTTP/1.1\r\n` +
    `Host: ${host}:${String(upstream)}\r\nProxy-Connection: keep-alive\r\n\r\n`;
  const first = request('alpha.test', a.port, '/one');
  const second = request('beta.test', b.port, '/two');

  try {
    let received: string;
    if (pipelined) {
      client.write(first + second);
      received = await readUntil(client, (text) => text.includes('beta /two'));
    } else {
      client.write(first);
      received = await readUntil(client, (text) => text.includes('alpha /one'));
      client.write(second);
      received += await readUntil(client, (text) => text.includes('beta /two'));
    }

    // Both answered, by the right servers, in the order they were asked.
    expect(received).toMatch(/alpha \/one[\s\S]*beta \/two/);
    expect(received).not.toContain('alpha /two');
  } finally {
    client.destroy();
    await proxy.stop();
    a.server.close();
    b.server.close();
  }
});
