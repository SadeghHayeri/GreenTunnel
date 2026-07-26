/**
 * Typed errors. v2 swallowed nearly every failure into a debug log, which is
 * why a broken DNS lookup silently became a connection to 127.0.0.1. Everything
 * here is meant to reach the caller.
 */

export class GreenTunnelError extends Error {
  override readonly name: string = 'GreenTunnelError';
}

export class DnsError extends GreenTunnelError {
  override readonly name = 'DnsError';
  readonly hostname: string;

  constructor(hostname: string, message: string, options?: { cause?: unknown }) {
    super(`DNS lookup failed for "${hostname}": ${message}`, options);
    this.hostname = hostname;
  }
}

export class ConnectError extends GreenTunnelError {
  override readonly name = 'ConnectError';
  readonly host: string;
  readonly port: number;

  constructor(host: string, port: number, message: string, options?: { cause?: unknown }) {
    super(`Cannot connect to ${host}:${String(port)}: ${message}`, options);
    this.host = host;
    this.port = port;
  }
}

export class ProtocolError extends GreenTunnelError {
  override readonly name = 'ProtocolError';
}

export class SystemProxyError extends GreenTunnelError {
  override readonly name = 'SystemProxyError';
}

/** Narrow an unknown catch binding to something with a message. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
