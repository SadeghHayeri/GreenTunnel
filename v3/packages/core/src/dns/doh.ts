import dnsPacket from 'dns-packet';
import { DnsError, toError } from '../errors.js';
import type { DnsRecord, DnsSettings } from '../types.js';
import { extractAddresses } from './decode.js';
import { CachingDnsResolver, type QueryType } from './resolver.js';

/**
 * DNS over HTTPS using the RFC 8484 wire format.
 *
 * v2 spoke the Google/Cloudflare JSON API, which meant it only worked with the
 * handful of servers that implement it. Wire format works with essentially
 * every DoH resolver (Cloudflare, Google, AdGuard, NextDNS, self-hosted …).
 *
 * We use the GET form rather than POST: it is cacheable, and it is what
 * HTTP/1.1-only clients get served. Node's `fetch` does not speak HTTP/2, so a
 * server that mandates it (Quad9 answers 505 to everything else) is out of
 * reach — use `--dns dot --dot-host 9.9.9.9` for those.
 */
export class DohResolver extends CachingDnsResolver {
  protected override async query(hostname: string, type: QueryType): Promise<DnsRecord[]> {
    const request = dnsPacket.encode({
      type: 'query',
      id: 0, // RFC 8484 §4.1 — id 0 keeps responses cacheable by intermediaries.
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{ type, name: hostname }],
    });

    const url = new URL(this.settings.dohUrl);
    url.searchParams.set('dns', request.toString('base64url'));

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/dns-message' },
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch (cause) {
      throw new DnsError(hostname, `DoH request failed: ${toError(cause).message}`, { cause });
    }

    if (!response.ok) {
      throw new DnsError(hostname, `DoH server returned ${String(response.status)}`);
    }

    const body = Buffer.from(await response.arrayBuffer());

    let decoded: dnsPacket.DecodedPacket;
    try {
      decoded = dnsPacket.decode(body);
    } catch (cause) {
      throw new DnsError(hostname, 'malformed DoH response', { cause });
    }

    return extractAddresses(decoded, type);
  }
}

export function createDohResolver(settings: DnsSettings): DohResolver {
  return new DohResolver(settings);
}
