import type { DnsSettings, FragmentSettings, ProxyOptions, ProxySettings } from './types.js';

export const DEFAULT_DNS: DnsSettings = {
  mode: 'doh',
  dohUrl: 'https://cloudflare-dns.com/dns-query',
  dotHost: '1.1.1.1',
  dotPort: 853,
  plainServers: [],
  family: 'ipv4-first',
  cacheSize: 1000,
  minTtlSeconds: 30,
  maxTtlSeconds: 3600,
  timeoutMs: 5000,
};

export const DEFAULT_FRAGMENT: FragmentSettings = {
  enabled: true,
  size: 40,
  tlsRecords: false,
  delayMs: 0,
};

export const DEFAULT_SETTINGS: ProxySettings = {
  host: '127.0.0.1',
  port: 8000,
  httpsOnly: false,
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 120_000,
  fragment: DEFAULT_FRAGMENT,
  dns: DEFAULT_DNS,
};

/**
 * Merge user overrides onto the defaults. Explicit and shallow-per-section on
 * purpose: a hand-written resolver keeps `exactOptionalPropertyTypes` honest
 * and makes it obvious which keys exist.
 */
export function resolveSettings(options: ProxyOptions = {}): ProxySettings {
  return {
    host: options.host ?? DEFAULT_SETTINGS.host,
    port: options.port ?? DEFAULT_SETTINGS.port,
    httpsOnly: options.httpsOnly ?? DEFAULT_SETTINGS.httpsOnly,
    connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_SETTINGS.connectTimeoutMs,
    idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_SETTINGS.idleTimeoutMs,
    fragment: {
      enabled: options.fragment?.enabled ?? DEFAULT_FRAGMENT.enabled,
      size: options.fragment?.size ?? DEFAULT_FRAGMENT.size,
      tlsRecords: options.fragment?.tlsRecords ?? DEFAULT_FRAGMENT.tlsRecords,
      delayMs: options.fragment?.delayMs ?? DEFAULT_FRAGMENT.delayMs,
    },
    dns: {
      mode: options.dns?.mode ?? DEFAULT_DNS.mode,
      dohUrl: options.dns?.dohUrl ?? DEFAULT_DNS.dohUrl,
      dotHost: options.dns?.dotHost ?? DEFAULT_DNS.dotHost,
      dotPort: options.dns?.dotPort ?? DEFAULT_DNS.dotPort,
      plainServers: options.dns?.plainServers ?? DEFAULT_DNS.plainServers,
      family: options.dns?.family ?? DEFAULT_DNS.family,
      cacheSize: options.dns?.cacheSize ?? DEFAULT_DNS.cacheSize,
      minTtlSeconds: options.dns?.minTtlSeconds ?? DEFAULT_DNS.minTtlSeconds,
      maxTtlSeconds: options.dns?.maxTtlSeconds ?? DEFAULT_DNS.maxTtlSeconds,
      timeoutMs: options.dns?.timeoutMs ?? DEFAULT_DNS.timeoutMs,
    },
  };
}

/** Throws `RangeError` on values that would produce a broken proxy. */
export function assertValidSettings(settings: ProxySettings): void {
  if (!Number.isInteger(settings.port) || settings.port < 0 || settings.port > 65_535) {
    throw new RangeError(`port must be an integer in 0..65535, got ${String(settings.port)}`);
  }
  if (!Number.isInteger(settings.fragment.size) || settings.fragment.size < 1) {
    throw new RangeError(
      `fragment.size must be a positive integer, got ${String(settings.fragment.size)}`,
    );
  }
  if (settings.fragment.delayMs < 0) {
    throw new RangeError(`fragment.delayMs must be >= 0, got ${String(settings.fragment.delayMs)}`);
  }
  if (settings.dns.minTtlSeconds > settings.dns.maxTtlSeconds) {
    throw new RangeError('dns.minTtlSeconds must be <= dns.maxTtlSeconds');
  }
  if (settings.dns.mode === 'doh') {
    let url: URL;
    try {
      url = new URL(settings.dns.dohUrl);
    } catch {
      throw new RangeError(`dns.dohUrl is not a valid URL: ${settings.dns.dohUrl}`);
    }
    if (url.protocol !== 'https:') {
      throw new RangeError(`dns.dohUrl must use https, got ${url.protocol}`);
    }
  }
}
