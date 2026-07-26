import { isIP } from 'node:net';
import { LRUCache } from 'lru-cache';
import { DnsError } from '../errors.js';
import type { DnsRecord, DnsSettings } from '../types.js';

export type QueryType = 'A' | 'AAAA';

export interface DnsResolver {
  /** Resolve to a single IP. Always rejects on failure — never returns undefined. */
  resolve(hostname: string): Promise<string>;
  close(): void;
}

/**
 * Shared caching + family-preference logic.
 *
 * Two v2 bugs are fixed here:
 * 1. `lookup()` caught every error and returned `undefined`, which the socket
 *    layer then passed to `net.connect` — silently dialling localhost.
 * 2. The cache never expired, so a rotated IP stayed wrong for the whole
 *    session. Entries now expire on the record's own TTL (clamped).
 */
export abstract class CachingDnsResolver implements DnsResolver {
  protected readonly settings: DnsSettings;
  readonly #cache: LRUCache<string, string>;
  readonly #inflight = new Map<string, Promise<string>>();

  constructor(settings: DnsSettings) {
    this.settings = settings;
    this.#cache = new LRUCache<string, string>({
      max: Math.max(1, settings.cacheSize),
      ttl: settings.maxTtlSeconds * 1000,
    });
  }

  protected abstract query(hostname: string, type: QueryType): Promise<DnsRecord[]>;

  async resolve(hostname: string): Promise<string> {
    if (isIP(hostname) !== 0) return hostname;

    const cached = this.#cache.get(hostname);
    if (cached !== undefined) return cached;

    // Collapse concurrent lookups for the same name into one query.
    const existing = this.#inflight.get(hostname);
    if (existing) return existing;

    const pending = this.#lookup(hostname).finally(() => this.#inflight.delete(hostname));
    this.#inflight.set(hostname, pending);
    return pending;
  }

  close(): void {
    this.#cache.clear();
    this.#inflight.clear();
  }

  async #lookup(hostname: string): Promise<string> {
    const [primary, fallback] = queryOrder(this.settings.family);

    let record = await this.#tryQuery(hostname, primary);
    if (!record && fallback) {
      record = await this.#tryQuery(hostname, fallback);
    }
    if (!record) {
      throw new DnsError(hostname, `no ${primary}${fallback ? `/${fallback}` : ''} records`);
    }

    const ttlSeconds = clamp(record.ttl, this.settings.minTtlSeconds, this.settings.maxTtlSeconds);
    this.#cache.set(hostname, record.address, { ttl: ttlSeconds * 1000 });
    return record.address;
  }

  async #tryQuery(hostname: string, type: QueryType): Promise<DnsRecord | undefined> {
    const records = await this.query(hostname, type);
    return records.find((record) => isIP(record.address) !== 0);
  }
}

function queryOrder(family: DnsSettings['family']): [QueryType, QueryType?] {
  switch (family) {
    case 'ipv4':
      return ['A'];
    case 'ipv6':
      return ['AAAA'];
    case 'ipv6-first':
      return ['AAAA', 'A'];
    default:
      return ['A', 'AAAA'];
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return min;
  return Math.min(Math.max(value, min), max);
}

/** Family that matches a query type, for building `DnsRecord`s. */
export function familyOf(type: QueryType): 4 | 6 {
  return type === 'A' ? 4 : 6;
}
