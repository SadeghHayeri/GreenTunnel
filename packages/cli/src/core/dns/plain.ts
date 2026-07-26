import { Resolver } from 'node:dns/promises';
import { DnsError, toError } from '../errors.js';
import type { DnsRecord, DnsSettings } from '../types.js';
import { CachingDnsResolver, familyOf, type QueryType } from './resolver.js';

/**
 * Unencrypted DNS over the platform resolver.
 *
 * v2 pulled in `dns-socket` and kept one module-level socket alive forever,
 * then read `answers[0].data` without checking it existed. Node's own
 * `dns.Resolver` does the same job with TTLs, retries and no dependency.
 */
export class PlainResolver extends CachingDnsResolver {
  readonly #resolver: Resolver;

  constructor(settings: DnsSettings) {
    super(settings);
    this.#resolver = new Resolver({ timeout: settings.timeoutMs, tries: 2 });
    if (settings.plainServers.length > 0) {
      this.#resolver.setServers([...settings.plainServers]);
    }
  }

  protected override async query(hostname: string, type: QueryType): Promise<DnsRecord[]> {
    const family = familyOf(type);
    try {
      const answers =
        type === 'A'
          ? await this.#resolver.resolve4(hostname, { ttl: true })
          : await this.#resolver.resolve6(hostname, { ttl: true });
      return answers.map((answer) => ({ address: answer.address, family, ttl: answer.ttl }));
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      // "No records of this type" is a normal answer, not a failure — let the
      // caller fall back to the other address family.
      if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
      throw new DnsError(hostname, toError(cause).message, { cause });
    }
  }

  override close(): void {
    this.#resolver.cancel();
    super.close();
  }
}

export function createPlainResolver(settings: DnsSettings): PlainResolver {
  return new PlainResolver(settings);
}
