import { isIP } from 'node:net';
import tls from 'node:tls';
import dnsPacket from 'dns-packet';
import { DnsError, toError } from '../errors.js';
import type { DnsRecord, DnsSettings } from '../types.js';
import { extractAddresses } from './decode.js';
import { CachingDnsResolver, type QueryType } from './resolver.js';

/**
 * DNS over TLS (RFC 7858). One short-lived TLS connection per uncached lookup —
 * the resolver cache means that is a handful of connections per session, and it
 * avoids the stale-socket handling a pooled connection would need.
 */
export class DotResolver extends CachingDnsResolver {
  protected override async query(hostname: string, type: QueryType): Promise<DnsRecord[]> {
    const request = dnsPacket.streamEncode({
      type: 'query',
      id: 0,
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{ type, name: hostname }],
    });

    const response = await this.#exchange(hostname, request);

    let decoded: dnsPacket.Packet;
    try {
      decoded = dnsPacket.streamDecode(response);
    } catch (cause) {
      throw new DnsError(hostname, 'malformed DoT response', { cause });
    }

    return extractAddresses(decoded, type);
  }

  #exchange(hostname: string, request: Buffer): Promise<Buffer> {
    const { dotHost, dotPort, timeoutMs } = this.settings;

    return new Promise<Buffer>((resolve, reject) => {
      const socket = tls.connect({
        host: dotHost,
        port: dotPort,
        ALPNProtocols: ['dot'],
        // Only send SNI when the server is addressed by name; certificates for
        // IP-addressed resolvers (1.1.1.1, 9.9.9.9) carry IP SANs instead.
        ...(isIP(dotHost) === 0 ? { servername: dotHost } : {}),
      });

      let chunks = Buffer.alloc(0);

      const finish = (error?: Error, value?: Buffer): void => {
        socket.destroy();
        if (error) reject(error);
        else if (value) resolve(value);
      };

      socket.setTimeout(timeoutMs, () => {
        finish(new DnsError(hostname, `DoT query timed out after ${String(timeoutMs)}ms`));
      });

      socket.once('secureConnect', () => {
        socket.write(request);
      });

      socket.on('data', (chunk: Buffer) => {
        chunks = Buffer.concat([chunks, chunk]);
        // Messages are framed with a two-byte big-endian length prefix.
        if (chunks.length < 2) return;
        const expected = chunks.readUInt16BE(0);
        if (chunks.length >= expected + 2) {
          finish(undefined, chunks.subarray(0, expected + 2));
        }
      });

      socket.once('error', (cause) => {
        finish(
          new DnsError(hostname, `DoT connection failed: ${toError(cause).message}`, { cause }),
        );
      });

      socket.once('close', () => {
        if (chunks.length === 0) {
          finish(new DnsError(hostname, 'DoT connection closed before a response arrived'));
        }
      });
    });
  }
}

export function createDotResolver(settings: DnsSettings): DotResolver {
  return new DotResolver(settings);
}
