import { describe, expect, it } from 'vitest';
import { HttpRequestRewriter } from './rewriter.js';

function feed(rewriter: HttpRequestRewriter, raw: string): string {
  return Buffer.concat(rewriter.transform(Buffer.from(raw, 'latin1'))).toString('latin1');
}

describe('HttpRequestRewriter', () => {
  it('converts an absolute-form target to origin-form', () => {
    const out = feed(
      new HttpRequestRewriter(),
      'GET http://example.com/a?b=1 HTTP/1.1\r\nHost: example.com\r\n\r\n',
    );

    expect(out).toBe('GET /a?b=1 HTTP/1.1\r\nHost: example.com\r\n\r\n');
  });

  it('synthesizes a Host header when the client only sent an absolute URI', () => {
    const out = feed(new HttpRequestRewriter(), 'GET http://example.com/ HTTP/1.1\r\n\r\n');

    expect(out).toBe('GET / HTTP/1.1\r\nHost: example.com\r\n\r\n');
  });

  it('drops proxy-only headers but keeps Connection intact', () => {
    const out = feed(
      new HttpRequestRewriter(),
      'GET http://example.com/ HTTP/1.1\r\n' +
        'Host: example.com\r\n' +
        'Proxy-Connection: keep-alive\r\n' +
        'Proxy-Authorization: Basic eA==\r\n' +
        'Connection: keep-alive\r\n\r\n',
    );

    expect(out).not.toContain('Proxy-Connection');
    expect(out).not.toContain('Proxy-Authorization');
    expect(out).toContain('Connection: keep-alive');
  });

  it('forwards a Content-Length body verbatim, even when it looks like a request', () => {
    // This is the v2 corruption bug: the body starts with a valid method and an
    // absolute URI, so the old "does this chunk look like a request?" check
    // rewrote it.
    const body = 'GET http://evil.example/ HTTP/1.1\r\n\r\n';
    const out = feed(
      new HttpRequestRewriter(),
      `POST http://example.com/upload HTTP/1.1\r\n` +
        `Host: example.com\r\n` +
        `Content-Length: ${String(body.length)}\r\n\r\n` +
        body,
    );

    expect(out).toBe(
      `POST /upload HTTP/1.1\r\nHost: example.com\r\nContent-Length: ${String(body.length)}\r\n\r\n${body}`,
    );
  });

  it('tracks chunked framing and rewrites the next request on the connection', () => {
    const rewriter = new HttpRequestRewriter();

    const first = feed(
      rewriter,
      'POST http://example.com/one HTTP/1.1\r\n' +
        'Host: example.com\r\n' +
        'Transfer-Encoding: chunked\r\n\r\n' +
        '5\r\nhello\r\n' +
        '0\r\n\r\n',
    );
    expect(first).toContain('POST /one HTTP/1.1');
    expect(first).toContain('5\r\nhello\r\n0\r\n\r\n');

    const second = feed(
      rewriter,
      'GET http://example.com/two HTTP/1.1\r\nHost: example.com\r\n\r\n',
    );
    expect(second).toBe('GET /two HTTP/1.1\r\nHost: example.com\r\n\r\n');
  });

  it('reassembles a head that arrives split across packets', () => {
    const rewriter = new HttpRequestRewriter();

    expect(feed(rewriter, 'GET http://example.com/x HTTP/1.1\r\nHo')).toBe('');
    expect(feed(rewriter, 'st: example.com\r\n\r\n')).toBe(
      'GET /x HTTP/1.1\r\nHost: example.com\r\n\r\n',
    );
  });

  it('stops parsing after an Upgrade and tunnels the rest', () => {
    const rewriter = new HttpRequestRewriter();

    feed(
      rewriter,
      'GET http://example.com/ws HTTP/1.1\r\n' +
        'Host: example.com\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n\r\n',
    );

    const framed = 'binary';
    expect(feed(rewriter, framed)).toBe(framed);
  });

  it('rejects a malformed Content-Length', () => {
    expect(() =>
      feed(
        new HttpRequestRewriter(),
        'POST http://example.com/ HTTP/1.1\r\nHost: example.com\r\nContent-Length: abc\r\n\r\n',
      ),
    ).toThrow(/Invalid Content-Length/);
  });
});
