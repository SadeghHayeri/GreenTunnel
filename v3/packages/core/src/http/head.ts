import { ProtocolError } from '../errors.js';

export interface HeaderField {
  readonly name: string;
  readonly value: string;
}

export interface RequestHead {
  readonly method: string;
  /** Request target exactly as sent: origin-form, absolute-form or authority-form. */
  readonly target: string;
  readonly version: string;
  /** Kept as an ordered list — duplicates and casing are significant on the wire. */
  readonly headers: readonly HeaderField[];
}

/** Methods a client may legally send to a proxy. */
const METHOD_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Parse the head of an HTTP/1.x request (request line + fields, no trailing
 * blank line). Throws `ProtocolError` rather than producing a half-built object.
 */
export function parseRequestHead(raw: string): RequestHead {
  const lines = raw.split('\r\n');
  const requestLine = lines.shift();
  if (!requestLine) {
    throw new ProtocolError('Empty HTTP request line');
  }

  const parts = requestLine.split(' ').filter((part) => part.length > 0);
  const [method, target, version = 'HTTP/1.1'] = parts;
  if (!method || !target || parts.length < 2) {
    throw new ProtocolError(`Malformed HTTP request line: ${JSON.stringify(requestLine)}`);
  }
  if (!METHOD_PATTERN.test(method)) {
    throw new ProtocolError(`Invalid HTTP method: ${JSON.stringify(method)}`);
  }

  const headers: HeaderField[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    const separator = line.indexOf(':');
    if (separator < 1) {
      throw new ProtocolError(`Malformed HTTP header: ${JSON.stringify(line)}`);
    }
    headers.push({ name: line.slice(0, separator), value: line.slice(separator + 1).trim() });
  }

  return { method, target, version, headers };
}

/** Serialize a head back onto the wire, including the terminating blank line. */
export function serializeRequestHead(head: RequestHead): string {
  const lines = [`${head.method} ${head.target} ${head.version}`];
  for (const { name, value } of head.headers) {
    lines.push(`${name}: ${value}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

export function getHeader(head: RequestHead, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return head.headers.find((field) => field.name.toLowerCase() === wanted)?.value;
}

/**
 * Headers that address *this* proxy and must not be relayed upstream.
 *
 * Deliberately narrow: `Connection`, `Transfer-Encoding` and friends are left
 * alone because we forward the body byte-for-byte, so the framing the client
 * chose has to stay intact.
 */
const PROXY_ONLY_HEADERS = new Set(['proxy-connection', 'proxy-authorization']);

/**
 * Turn a proxied request into one an origin server will accept:
 * absolute-form target becomes origin-form, proxy-only headers are dropped, and
 * a `Host` header is synthesized if the client relied on the absolute URI.
 */
export function toOriginForm(head: RequestHead): RequestHead {
  const headers = head.headers.filter((field) => !PROXY_ONLY_HEADERS.has(field.name.toLowerCase()));

  let target = head.target;
  if (isAbsoluteForm(target)) {
    const url = parseAbsoluteTarget(target);
    target = `${url.pathname}${url.search}`;
    if (!headers.some((field) => field.name.toLowerCase() === 'host')) {
      headers.unshift({ name: 'Host', value: url.host });
    }
  }

  return { method: head.method, target, version: head.version, headers };
}

function isAbsoluteForm(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
}

function parseAbsoluteTarget(target: string): URL {
  try {
    return new URL(target);
  } catch (cause) {
    throw new ProtocolError(`Invalid absolute request target: ${target}`, { cause });
  }
}

/** Resolve the upstream host and port a proxied request is aimed at. */
export function resolveUpstream(
  head: RequestHead,
  defaultPort: number,
): {
  host: string;
  port: number;
} {
  const authority = isAbsoluteForm(head.target)
    ? parseAbsoluteTarget(head.target).host
    : (getHeader(head, 'host') ?? '');

  return splitAuthority(authority, defaultPort);
}

/**
 * Split `host:port`, `[::1]:443` or a bare host. Throws when there is no host,
 * so we never end up dialling `undefined` (which resolves to localhost).
 */
export function splitAuthority(
  authority: string,
  defaultPort: number,
): {
  host: string;
  port: number;
} {
  const trimmed = authority.trim();
  if (trimmed.length === 0) {
    throw new ProtocolError('Request has no target authority (missing Host header)');
  }

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end < 0) throw new ProtocolError(`Malformed IPv6 authority: ${authority}`);
    const host = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    return { host, port: rest.startsWith(':') ? parsePort(rest.slice(1), authority) : defaultPort };
  }

  const separator = trimmed.lastIndexOf(':');
  if (separator < 0) {
    return { host: trimmed, port: defaultPort };
  }
  return {
    host: trimmed.slice(0, separator),
    port: parsePort(trimmed.slice(separator + 1), authority),
  };
}

function parsePort(raw: string, authority: string): number {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ProtocolError(`Invalid port in authority: ${authority}`);
  }
  return port;
}
