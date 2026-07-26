/**
 * Public shape of everything the engine can be configured with, plus the
 * events and stats it reports back. Kept dependency-free so the CLI, the
 * Electron main process and the renderer can all share these types.
 */

/** Recursive `Partial` used for user-supplied overrides. Arrays stay atomic. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly (infer _U)[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

// ---------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------

/**
 * - `doh`   DNS over HTTPS (RFC 8484 wire format) — works with any DoH server.
 * - `dot`   DNS over TLS (RFC 7858) on port 853.
 * - `plain` Unencrypted UDP/TCP DNS. Fast, but the resolver sees every lookup.
 */
export type DnsMode = 'doh' | 'dot' | 'plain';

/** Which address families to ask for, in preference order. */
export type IpFamilyPreference = 'ipv4' | 'ipv6' | 'ipv4-first' | 'ipv6-first';

export interface DnsSettings {
  readonly mode: DnsMode;
  /** DoH endpoint. Used when `mode` is `doh`. */
  readonly dohUrl: string;
  /** DoT server hostname. Used when `mode` is `dot`. */
  readonly dotHost: string;
  readonly dotPort: number;
  /** Plain resolvers. Used when `mode` is `plain`. Empty means "OS defaults". */
  readonly plainServers: readonly string[];
  readonly family: IpFamilyPreference;
  /** Max distinct hostnames held in the resolver cache. */
  readonly cacheSize: number;
  /** Record TTLs are clamped into this range, in seconds. */
  readonly minTtlSeconds: number;
  readonly maxTtlSeconds: number;
  /** Abort a single DNS query after this long. */
  readonly timeoutMs: number;
}

export interface DnsRecord {
  readonly address: string;
  readonly family: 4 | 6;
  /** Seconds, as reported by the authoritative answer (before clamping). */
  readonly ttl: number;
}

// ---------------------------------------------------------------------------
// TLS fragmentation
// ---------------------------------------------------------------------------

export interface FragmentSettings {
  readonly enabled: boolean;
  /** Bytes per outgoing piece of the ClientHello. */
  readonly size: number;
  /**
   * When true each piece is re-framed as its own valid TLS record, so a DPI box
   * that reassembles at the record layer still never sees a whole SNI in one
   * record. When false the ClientHello is merely split across TCP segments.
   */
  readonly tlsRecords: boolean;
  /** Pause between pieces. Defeats boxes that reassemble on a short timer. */
  readonly delayMs: number;
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

export interface ProxySettings {
  readonly host: string;
  readonly port: number;
  /** Reject plain-HTTP (non-CONNECT) requests instead of proxying them. */
  readonly httpsOnly: boolean;
  /** Give up on the upstream TCP handshake after this long. */
  readonly connectTimeoutMs: number;
  /** Tear down a tunnel after this long with no traffic. 0 disables. */
  readonly idleTimeoutMs: number;
  readonly fragment: FragmentSettings;
  readonly dns: DnsSettings;
}

export type ProxyOptions = DeepPartial<ProxySettings>;

export interface ProxyAddress {
  readonly host: string;
  readonly port: number;
}

export type TunnelKind = 'https' | 'http';

export interface TunnelInfo {
  readonly id: number;
  readonly kind: TunnelKind;
  readonly host: string;
  readonly port: number;
  readonly startedAt: number;
}

export interface ProxyStats {
  readonly activeTunnels: number;
  readonly totalTunnels: number;
  readonly failedTunnels: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  /** Epoch ms, or `null` while stopped. */
  readonly startedAt: number | null;
}

export interface ProxyEventMap {
  listening: [ProxyAddress];
  close: [];
  error: [Error];
  'tunnel:open': [TunnelInfo];
  'tunnel:close': [TunnelInfo & { bytesSent: number; bytesReceived: number }];
  'tunnel:error': [TunnelInfo, Error];
}

// ---------------------------------------------------------------------------
// System proxy
// ---------------------------------------------------------------------------

export interface SystemProxySettings {
  readonly host: string;
  readonly port: number;
  /** Hosts that should bypass the proxy, e.g. `localhost`, `*.local`. */
  readonly bypass: readonly string[];
}

/** Opaque snapshot of the OS proxy configuration, used to restore it later. */
export interface SystemProxySnapshot {
  readonly platform: NodeJS.Platform;
  readonly entries: readonly SystemProxySnapshotEntry[];
  /**
   * PID that took the snapshot, so an orphaned snapshot left on disk by a
   * crashed run can be told apart from one a *live* process still owns.
   */
  readonly pid?: number;
}

/** One proxy endpoint. macOS keeps HTTP and HTTPS independent of each other. */
export interface ProxyEndpointState {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
}

export interface SystemProxySnapshotEntry extends ProxyEndpointState {
  /** Network service (macOS), schema key (Linux) or registry value (Windows). */
  readonly target: string;
  /**
   * The HTTPS proxy, when the platform tracks it separately from HTTP. Restoring
   * both from one reading would clobber a service configured with only one of
   * the two — a real state we found in the wild.
   */
  readonly secure?: ProxyEndpointState;
  /**
   * The bypass/exceptions list, recorded because `apply` overwrites it. v3.0
   * set it and never put it back, permanently burning our list into every
   * service it touched.
   */
  readonly bypass?: readonly string[];
}
