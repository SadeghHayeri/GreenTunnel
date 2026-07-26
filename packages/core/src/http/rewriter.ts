import { Transform, type TransformCallback } from 'node:stream';
import { ProtocolError, toError } from '../errors.js';
import { getHeader, parseRequestHead, serializeRequestHead, toOriginForm } from './head.js';

const MAX_HEAD_BYTES = 64 * 1024;
const CRLF = '\r\n';
const HEAD_TERMINATOR = '\r\n\r\n';

type State =
  'head' | 'body-length' | 'chunk-size' | 'chunk-data' | 'chunk-crlf' | 'trailers' | 'passthrough';

/**
 * Rewrites every request head on a keep-alive proxy connection while forwarding
 * bodies byte-for-byte.
 *
 * v2 ran its rewrite over *every* chunk and asked "does this look like a
 * request?" — so a POST body that happened to start with the word `GET`, or any
 * binary upload, was silently mangled. Tracking `Content-Length` / chunked
 * framing is the only correct way to know where the next head actually begins.
 */
export class HttpRequestRewriter {
  #state: State = 'head';
  #buffer: Buffer = Buffer.alloc(0);
  #remaining = 0;

  /** Feed raw client bytes in, get rewritten bytes out. */
  transform(chunk: Buffer): Buffer[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const out: Buffer[] = [];

    for (;;) {
      if (this.#state === 'passthrough') {
        if (this.#buffer.length > 0) {
          out.push(this.#buffer);
          this.#buffer = Buffer.alloc(0);
        }
        return out;
      }

      const progressed = this.#step(out);
      if (!progressed) return out;
    }
  }

  /** Flush whatever is still buffered when the client half-closes. */
  flush(): Buffer[] {
    if (this.#buffer.length === 0) return [];
    const rest = this.#buffer;
    this.#buffer = Buffer.alloc(0);
    return [rest];
  }

  /** Returns false when it needs more bytes. */
  #step(out: Buffer[]): boolean {
    switch (this.#state) {
      case 'head':
        return this.#stepHead(out);
      case 'body-length':
      case 'chunk-data':
        return this.#stepCountedBytes(out);
      case 'chunk-size':
        return this.#stepChunkSize(out);
      case 'chunk-crlf':
        return this.#stepChunkCrlf(out);
      case 'trailers':
        return this.#stepTrailers(out);
      default:
        return false;
    }
  }

  #stepHead(out: Buffer[]): boolean {
    const end = this.#buffer.indexOf(HEAD_TERMINATOR);
    if (end < 0) {
      if (this.#buffer.length > MAX_HEAD_BYTES) {
        throw new ProtocolError(`HTTP request head exceeds ${String(MAX_HEAD_BYTES)} bytes`);
      }
      return false;
    }

    const raw = this.#buffer.subarray(0, end).toString('latin1');
    this.#consume(end + HEAD_TERMINATOR.length);

    const head = toOriginForm(parseRequestHead(raw));
    out.push(Buffer.from(serializeRequestHead(head), 'latin1'));

    // A successful Upgrade turns the rest of the connection into an opaque
    // tunnel — stop trying to parse it as HTTP.
    if (getHeader(head, 'upgrade')) {
      this.#state = 'passthrough';
      return true;
    }

    const encoding = getHeader(head, 'transfer-encoding')?.toLowerCase();
    if (encoding?.includes('chunked')) {
      this.#state = 'chunk-size';
      return true;
    }

    const length = getHeader(head, 'content-length');
    if (length !== undefined) {
      const parsed = Number.parseInt(length, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ProtocolError(`Invalid Content-Length: ${length}`);
      }
      this.#remaining = parsed;
      this.#state = parsed > 0 ? 'body-length' : 'head';
      return true;
    }

    this.#state = 'head';
    return true;
  }

  /** Forward exactly `#remaining` bytes verbatim, then advance. */
  #stepCountedBytes(out: Buffer[]): boolean {
    const take = Math.min(this.#remaining, this.#buffer.length);
    if (take > 0) {
      out.push(this.#buffer.subarray(0, take));
      this.#consume(take);
      this.#remaining -= take;
    }
    if (this.#remaining > 0) return false;
    this.#state = this.#state === 'body-length' ? 'head' : 'chunk-crlf';
    return true;
  }

  #stepChunkSize(out: Buffer[]): boolean {
    const end = this.#buffer.indexOf(CRLF);
    if (end < 0) {
      if (this.#buffer.length > MAX_HEAD_BYTES) {
        throw new ProtocolError('Chunk size line is implausibly long');
      }
      return false;
    }

    const line = this.#buffer.subarray(0, end).toString('latin1');
    out.push(this.#buffer.subarray(0, end + CRLF.length));
    this.#consume(end + CRLF.length);

    const size = Number.parseInt(line.split(';', 1)[0]?.trim() ?? '', 16);
    if (!Number.isInteger(size) || size < 0) {
      throw new ProtocolError(`Invalid chunk size: ${JSON.stringify(line)}`);
    }

    if (size === 0) {
      this.#state = 'trailers';
    } else {
      this.#remaining = size;
      this.#state = 'chunk-data';
    }
    return true;
  }

  #stepChunkCrlf(out: Buffer[]): boolean {
    if (this.#buffer.length < CRLF.length) return false;
    out.push(this.#buffer.subarray(0, CRLF.length));
    this.#consume(CRLF.length);
    this.#state = 'chunk-size';
    return true;
  }

  #stepTrailers(out: Buffer[]): boolean {
    const end = this.#buffer.indexOf(CRLF);
    if (end < 0) return false;
    out.push(this.#buffer.subarray(0, end + CRLF.length));
    this.#consume(end + CRLF.length);
    if (end === 0) this.#state = 'head';
    return true;
  }

  #consume(bytes: number): void {
    this.#buffer = this.#buffer.subarray(bytes);
  }
}

/** Stream wrapper so the rewriter can sit inside a `pipeline()`. */
export function createRequestRewriteStream(): Transform {
  const rewriter = new HttpRequestRewriter();

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        for (const piece of rewriter.transform(chunk)) this.push(piece);
        callback();
      } catch (error) {
        callback(toError(error));
      }
    },
    flush(callback: TransformCallback) {
      try {
        for (const piece of rewriter.flush()) this.push(piece);
        callback();
      } catch (error) {
        callback(toError(error));
      }
    },
  });
}
